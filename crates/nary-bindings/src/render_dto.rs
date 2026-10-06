//! Serializable host DTOs for the React/input/render boundary.
//!
//! Every type here is the JSON shape a host (React adapter, Tauri view,
//! tests) reads after an input or query op. No [`nary_core`](nary_core)
//! domain struct serializes directly: each DTO maps explicitly from its
//! core counterpart, so core refactors never silently reshape the wire.
//!
//! The host draws from these descriptions: [`RenderModelDto`] carries the
//! document render plus the selection overlay and interaction hints, and
//! [`SessionStateDto`] carries the session mirrors. Canvas/DOM/textareas
//! stay host-owned.

use nary_core::editor::Editor;
use nary_core::editor::{
    EditorEvent, EscapeOutcome, KeyAction, PointerDownOutcome, PointerUpOutcome,
};
use nary_core::element::{ArrowheadType, CropRegion, ElementFillStyle, TextAlign};
use nary_core::geometry::rect::Bounds;
use nary_core::geometry::viewport::Viewport;
use nary_core::hit_test::combined_bounds;
use nary_core::interaction::{ContextMenuIntent, EditorPointerPhase, KeyIntent};
use nary_core::render_model::{
    DrawDetail, DrawEntry, DrawKind, FramePass, PaintDesc, RenderConfig, RenderModel,
    SelectionOverlay,
};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

// ---------------------------------------------------------------------------
// Viewport + bounds
// ---------------------------------------------------------------------------

/// Viewport description (scroll + zoom, TS `Viewport` parity).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportDto {
    /// Horizontal scroll offset in scene units.
    pub scroll_x: f64,
    /// Vertical scroll offset in scene units.
    pub scroll_y: f64,
    /// Zoom factor.
    pub zoom: f64,
}

/// Maps a viewport to its DTO.
pub fn viewport_dto(viewport: &Viewport) -> ViewportDto {
    ViewportDto {
        scroll_x: viewport.scroll_x,
        scroll_y: viewport.scroll_y,
        zoom: viewport.zoom,
    }
}

/// Axis-aligned bounds description (scene units).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundsDto {
    /// Minimum x (left edge).
    pub min_x: f64,
    /// Minimum y (top edge).
    pub min_y: f64,
    /// Maximum x (right edge).
    pub max_x: f64,
    /// Maximum y (bottom edge).
    pub max_y: f64,
}

/// Maps bounds to their DTO.
pub fn bounds_dto(bounds: &Bounds) -> BoundsDto {
    BoundsDto {
        min_x: bounds.min_x,
        min_y: bounds.min_y,
        max_x: bounds.max_x,
        max_y: bounds.max_y,
    }
}

// ---------------------------------------------------------------------------
// Paint + draw entries (TS `resolveFillStyle` / `renderElement` as data)
// ---------------------------------------------------------------------------

/// Serializable gradient stop (offset + CSS color).
#[derive(Debug, Clone, Serialize)]
pub struct PaintStopDto {
    /// Stop offset in `[0, 1]`.
    pub offset: f64,
    /// CSS color string.
    pub color: String,
}

/// Serializable fill description (tagged by `type`; hosts rebuild the
/// identical `CanvasGradient` for linear endpoints from the entry bounds:
/// center ± `cos/sin(angle°) * max(w,h) / 2` — the exact TS formula,
/// evaluated host-side where the context lives).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PaintDto {
    /// Flat CSS color (`"transparent"` disables the fill pass, as in TS).
    Solid {
        /// CSS color string.
        color: String,
    },
    /// Linear gradient (angle in degrees, `0°` = left-to-right).
    Linear {
        /// Gradient angle in degrees.
        angle: f64,
        /// Color stops.
        stops: Vec<PaintStopDto>,
    },
    /// Radial gradient (center-to-edge over the entry bounds).
    Radial {
        /// Color stops.
        stops: Vec<PaintStopDto>,
    },
    /// Angular (conic) gradient sweeping around the entry center.
    Angular {
        /// Sweep start angle in degrees.
        angle: f64,
        /// Color stops.
        stops: Vec<PaintStopDto>,
    },
}

/// Maps a fill description to its DTO.
pub fn paint_dto(paint: &PaintDesc) -> PaintDto {
    match paint {
        PaintDesc::Solid { color } => PaintDto::Solid {
            color: color.clone(),
        },
        PaintDesc::Linear { angle, stops } => PaintDto::Linear {
            angle: *angle,
            stops: stops
                .iter()
                .map(|stop| PaintStopDto {
                    offset: stop.offset,
                    color: stop.color.clone(),
                })
                .collect(),
        },
        PaintDesc::Radial { stops } => PaintDto::Radial {
            stops: stops
                .iter()
                .map(|stop| PaintStopDto {
                    offset: stop.offset,
                    color: stop.color.clone(),
                })
                .collect(),
        },
        PaintDesc::Angular { angle, stops } => PaintDto::Angular {
            angle: *angle,
            stops: stops
                .iter()
                .map(|stop| PaintStopDto {
                    offset: stop.offset,
                    color: stop.color.clone(),
                })
                .collect(),
        },
    }
}

/// Per-corner radii, clockwise from top-left.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CornerRadiiDto {
    /// Top-left corner radius in scene units.
    pub top_left: f64,
    /// Top-right corner radius in scene units.
    pub top_right: f64,
    /// Bottom-right corner radius in scene units.
    pub bottom_right: f64,
    /// Bottom-left corner radius in scene units.
    pub bottom_left: f64,
}

/// Per-kind payload beyond the shared entry fields (tagged by `type`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DrawDetailDto {
    /// No extra payload.
    None,
    /// Rectangle corner radius (`null` = sharp corners, TS `roundness`).
    Rectangle {
        /// Corner radius in scene units, or `None` (wire `null`) for sharp corners.
        roundness: Option<f64>,
        /// Per-corner radii (`null` = uniform/`roundness` corners).
        corners: Option<CornerRadiiDto>,
    },
    /// Text content + font + alignment (the host measures with its 2D context).
    Text {
        /// Raw text (whitespace significant, never trimmed).
        text: String,
        /// Font size in scene units.
        font_size: f64,
        /// Font family name.
        font_family: String,
        /// Horizontal alignment: `"left"`, `"center"`, or `"right"` (TS `textAlign`).
        align: String,
    },
    /// Image asset reference + readiness + natural size + crop.
    Image {
        /// Asset id in the host store.
        asset_id: String,
        /// Whether the host has the pixels cached.
        ready: bool,
        /// Original file width in natural pixels (wire `naturalWidth`).
        #[serde(rename = "naturalWidth")]
        natural_w: f64,
        /// Original file height in natural pixels (wire `naturalHeight`).
        #[serde(rename = "naturalHeight")]
        natural_h: f64,
        /// Non-destructive crop in natural pixels (`null` = full image;
        /// the host maps it to `drawImage` sx/sy/sw/sh).
        crop: Option<CropDto>,
    },
    /// Frame label + clip flag (children clip in the frame pass).
    Frame {
        /// Frame label.
        name: String,
        /// Whether children clip to the frame bounds.
        clip_content: bool,
    },
    /// Arrowhead markers (`"arrow"`, `"bar"`, `"dot"`, or `null`).
    Arrow {
        /// Head marker at the polyline start (`None` = wire `null` = no head).
        start: Option<String>,
        /// Head marker at the polyline end (`None` = wire `null` = no head).
        end: Option<String>,
    },
    /// Path closed flag (fill vs. stroke-only hit/render).
    Path {
        /// Closed (filled shape) vs. open (stroke only).
        closed: bool,
    },
    /// Custom shape type name (host dispatches through ShapeExtension).
    Custom {
        /// Plugin-registered type discriminator.
        type_name: String,
    },
}

/// Crop region in natural image pixels (TS `CropRegion` parity).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CropDto {
    /// Left edge in natural pixels.
    pub x: f64,
    /// Top edge in natural pixels.
    pub y: f64,
    /// Width in natural pixels.
    pub width: f64,
    /// Height in natural pixels.
    pub height: f64,
}

/// Maps a crop region to its DTO.
pub fn crop_dto(crop: &CropRegion) -> CropDto {
    CropDto {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height,
    }
}

/// Text alignment name on the wire (TS `textAlign` parity).
pub fn text_align_name(align: &TextAlign) -> &'static str {
    match align {
        TextAlign::Left => "left",
        TextAlign::Center => "center",
        TextAlign::Right => "right",
    }
}

/// Arrowhead name on the wire (TS `ArrowheadType` parity).
pub fn arrowhead_name(head: &ArrowheadType) -> &'static str {
    match head {
        ArrowheadType::Arrow => "arrow",
        ArrowheadType::Bar => "bar",
        ArrowheadType::Dot => "dot",
    }
}

/// Fill hatch name on the wire (TS `ElementFillStyle` parity).
pub fn fill_hatch_name(style: &ElementFillStyle) -> &'static str {
    match style {
        ElementFillStyle::Solid => "solid",
        ElementFillStyle::Hachure => "hachure",
        ElementFillStyle::CrossHatch => "cross-hatch",
    }
}

/// Maps a draw detail to its DTO.
pub fn detail_dto(detail: &DrawDetail) -> DrawDetailDto {
    match detail {
        DrawDetail::None => DrawDetailDto::None,
        DrawDetail::Rectangle { roundness, corners } => DrawDetailDto::Rectangle {
            roundness: *roundness,
            corners: corners.map(|values| CornerRadiiDto {
                top_left: values[0],
                top_right: values[1],
                bottom_right: values[2],
                bottom_left: values[3],
            }),
        },
        DrawDetail::Text {
            text,
            font_size,
            font_family,
            align,
        } => DrawDetailDto::Text {
            text: text.clone(),
            font_size: *font_size,
            font_family: font_family.clone(),
            align: text_align_name(align).to_string(),
        },
        DrawDetail::Image {
            asset_id,
            ready,
            natural_w,
            natural_h,
            crop,
        } => DrawDetailDto::Image {
            asset_id: asset_id.clone(),
            ready: *ready,
            natural_w: *natural_w,
            natural_h: *natural_h,
            crop: crop.as_ref().map(crop_dto),
        },
        DrawDetail::Frame { name, clip_content } => DrawDetailDto::Frame {
            name: name.clone(),
            clip_content: *clip_content,
        },
        DrawDetail::Arrow { start, end } => DrawDetailDto::Arrow {
            start: start.as_ref().map(|head| arrowhead_name(head).to_string()),
            end: end.as_ref().map(|head| arrowhead_name(head).to_string()),
        },
        DrawDetail::Path { closed } => DrawDetailDto::Path { closed: *closed },
        DrawDetail::Custom { type_name } => DrawDetailDto::Custom {
            type_name: type_name.clone(),
        },
    }
}

/// Element dispatch tag on the wire.
pub fn draw_kind_name(kind: &DrawKind) -> &'static str {
    match kind {
        DrawKind::Rectangle => "rectangle",
        DrawKind::Ellipse => "ellipse",
        DrawKind::Line => "line",
        DrawKind::Arrow => "arrow",
        DrawKind::Text => "text",
        DrawKind::Freedraw => "freedraw",
        DrawKind::Frame => "frame",
        DrawKind::Image => "image",
        DrawKind::Path => "path",
        DrawKind::Instance => "instance",
        DrawKind::Custom => "custom",
    }
}

/// One vector-path anchor in absolute scene coordinates.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSegmentDto {
    /// Anchor position in scene coordinates.
    pub point: [f64; 2],
    /// Incoming control point in scene coordinates, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle_in: Option<[f64; 2]>,
    /// Outgoing control point in scene coordinates, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle_out: Option<[f64; 2]>,
}

/// One drawable element: everything the host needs for a paint call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawEntryDto {
    /// Stable element id.
    pub id: String,
    /// Dispatch tag (`"rectangle"`, `"text"`, …).
    pub kind: String,
    /// Rotation-aware AABB in scene units.
    pub bounds: BoundsDto,
    /// Rotation in radians about the element center.
    pub rotation: f64,
    /// Fill description.
    pub paint: PaintDto,
    /// Fill hatch pattern over the paint (`"solid"`, `"hachure"`, `"cross-hatch"`).
    pub fill_hatch: String,
    /// Stroke CSS color.
    pub stroke_color: String,
    /// Stroke width in scene units.
    pub stroke_width: f64,
    /// Stroke dash pattern (`"solid"`, `"dashed"`, or `"dotted"`).
    pub stroke_style: String,
    /// Stroke cap (`"butt"`, `"round"`, or `"square"`).
    pub stroke_cap: String,
    /// Stroke join (`"miter"`, `"round"`, or `"bevel"`).
    pub stroke_join: String,
    /// Stroke alignment (`"inside"`, `"center"`, or `"outside"`).
    pub stroke_align: String,
    /// Opacity on the 0–100 scale.
    pub opacity: f64,
    /// Per-kind payload.
    pub detail: DrawDetailDto,
    /// Absolute scene-space polyline for line/arrow/freedraw (absent for
    /// all other kinds — the AABB alone cannot describe strokes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<[f64; 2]>>,
    /// Absolute scene-space path anchors for path elements (absent otherwise).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub segments: Option<Vec<PathSegmentDto>>,
}

/// Maps a draw entry to its DTO.
pub fn draw_entry_dto(entry: &DrawEntry) -> DrawEntryDto {
    DrawEntryDto {
        id: entry.id.as_str().to_string(),
        kind: draw_kind_name(&entry.kind).to_string(),
        bounds: bounds_dto(&entry.bounds),
        rotation: entry.rotation,
        paint: paint_dto(&entry.paint),
        fill_hatch: fill_hatch_name(&entry.fill_hatch).to_string(),
        stroke_color: entry.stroke_color.clone(),
        stroke_width: entry.stroke_width,
        stroke_style: entry.stroke_style.clone(),
        stroke_cap: entry.stroke_cap.clone(),
        stroke_join: entry.stroke_join.clone(),
        stroke_align: entry.stroke_align.clone(),
        opacity: entry.opacity,
        detail: detail_dto(&entry.detail),
        points: entry.points.clone(),
        segments: entry.segments.as_ref().map(|segments| {
            segments
                .iter()
                .map(|segment| PathSegmentDto {
                    point: segment.point,
                    handle_in: segment.handle_in,
                    handle_out: segment.handle_out,
                })
                .collect()
        }),
    }
}

/// One frame with its clipped children.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FramePassDto {
    /// The frame entry itself.
    pub frame: DrawEntryDto,
    /// In-view children of this frame (z-ordered with the model).
    pub children: Vec<DrawEntryDto>,
}

/// Maps a frame pass to its DTO.
pub fn frame_pass_dto(pass: &FramePass) -> FramePassDto {
    FramePassDto {
        frame: draw_entry_dto(&pass.frame),
        children: pass.children.iter().map(draw_entry_dto).collect(),
    }
}

// ---------------------------------------------------------------------------
// Selection overlay + snap guides (interactive-canvas data)
// ---------------------------------------------------------------------------

/// Selection overlay description: combined box + handle layout.
///
/// Pure data for the host's interactive canvas (`rotation` applies about
/// the box center, exactly like TS `renderSelectionBox`/`renderHandles`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionOverlayDto {
    /// Combined AABB of the selection.
    pub bounds: BoundsDto,
    /// Eight resize-handle positions in scene coordinates.
    pub handles: Vec<[f64; 2]>,
    /// Rotate-handle position in scene coordinates.
    pub rotate_handle: [f64; 2],
    /// Selection rotation in radians (single-element case, else 0).
    pub rotation: f64,
}

/// Maps a selection overlay to its DTO.
pub fn selection_overlay_dto(overlay: &SelectionOverlay) -> SelectionOverlayDto {
    SelectionOverlayDto {
        bounds: bounds_dto(&overlay.bounds),
        handles: overlay
            .handles
            .iter()
            .map(|handle| handle.position)
            .collect(),
        rotate_handle: overlay.rotate_handle,
        rotation: overlay.rotation,
    }
}

/// Snap-guide segment description (host draws the line as-is).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapGuideDto {
    /// Guide orientation (`true` = vertical x-alignment).
    pub vertical: bool,
    /// Guide line position (x when vertical, y when horizontal).
    pub position: f64,
    /// Segment start x.
    pub start_x: f64,
    /// Segment start y.
    pub start_y: f64,
    /// Segment end x.
    pub end_x: f64,
    /// Segment end y.
    pub end_y: f64,
}

/// Maps a snap guide to its DTO.
pub fn snap_guide_dto(guide: &nary_core::interaction::SnapGuide) -> SnapGuideDto {
    SnapGuideDto {
        vertical: guide.vertical,
        position: guide.position,
        start_x: guide.start_x,
        start_y: guide.start_y,
        end_x: guide.end_x,
        end_y: guide.end_y,
    }
}

// ---------------------------------------------------------------------------
// Text session state (textarea-overlay data)
// ---------------------------------------------------------------------------

/// Active text-session mirror (what the host textarea shows).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextStateDto {
    /// Element under edit.
    pub id: String,
    /// Current draft (what the textarea holds).
    pub draft: String,
    /// Caret as a char index into `draft`.
    pub caret: usize,
    /// Whether an IME composition is open (host must not finalize).
    pub composing: bool,
}

/// Reads the editor's text session, if any.
pub fn text_state_dto(editor: &Editor) -> Option<TextStateDto> {
    let id = editor.text_editing()?;
    Some(TextStateDto {
        id: id.as_str().to_string(),
        draft: editor.text_draft().unwrap_or_default().to_string(),
        caret: editor.text_caret().unwrap_or_default(),
        composing: editor.text_composing(),
    })
}

// ---------------------------------------------------------------------------
// Pointer phase (live-gesture hint for overlays)
// ---------------------------------------------------------------------------

/// Pointer-machine phase hint.
///
/// Hosts combine `originScene` with their locally-known cursor (they sent
/// every move) to draw live rubber-band/draw previews — no second code
/// path, no hidden state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseDto {
    /// Phase kind: `"idle"`, `"pressed"`, `"dragging"`,
    /// `"draggingResize"`, `"draggingRotate"`, `"rubberBand"`,
    /// `"drawing"`, or `"panning"`.
    pub kind: String,
    /// Scene-space press origin (press/drag/rubber/draw phases).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_scene: Option<[f64; 2]>,
    /// Elements the drag moves (move phase only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected: Option<Vec<String>>,
    /// Additive flag at press time (rubber-band only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additive: Option<bool>,
    /// Dragged element id (resize/rotate phases only — the host feeds this
    /// back to the `previewResize`/`previewRotate` queries).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Dragged resize handle in TS kebab-case (`"top-left"`, … — resize
    /// phase only; the host feeds this back to `previewResize`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handle: Option<String>,
}

/// Maps the pointer phase to its DTO.
pub fn phase_dto(phase: &EditorPointerPhase) -> PhaseDto {
    match phase {
        EditorPointerPhase::Idle => PhaseDto {
            kind: "idle".to_string(),
            origin_scene: None,
            affected: None,
            additive: None,
            target: None,
            handle: None,
        },
        EditorPointerPhase::Pressed(capture) => PhaseDto {
            kind: "pressed".to_string(),
            origin_scene: Some(capture.origin_scene),
            affected: None,
            additive: None,
            target: None,
            handle: None,
        },
        EditorPointerPhase::DraggingMove {
            affected,
            origin_scene,
            ..
        } => PhaseDto {
            kind: "dragging".to_string(),
            origin_scene: Some(*origin_scene),
            affected: Some(affected.iter().map(|id| id.as_str().to_string()).collect()),
            additive: None,
            target: None,
            handle: None,
        },
        EditorPointerPhase::DraggingResize {
            id,
            handle,
            anchor_scene,
            ..
        } => PhaseDto {
            kind: "draggingResize".to_string(),
            origin_scene: Some(*anchor_scene),
            affected: None,
            additive: None,
            target: Some(id.as_str().to_string()),
            handle: Some(handle_name(handle).to_string()),
        },
        EditorPointerPhase::DraggingRotate {
            id, anchor_scene, ..
        } => PhaseDto {
            kind: "draggingRotate".to_string(),
            origin_scene: Some(*anchor_scene),
            affected: None,
            additive: None,
            target: Some(id.as_str().to_string()),
            handle: None,
        },
        EditorPointerPhase::RubberBand {
            origin_scene,
            additive,
        } => PhaseDto {
            kind: "rubberBand".to_string(),
            origin_scene: Some(*origin_scene),
            affected: None,
            additive: Some(*additive),
            target: None,
            handle: None,
        },
        EditorPointerPhase::Drawing { origin_scene, .. } => PhaseDto {
            kind: "drawing".to_string(),
            origin_scene: Some(*origin_scene),
            affected: None,
            additive: None,
            target: None,
            handle: None,
        },
        EditorPointerPhase::Panning { .. } => PhaseDto {
            kind: "panning".to_string(),
            origin_scene: None,
            affected: None,
            additive: None,
            target: None,
            handle: None,
        },
    }
}

/// Resize-handle name on the wire (TS `HandleType` kebab-case parity).
pub fn handle_name(handle: &nary_core::geometry::transform::HandleType) -> &'static str {
    use nary_core::geometry::transform::HandleType as H;
    match handle {
        H::TopLeft => "top-left",
        H::TopCenter => "top-center",
        H::TopRight => "top-right",
        H::MiddleLeft => "middle-left",
        H::MiddleRight => "middle-right",
        H::BottomLeft => "bottom-left",
        H::BottomCenter => "bottom-center",
        H::BottomRight => "bottom-right",
    }
}

/// Short phase name for [`crate::protocol::EngineStatus`] polling.
pub fn phase_name(phase: &EditorPointerPhase) -> &'static str {
    match phase {
        EditorPointerPhase::Idle => "idle",
        EditorPointerPhase::Pressed(_) => "pressed",
        EditorPointerPhase::DraggingMove { .. } => "dragging",
        EditorPointerPhase::DraggingResize { .. } => "draggingResize",
        EditorPointerPhase::DraggingRotate { .. } => "draggingRotate",
        EditorPointerPhase::RubberBand { .. } => "rubberBand",
        EditorPointerPhase::Drawing { .. } => "drawing",
        EditorPointerPhase::Panning { .. } => "panning",
    }
}

// ---------------------------------------------------------------------------
// Normalized events (notifications, never a second source of truth)
// ---------------------------------------------------------------------------

/// One drained engine event (tagged by `type`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EventDto {
    /// Persistent document content changed.
    DocumentChanged,
    /// Undo/redo availability changed.
    HistoryChanged {
        /// Whether `undo` would do anything.
        can_undo: bool,
        /// Whether `redo` would do anything.
        can_redo: bool,
    },
    /// Selection changed (selected ids in selection order).
    SelectionChanged {
        /// Selected ids in selection order.
        ids: Vec<String>,
    },
    /// Active tool changed.
    ToolChanged {
        /// New tool id.
        tool: String,
    },
    /// Viewport changed (pan/zoom).
    ViewportChanged {
        /// New viewport state.
        viewport: ViewportDto,
    },
    /// Text-editing session started (`Some`) or ended (`None`).
    TextEditingChanged {
        /// Element under edit, if any.
        id: Option<String>,
    },
    /// A drag gesture started tracking.
    GestureStarted,
    /// A drag gesture committed one history entry.
    GestureCommitted,
    /// A gesture was cancelled with no document or history effect.
    GestureCancelled,
}

/// Maps an engine event to its DTO.
pub fn event_dto(event: &EditorEvent) -> EventDto {
    match event {
        EditorEvent::DocumentChanged => EventDto::DocumentChanged,
        EditorEvent::HistoryChanged(status) => EventDto::HistoryChanged {
            can_undo: status.can_undo,
            can_redo: status.can_redo,
        },
        EditorEvent::SelectionChanged(ids) => EventDto::SelectionChanged {
            ids: ids.iter().map(|id| id.as_str().to_string()).collect(),
        },
        EditorEvent::ToolChanged(tool) => EventDto::ToolChanged { tool: tool.clone() },
        EditorEvent::ViewportChanged(viewport) => EventDto::ViewportChanged {
            viewport: viewport_dto(viewport),
        },
        EditorEvent::TextEditingChanged(id) => EventDto::TextEditingChanged {
            id: id.as_ref().map(|id| id.as_str().to_string()),
        },
        EditorEvent::GestureStarted => EventDto::GestureStarted,
        EditorEvent::GestureCommitted => EventDto::GestureCommitted,
        EditorEvent::GestureCancelled => EventDto::GestureCancelled,
    }
}

// ---------------------------------------------------------------------------
// Input outcome DTOs
// ---------------------------------------------------------------------------

/// Pointer-press outcome.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerDownDto {
    /// Hit element at press time, if any.
    pub hit: Option<String>,
    /// Text session started by this press, if any.
    pub began_text_edit: Option<String>,
    /// A previous text session committed first (outside-click parity).
    pub committed_text: bool,
}

/// Maps a pointer-press outcome to its DTO.
pub fn pointer_down_dto(outcome: &PointerDownOutcome) -> PointerDownDto {
    PointerDownDto {
        hit: outcome.hit.as_ref().map(|id| id.as_str().to_string()),
        began_text_edit: outcome
            .began_text_edit
            .as_ref()
            .map(|id| id.as_str().to_string()),
        committed_text: outcome.committed_text,
    }
}

/// Pointer-release outcome (tagged by `kind`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PointerUpDto {
    /// Below-threshold click (selection updated, no mutation).
    Click,
    /// Past-threshold drag committed (`committed` = history entry written).
    DragCommitted {
        /// Whether one history entry was written.
        committed: bool,
    },
    /// Rubber band finished (selected ids).
    RubberBand {
        /// Selected ids.
        selected: Vec<String>,
    },
    /// Shape-draw drag finished (new element id, if big enough).
    ShapeCreated {
        /// New element id, if the drag passed the minimum size.
        id: Option<String>,
    },
    /// Middle-drag pan finished.
    Panned,
    /// Stray release with nothing captured.
    Dismissed,
}

/// Maps a pointer-release outcome to its DTO.
pub fn pointer_up_dto(outcome: &PointerUpOutcome) -> PointerUpDto {
    match outcome {
        PointerUpOutcome::Click => PointerUpDto::Click,
        PointerUpOutcome::DragCommitted(committed) => PointerUpDto::DragCommitted {
            committed: *committed,
        },
        PointerUpOutcome::RubberBand(ids) => PointerUpDto::RubberBand {
            selected: ids.iter().map(|id| id.as_str().to_string()).collect(),
        },
        PointerUpOutcome::ShapeCreated(id) => PointerUpDto::ShapeCreated {
            id: id.as_ref().map(|id| id.as_str().to_string()),
        },
        PointerUpOutcome::Panned => PointerUpDto::Panned,
        PointerUpOutcome::Dismissed => PointerUpDto::Dismissed,
    }
}

/// Escape-chain outcome name plus commit flag.
pub fn escape_dto(outcome: &EscapeOutcome) -> (&'static str, Option<bool>) {
    match outcome {
        EscapeOutcome::GestureCancelled => ("gestureCancelled", None),
        EscapeOutcome::TextCommitted(committed) => ("textCommitted", Some(*committed)),
        EscapeOutcome::GroupExited => ("groupExited", None),
        EscapeOutcome::SelectionCleared => ("selectionCleared", None),
        EscapeOutcome::NothingToDo => ("nothingToDo", None),
    }
}

/// Key-intent name for host clipboard routing.
pub fn key_intent_name(intent: &KeyIntent) -> &'static str {
    match intent {
        KeyIntent::DeleteSelected => "deleteSelected",
        KeyIntent::Nudge { .. } => "nudge",
        KeyIntent::Undo => "undo",
        KeyIntent::Redo => "redo",
        KeyIntent::Copy => "copy",
        KeyIntent::Paste => "paste",
        KeyIntent::Cut => "cut",
        KeyIntent::Duplicate => "duplicate",
        KeyIntent::Escape => "escape",
    }
}

/// Key-press outcome (tagged by `kind`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum KeyActionDto {
    /// Selection deleted (locked skipped, one history entry).
    Deleted {
        /// Affected ids.
        affected: Vec<String>,
        /// Whether anything changed.
        changed: bool,
    },
    /// Selection nudged (one history entry).
    Nudged {
        /// Affected ids.
        affected: Vec<String>,
        /// Whether anything changed.
        changed: bool,
    },
    /// Undo attempted (`undone` = something was undone).
    Undone {
        /// Whether an entry was undone.
        undone: bool,
    },
    /// Redo attempted.
    Redone {
        /// Whether an entry was redone.
        redone: bool,
    },
    /// Escape chain ran.
    Escape {
        /// Chain outcome (`"textCommitted"`, `"groupExited"`, …).
        escape: String,
        /// Whether text changed (text-commit outcomes only).
        committed: Option<bool>,
    },
    /// Intent decided but not executed here (clipboard payloads are host
    /// work: the host routes `copy`/`paste`/`cut`/`duplicate` through the
    /// matching buffer ops plus the system clipboard).
    Intent {
        /// Intent name (`"copy"`, `"paste"`, `"cut"`, `"duplicate"`).
        intent: String,
        /// Nudge delta x (nudge intents only).
        #[serde(skip_serializing_if = "Option::is_none")]
        dx: Option<f64>,
        /// Nudge delta y (nudge intents only).
        #[serde(skip_serializing_if = "Option::is_none")]
        dy: Option<f64>,
    },
    /// Key belongs elsewhere (text fields, IME, unbound).
    Ignored,
}

/// Maps a key-press outcome to its DTO.
pub fn key_action_dto(action: &KeyAction) -> KeyActionDto {
    match action {
        KeyAction::Deleted(outcome) => KeyActionDto::Deleted {
            affected: outcome
                .affected
                .iter()
                .map(|id| id.as_str().to_string())
                .collect(),
            changed: outcome.changed,
        },
        KeyAction::Nudged(outcome) => KeyActionDto::Nudged {
            affected: outcome
                .affected
                .iter()
                .map(|id| id.as_str().to_string())
                .collect(),
            changed: outcome.changed,
        },
        KeyAction::Undone(undone) => KeyActionDto::Undone { undone: *undone },
        KeyAction::Redone(redone) => KeyActionDto::Redone { redone: *redone },
        KeyAction::EscapeHandled(outcome) => {
            let (escape, committed) = escape_dto(outcome);
            KeyActionDto::Escape {
                escape: escape.to_string(),
                committed,
            }
        }
        KeyAction::UnhandledIntent(intent) => {
            let (dx, dy) = match intent {
                KeyIntent::Nudge { dx, dy } => (Some(*dx), Some(*dy)),
                _ => (None, None),
            };
            KeyActionDto::Intent {
                intent: key_intent_name(intent).to_string(),
                dx,
                dy,
            }
        }
        KeyAction::Ignored => KeyActionDto::Ignored,
    }
}

/// Context-menu intent name (the host renders labels and routes each
/// intent back through its matching op).
pub fn context_intent_name(intent: &ContextMenuIntent) -> &'static str {
    match intent {
        ContextMenuIntent::Delete => "delete",
        ContextMenuIntent::Duplicate => "duplicate",
        ContextMenuIntent::BringToFront => "bringToFront",
        ContextMenuIntent::SendToBack => "sendToBack",
        ContextMenuIntent::BringForward => "bringForward",
        ContextMenuIntent::SendBackward => "sendBackward",
        ContextMenuIntent::Group => "group",
        ContextMenuIntent::Ungroup => "ungroup",
        ContextMenuIntent::Lock => "lock",
        ContextMenuIntent::Unlock => "unlock",
    }
}

// ---------------------------------------------------------------------------
// Render model + session state responses
// ---------------------------------------------------------------------------

/// Deterministic document render for one host frame.
///
/// Live rubber-band/draw previews are intentionally NOT here: the host
/// holds the cursor locally (it sent every move) and draws the preview
/// rect from [`SessionStateDto::pointer_phase`] `originScene` — pure
/// presentation math in the adapter, covered by adapter tests. Core only
/// decides the committed geometry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderModelDto {
    /// Non-frame entries and children of out-of-view frames, z-ordered.
    pub base: Vec<DrawEntryDto>,
    /// In-view frames with their clipped children, z-ordered.
    pub frames: Vec<FramePassDto>,
    /// Selection overlay (`None` when nothing is selected).
    pub selection: Option<SelectionOverlayDto>,
    /// Snap guides from the last committed move (host overlay hint).
    pub snap_guides: Vec<SnapGuideDto>,
    /// Active text session (host textarea mirror).
    pub text_editing: Option<TextStateDto>,
    /// Viewport the model was built for.
    pub viewport: ViewportDto,
    /// Asset generation the model was built for.
    pub asset_generation: u64,
}

/// Builds the host render description from the editor.
///
/// `ready_images` holds the asset ids whose pixels the host has cached;
/// `config` carries the canvas size, grid hint, and asset generation the
/// host bumped on async load completion.
pub fn render_model_dto(
    editor: &Editor,
    config: &RenderConfig,
    ready_images: &std::collections::HashSet<String>,
) -> RenderModelDto {
    let doc = editor.document();
    let viewport = editor.viewport();
    let is_ready = |id: &str| ready_images.contains(id);
    let model = RenderModel::build(doc, &viewport, config, &is_ready);

    let selection_ids = editor.state().selection.ids();
    let selection = combined_bounds(doc, selection_ids).map(|bounds| {
        let rotation = if selection_ids.len() == 1 {
            doc.get(selection_ids[0].as_str())
                .map(|element| element.base().rotation)
                .unwrap_or(0.0)
        } else {
            0.0
        };
        selection_overlay_dto(&SelectionOverlay::for_bounds(
            &bounds,
            viewport.zoom,
            editor.theme(),
            rotation,
        ))
    });

    RenderModelDto {
        base: model.base.iter().map(draw_entry_dto).collect(),
        frames: model.frames.iter().map(frame_pass_dto).collect(),
        selection,
        snap_guides: editor
            .last_snap_guides()
            .iter()
            .map(snap_guide_dto)
            .collect(),
        text_editing: text_state_dto(editor),
        viewport: viewport_dto(&viewport),
        asset_generation: model.asset_generation,
    }
}

// ---------------------------------------------------------------------------
// Render cache (frame polling without full rebuilds)
// ---------------------------------------------------------------------------

/// Cache key covering every [`render_model_dto`] input: document nonce,
/// asset generation (bumped by `configure`/`notifyAssetsChanged`, so theme
/// and snap-config changes invalidate), viewport, canvas/grid config, ready
/// images, selection, snap guides, and the full text-session state. Two
/// equal keys always build byte-identical DTOs.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RenderCacheKey {
    nonce: u64,
    asset_generation: u64,
    viewport: (u64, u64, u64),
    canvas: (u64, u64),
    show_grid: bool,
    grid_size: u64,
    ready_images: Vec<String>,
    selection: Vec<String>,
    guides: Vec<(bool, u64, u64, u64, u64, u64)>,
    text_editing: Option<String>,
    text_draft: String,
    text_caret: usize,
    text_composing: bool,
}

impl RenderCacheKey {
    /// Captures the key for one `renderModel` query.
    pub fn capture(
        editor: &Editor,
        config: &nary_core::render_model::RenderConfig,
        ready_images: &HashSet<String>,
    ) -> Self {
        let viewport = editor.viewport();
        let mut ready: Vec<String> = ready_images.iter().cloned().collect();
        ready.sort();
        Self {
            nonce: editor.document().scene_nonce(),
            asset_generation: config.asset_generation,
            viewport: (
                viewport.scroll_x.to_bits(),
                viewport.scroll_y.to_bits(),
                viewport.zoom.to_bits(),
            ),
            canvas: (
                config.canvas_width.to_bits(),
                config.canvas_height.to_bits(),
            ),
            show_grid: config.show_grid,
            grid_size: config.grid_size.to_bits(),
            ready_images: ready,
            selection: editor
                .state()
                .selection
                .ids()
                .iter()
                .map(|id| id.as_str().to_string())
                .collect(),
            guides: editor
                .last_snap_guides()
                .iter()
                .map(|guide| {
                    (
                        guide.vertical,
                        guide.position.to_bits(),
                        guide.start_x.to_bits(),
                        guide.start_y.to_bits(),
                        guide.end_x.to_bits(),
                        guide.end_y.to_bits(),
                    )
                })
                .collect(),
            text_editing: editor.text_editing().map(|id| id.as_str().to_string()),
            text_draft: editor.text_draft().unwrap_or_default().to_string(),
            text_caret: editor.text_caret().unwrap_or_default(),
            text_composing: editor.text_composing(),
        }
    }
}

/// One-entry render cache: hosts poll `renderModel` every frame, and most
/// polls repeat the previous inputs exactly. A hit returns a cloned DTO
/// without rebuilding; any input change misses and rebuilds. Hit/miss
/// counters are observability for hosts and benchmarks (not protocol).
#[derive(Debug, Default)]
pub struct RenderCache {
    entry: RwLock<Option<(RenderCacheKey, RenderModelDto)>>,
    hits: AtomicU64,
    misses: AtomicU64,
}

impl RenderCache {
    /// Creates an empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the cached DTO for `key`, or builds it once via `build`,
    /// stores it, and returns it. Poison-tolerant like the document rank
    /// cache: a poisoned lock rebuilds instead of panicking library code.
    pub fn get_or_build(
        &self,
        key: RenderCacheKey,
        build: impl FnOnce() -> RenderModelDto,
    ) -> RenderModelDto {
        if let Ok(guard) = self.entry.read() {
            if let Some((cached_key, dto)) = guard.as_ref() {
                if *cached_key == key {
                    self.hits.fetch_add(1, Ordering::Relaxed);
                    return dto.clone();
                }
            }
        }
        let dto = build();
        if let Ok(mut guard) = self.entry.write() {
            *guard = Some((key, dto.clone()));
        }
        self.misses.fetch_add(1, Ordering::Relaxed);
        dto
    }

    /// Cache hits so far (repeated identical queries).
    pub fn hits(&self) -> u64 {
        self.hits.load(Ordering::Relaxed)
    }

    /// Cache misses so far (rebuilds).
    pub fn misses(&self) -> u64 {
        self.misses.load(Ordering::Relaxed)
    }

    /// Drops the cached entry and resets counters.
    pub fn clear(&self) {
        if let Ok(mut guard) = self.entry.write() {
            *guard = None;
        }
        self.hits.store(0, Ordering::Relaxed);
        self.misses.store(0, Ordering::Relaxed);
    }
}

/// Host-visible session snapshot (toolbar/panel/cursor state).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateDto {
    /// Selected ids in selection order.
    pub selection: Vec<String>,
    /// Active tool id.
    pub tool: String,
    /// Current viewport.
    pub viewport: ViewportDto,
    /// Active text session, if any.
    pub text_editing: Option<TextStateDto>,
    /// Pointer-machine phase hint.
    pub pointer_phase: PhaseDto,
    /// Whether `undo` would do anything.
    pub can_undo: bool,
    /// Whether `redo` would do anything.
    pub can_redo: bool,
    /// Undo stack depth.
    pub undo_len: usize,
    /// Redo stack depth.
    pub redo_len: usize,
    /// Tool allow-list (`None` = every tool allowed).
    pub enabled_tools: Option<Vec<String>>,
    /// Asset generation (host-bumped on async load completion).
    pub asset_generation: u64,
    /// Whether a pen session is active.
    pub pen_active: bool,
    /// Image element id under crop, if any.
    pub cropping: Option<String>,
    /// Path element id under edit, if any.
    pub path_editing: Option<String>,
}

/// Reads the host-visible session snapshot.
pub fn session_state_dto(editor: &Editor, asset_generation: u64) -> SessionStateDto {
    SessionStateDto {
        selection: editor
            .state()
            .selection
            .ids()
            .iter()
            .map(|id| id.as_str().to_string())
            .collect(),
        tool: editor.state().active_tool.clone(),
        viewport: viewport_dto(&editor.viewport()),
        text_editing: text_state_dto(editor),
        pointer_phase: phase_dto(editor.pointer_phase()),
        can_undo: editor.history().can_undo(),
        can_redo: editor.history().can_redo(),
        undo_len: editor.history().undo_len(),
        redo_len: editor.history().redo_len(),
        enabled_tools: editor.state().enabled_tools.clone(),
        asset_generation,
        pen_active: editor.is_pen_active(),
        cropping: editor
            .cropping_element_id()
            .map(|id| id.as_str().to_string()),
        path_editing: editor.path_editing_id().map(|id| id.as_str().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nary_core::element::{
        create_arrow, create_image, create_rectangle, create_text, ArrowheadType,
        CounterIdGenerator, CropRegion, Element, ElementFillStyle, TextAlign,
    };
    use nary_core::render_model::DrawEntry;

    fn ready(_: &str) -> bool {
        true
    }

    #[test]
    fn rectangle_roundness_wire() {
        let mut gen = CounterIdGenerator::new();

        let mut rounded = create_rectangle(&mut gen);
        rounded.roundness = Some(12.0);
        let entry = DrawEntry::for_element(&Element::Rectangle(rounded), &ready);
        match detail_dto(&entry.detail) {
            DrawDetailDto::Rectangle { roundness, corners } => {
                assert_eq!(roundness, Some(12.0));
                assert!(corners.is_none());
            }
            other => panic!("expected rectangle DTO, got {other:?}"),
        }

        let sharp = create_rectangle(&mut gen);
        let entry = DrawEntry::for_element(&Element::Rectangle(sharp), &ready);
        let dto = detail_dto(&entry.detail);
        match &dto {
            DrawDetailDto::Rectangle { roundness, corners } => {
                assert_eq!(*roundness, None);
                assert!(corners.is_none());
            }
            other => panic!("expected rectangle DTO, got {other:?}"),
        }
        // Wire `null` (TS `roundness: null`), not an absent field.
        let json = serde_json::to_value(&dto).expect("serializable");
        assert_eq!(json["roundness"], serde_json::Value::Null);
        assert_eq!(json["corners"], serde_json::Value::Null);
    }

    #[test]
    fn text_align_wire_strings() {
        let mut gen = CounterIdGenerator::new();
        for (align, wire) in [
            (TextAlign::Left, "left"),
            (TextAlign::Center, "center"),
            (TextAlign::Right, "right"),
        ] {
            assert_eq!(text_align_name(&align), wire);
            let mut text = create_text(&mut gen);
            text.text_align = align;
            let entry = DrawEntry::for_element(&Element::Text(text), &ready);
            match detail_dto(&entry.detail) {
                DrawDetailDto::Text { align: got, .. } => assert_eq!(got, wire),
                other => panic!("expected text DTO, got {other:?}"),
            }
        }
    }

    #[test]
    fn image_natural_crop_wire() {
        let mut gen = CounterIdGenerator::new();

        let mut cropped = create_image(&mut gen);
        cropped.asset_id = "asset-1".to_string();
        cropped.natural_width = 800.0;
        cropped.natural_height = 600.0;
        cropped.crop = Some(CropRegion {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
        });
        let entry = DrawEntry::for_element(&Element::Image(cropped), &ready);
        let dto = detail_dto(&entry.detail);
        let json = serde_json::to_value(&dto).expect("serializable");
        // TS `naturalWidth` / `naturalHeight` keys (not snake, not abbreviated).
        assert_eq!(json["naturalWidth"], serde_json::json!(800.0));
        assert_eq!(json["naturalHeight"], serde_json::json!(600.0));
        assert_eq!(json["crop"]["x"], serde_json::json!(10.0));
        assert_eq!(json["crop"]["width"], serde_json::json!(100.0));

        // Uncropped: explicit `null` crop.
        let full = create_image(&mut gen);
        let entry = DrawEntry::for_element(&Element::Image(full), &ready);
        let dto = detail_dto(&entry.detail);
        let json = serde_json::to_value(&dto).expect("serializable");
        assert_eq!(json["crop"], serde_json::Value::Null);
    }

    #[test]
    fn arrow_head_wire_strings() {
        assert_eq!(arrowhead_name(&ArrowheadType::Arrow), "arrow");
        assert_eq!(arrowhead_name(&ArrowheadType::Bar), "bar");
        assert_eq!(arrowhead_name(&ArrowheadType::Dot), "dot");

        let mut gen = CounterIdGenerator::new();
        let mut heads = create_arrow(&mut gen);
        heads.start_arrowhead = Some(ArrowheadType::Bar);
        heads.end_arrowhead = Some(ArrowheadType::Dot);
        let entry = DrawEntry::for_element(&Element::Arrow(heads), &ready);
        match detail_dto(&entry.detail) {
            DrawDetailDto::Arrow { start, end } => {
                assert_eq!(start.as_deref(), Some("bar"));
                assert_eq!(end.as_deref(), Some("dot"));
            }
            other => panic!("expected arrow DTO, got {other:?}"),
        }

        let mut bare = create_arrow(&mut gen);
        bare.start_arrowhead = None;
        bare.end_arrowhead = None;
        let entry = DrawEntry::for_element(&Element::Arrow(bare), &ready);
        let dto = detail_dto(&entry.detail);
        let json = serde_json::to_value(&dto).expect("serializable");
        assert_eq!(json["start"], serde_json::Value::Null);
        assert_eq!(json["end"], serde_json::Value::Null);
    }

    #[test]
    fn fill_hatch_wire_strings() {
        assert_eq!(fill_hatch_name(&ElementFillStyle::Solid), "solid");
        assert_eq!(fill_hatch_name(&ElementFillStyle::Hachure), "hachure");
        assert_eq!(
            fill_hatch_name(&ElementFillStyle::CrossHatch),
            "cross-hatch"
        );

        let mut gen = CounterIdGenerator::new();
        for (hatch, wire) in [
            (ElementFillStyle::Solid, "solid"),
            (ElementFillStyle::Hachure, "hachure"),
            (ElementFillStyle::CrossHatch, "cross-hatch"),
        ] {
            let mut rect = create_rectangle(&mut gen);
            rect.base.fill_style = hatch;
            let entry = DrawEntry::for_element(&Element::Rectangle(rect), &ready);
            let dto = draw_entry_dto(&entry);
            assert_eq!(dto.fill_hatch, wire);
            let json = serde_json::to_value(&dto).expect("serializable");
            assert_eq!(json["fillHatch"], serde_json::json!(wire));
        }
    }

    #[test]
    fn crop_dto_maps_fields() {
        let crop = CropRegion {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
        };
        let dto = crop_dto(&crop);
        assert_eq!((dto.x, dto.y, dto.width, dto.height), (1.0, 2.0, 3.0, 4.0));
    }
}
