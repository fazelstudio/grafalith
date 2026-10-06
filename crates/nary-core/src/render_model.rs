//! Pure render representation: deterministic draw-list from document.
//!
//! TS sources: the pure parts of `packages/core/src/render/render-loop.ts`
//! (nonce/viewport dirty check, spatial cull, z-order sort, frame-clip
//! partition, instance resolve + cache), `render/fill-style.ts`
//! (solid/linear/radial resolution), `render/canvas-bounds.ts` (bounded
//! overlay), `render/render-selection.ts` (selection box, handles, rotate
//! handle, rubber band), and `render/viewport.ts` culling via
//! `getViewportBounds`.
//!
//! Design (module 02 §5, module 06): core produces **data**, hosts draw.
//! [`RenderModel::build`] is deterministic from
//! `(document, viewport, config)` — transient overlays stay separate:
//!
//! ```text
//! document render     RenderModel { base, frames }   (this module)
//! selection overlay   SelectionOverlay                (this module)
//! interaction overlay host-owned (snap guides, previews — Phase 05)
//! text editing overlay host-owned (textarea + caret — Phase 05)
//! ```
//!
//! No canvas, DOM, `requestAnimationFrame`, or image bytes here. Async
//! assets resolve through an explicit path: the host passes availability
//! (`is_image_ready`) and bumps [`RenderConfig::asset_generation`] when a
//! load completes — the generation is the invalidation root (module 06:
//! no accidental React rerenders). Image cache/pending-load/object-URL
//! machinery stays a host concern.

use crate::document::Document;
use crate::element::{
    ArrowheadType, CropRegion, Element, ElementFillStyle, ElementId, FillStyle, TextAlign,
};
use crate::geometry::point::Point;
use crate::geometry::rect::Bounds;
use crate::geometry::transform::{get_resize_handles, get_rotate_handle_position, ResizeHandle};
use crate::geometry::viewport::{viewport_bounds, Viewport};
use crate::theme::NaryTheme;

// ---------------------------------------------------------------------------
// Paint (TS `FillStyle` → serializable desc, never a canvas object)
// ---------------------------------------------------------------------------

/// Serializable gradient stop (offset + CSS color).
#[derive(Debug, Clone, PartialEq)]
pub struct PaintStop {
    /// Stop offset in `[0, 1]`.
    pub offset: f64,
    /// CSS color string.
    pub color: String,
}

/// Serializable paint description for one element fill.
///
/// Ports TS `resolveFillStyle` minus the canvas: solid colors pass
/// through; gradients keep their angle/stops so the host can rebuild the
/// identical `CanvasGradient` (linear endpoints from the entry bounds:
/// center ± `cos/sin(angle°) * max(w,h) / 2`; radial from the bounds
/// center with radius `max(w,h) / 2` — the exact TS formulae, evaluated
/// host-side where the context lives).
#[derive(Debug, Clone, PartialEq)]
pub enum PaintDesc {
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
        stops: Vec<PaintStop>,
    },
    /// Radial gradient (center-to-edge over the entry bounds).
    Radial {
        /// Color stops.
        stops: Vec<PaintStop>,
    },
    /// Angular (conic) gradient sweeping around the entry center (M8).
    Angular {
        /// Sweep start angle in degrees.
        angle: f64,
        /// Color stops.
        stops: Vec<PaintStop>,
    },
}

/// Resolves an element fill to a serializable [`PaintDesc`].
pub fn resolve_paint(fill: &FillStyle) -> PaintDesc {
    match fill {
        FillStyle::Solid { color } => PaintDesc::Solid {
            color: color.clone(),
        },
        FillStyle::Gradient {
            gradient_type,
            angle,
            stops,
        } => {
            let stops = stops
                .iter()
                .map(|stop| PaintStop {
                    offset: stop.offset,
                    color: stop.color.clone(),
                })
                .collect();
            match gradient_type {
                crate::element::GradientType::Linear => PaintDesc::Linear {
                    angle: *angle,
                    stops,
                },
                crate::element::GradientType::Radial => PaintDesc::Radial { stops },
                crate::element::GradientType::Angular => PaintDesc::Angular {
                    angle: *angle,
                    stops,
                },
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Draw entries (TS `renderElement` dispatch, as data)
// ---------------------------------------------------------------------------

/// Element kind for a draw entry (dispatch tag, no behavior).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrawKind {
    /// Rectangle (corner radius rides in [`DrawDetail::Rectangle`]).
    Rectangle,
    /// Ellipse.
    Ellipse,
    /// Polyline.
    Line,
    /// Polyline with heads.
    Arrow,
    /// Text run.
    Text,
    /// Freehand stroke.
    Freedraw,
    /// Frame container.
    Frame,
    /// Image (asset reference only).
    Image,
    /// Bezier path.
    Path,
    /// Component instance placeholder (resolved in Phase 09).
    Instance,
    /// Plugin-registered custom shape (Phase 09 extensible shape system).
    Custom,
}

/// Per-kind payload the host needs beyond the shared fields.
///
/// Hatch (`fill_hatch` on [`DrawEntry`]) rides separately from `paint`:
/// hatch is a stroke pattern over the fill, not a fill color itself, so
/// [`PaintDesc`] stays color/gradient-only (TS keeps `fillStyle` and
/// `backgroundColor` on independent axes too).
#[derive(Debug, Clone, PartialEq)]
pub enum DrawDetail {
    /// No extra payload.
    None,
    /// Rectangle corner radius (TS `roundness`: `Some` radius in scene
    /// units, `None` for sharp corners; the host clamps with
    /// `min(r, w/2, h/2)` exactly like TS `drawRoundedRect`).
    Rectangle {
        /// Corner radius in scene units, or `None` for sharp corners.
        /// Non-finite input is sanitized to `None` at build time.
        roundness: Option<f64>,
        /// Per-corner radii `[top_left, top_right, bottom_right,
        /// bottom_left]`, or `None` for uniform/`roundness` corners. Wins
        /// over `roundness` when present; non-finite or negative input
        /// sanitizes to `None`.
        corners: Option<[f64; 4]>,
    },
    /// Text content + font + alignment (host measures via [`TextMeasurer`]).
    Text {
        /// Raw text (whitespace significant, never trimmed).
        text: String,
        /// Font size in scene units.
        font_size: f64,
        /// Font family name.
        font_family: String,
        /// Horizontal alignment within the element box (TS `textAlign`).
        align: TextAlign,
    },
    /// Image asset reference + readiness + natural size + crop.
    Image {
        /// Asset id in the host store.
        asset_id: String,
        /// Whether the host has the pixels cached.
        ready: bool,
        /// Original file width in natural pixels (aspect-ratio lock source;
        /// non-finite input is sanitized to `0.0` at build time).
        natural_w: f64,
        /// Original file height in natural pixels (sanitized like `natural_w`).
        natural_h: f64,
        /// Non-destructive crop in natural pixels (`None` = full image;
        /// the host maps it to `drawImage` sx/sy/sw/sh, TS `renderImage`).
        /// A crop with any non-finite coordinate is sanitized to `None`.
        crop: Option<CropRegion>,
    },
    /// Frame label + clip flag (children clip in the frame pass).
    Frame {
        /// Frame label.
        name: String,
        /// Whether children clip to the frame bounds.
        clip_content: bool,
    },
    /// Arrowhead markers (TS `startArrowhead` / `endArrowhead`).
    Arrow {
        /// Head marker at the polyline start (`None` = no head).
        start: Option<ArrowheadType>,
        /// Head marker at the polyline end (`None` = no head).
        end: Option<ArrowheadType>,
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

/// One vector-path anchor in absolute scene coordinates (base origin +
/// relative offsets resolved at build time, so hosts draw without a second
/// crossing).
#[derive(Debug, Clone, PartialEq)]
pub struct AbsoluteSegment {
    /// Anchor position in scene coordinates.
    pub point: Point,
    /// Incoming control point in scene coordinates, if any.
    pub handle_in: Option<Point>,
    /// Outgoing control point in scene coordinates, if any.
    pub handle_out: Option<Point>,
}

/// One drawable element: everything the host needs for a single paint call.
///
/// `bounds` is the rotation-aware AABB ([`Element::bounds`]); `rotation`
/// rides along so the host applies the same center rotation TS does.
/// `points`/`segments` carry absolute scene coordinates for the
/// point-based kinds (line/arrow/freedraw/path) so committed strokes render
/// as true polylines — the AABB alone cannot describe them (Phase 12).
#[derive(Debug, Clone, PartialEq)]
pub struct DrawEntry {
    /// Stable element id.
    pub id: ElementId,
    /// Dispatch tag.
    pub kind: DrawKind,
    /// Rotation-aware AABB in scene units.
    pub bounds: Bounds,
    /// Rotation in radians about the element center.
    pub rotation: f64,
    /// Fill description.
    pub paint: PaintDesc,
    /// Fill hatch pattern over the paint (TS `fillStyle`: solid paint,
    /// hand-drawn hachure, or cross-hatch). Kept beside — never inside —
    /// [`PaintDesc`], because hatch is a stroke pattern applied on top of
    /// whatever the paint resolves to, not a color/gradient itself.
    pub fill_hatch: ElementFillStyle,
    /// Stroke CSS color.
    pub stroke_color: String,
    /// Stroke width in scene units.
    pub stroke_width: f64,
    /// Stroke dash pattern (`"solid"`, `"dashed"`, or `"dotted"` — TS parity).
    pub stroke_style: String,
    /// Stroke cap (`"butt"`, `"round"`, or `"square"` — M8).
    pub stroke_cap: String,
    /// Stroke join (`"miter"`, `"round"`, or `"bevel"` — M8).
    pub stroke_join: String,
    /// Stroke alignment (`"inside"`, `"center"`, or `"outside"` — M8,
    /// paint-time instruction for hosts).
    pub stroke_align: String,
    /// Opacity on the 0–100 scale.
    pub opacity: f64,
    /// Per-kind payload.
    pub detail: DrawDetail,
    /// Absolute scene-space polyline for line/arrow/freedraw (`None` for
    /// all other kinds). Resolved from the element origin plus its
    /// relative points at build time.
    pub points: Option<Vec<Point>>,
    /// Absolute scene-space path anchors for path elements (`None` for all
    /// other kinds).
    pub segments: Option<Vec<AbsoluteSegment>>,
}

impl DrawEntry {
    /// Builds an entry for `element`, asking the host closure whether an
    /// image asset is ready (`false` → placeholder pass, TS parity).
    ///
    /// Never panics: non-finite floats from the element (roundness,
    /// natural size, crop) are sanitized to `None` / `0.0` instead of
    /// leaking NaN into the draw list.
    pub fn for_element(element: &Element, is_image_ready: &dyn Fn(&str) -> bool) -> Self {
        let base = element.base();
        let fill_hatch = base.fill_style;
        let (kind, detail) = match element {
            Element::Rectangle(el) => (
                DrawKind::Rectangle,
                DrawDetail::Rectangle {
                    roundness: el.roundness.filter(|value| value.is_finite()),
                    corners: el.corners.and_then(|corners| {
                        let values = [
                            corners.top_left,
                            corners.top_right,
                            corners.bottom_right,
                            corners.bottom_left,
                        ];
                        values
                            .iter()
                            .all(|value| value.is_finite() && *value >= 0.0)
                            .then_some(values)
                    }),
                },
            ),
            Element::Ellipse(_) => (DrawKind::Ellipse, DrawDetail::None),
            Element::Line(_) => (DrawKind::Line, DrawDetail::None),
            Element::Arrow(el) => (
                DrawKind::Arrow,
                DrawDetail::Arrow {
                    start: el.start_arrowhead,
                    end: el.end_arrowhead,
                },
            ),
            Element::Text(el) => (
                DrawKind::Text,
                DrawDetail::Text {
                    text: el.text.clone(),
                    font_size: el.font_size,
                    font_family: el.font_family.clone(),
                    align: el.text_align,
                },
            ),
            Element::Freedraw(_) => (DrawKind::Freedraw, DrawDetail::None),
            Element::Frame(el) => (
                DrawKind::Frame,
                DrawDetail::Frame {
                    name: el.name.clone(),
                    clip_content: el.clip_content,
                },
            ),
            Element::Image(el) => (
                DrawKind::Image,
                DrawDetail::Image {
                    asset_id: el.asset_id.clone(),
                    ready: is_image_ready(el.asset_id.as_str()),
                    natural_w: finite_or_zero(el.natural_width),
                    natural_h: finite_or_zero(el.natural_height),
                    crop: sanitized_crop(el.crop),
                },
            ),
            Element::Path(el) => (DrawKind::Path, DrawDetail::Path { closed: el.closed }),
            Element::Instance(_) => (DrawKind::Instance, DrawDetail::None),
            Element::Custom(el) => (
                DrawKind::Custom,
                DrawDetail::Custom {
                    type_name: el.type_name.clone(),
                },
            ),
        };
        Self {
            id: base.id.clone(),
            kind,
            bounds: element.bounds(),
            rotation: base.rotation,
            paint: resolve_paint(&base.background_color),
            fill_hatch,
            stroke_color: base.stroke_color.clone(),
            stroke_width: base.stroke_width,
            stroke_style: match base.stroke_style {
                crate::element::StrokeStyle::Solid => "solid".to_string(),
                crate::element::StrokeStyle::Dashed => "dashed".to_string(),
                crate::element::StrokeStyle::Dotted => "dotted".to_string(),
            },
            stroke_cap: match base.stroke_cap {
                crate::element::StrokeCap::Butt => "butt".to_string(),
                crate::element::StrokeCap::Round => "round".to_string(),
                crate::element::StrokeCap::Square => "square".to_string(),
            },
            stroke_join: match base.stroke_join {
                crate::element::StrokeJoin::Miter => "miter".to_string(),
                crate::element::StrokeJoin::Round => "round".to_string(),
                crate::element::StrokeJoin::Bevel => "bevel".to_string(),
            },
            stroke_align: match base.stroke_align {
                crate::element::StrokeAlign::Inside => "inside".to_string(),
                crate::element::StrokeAlign::Center => "center".to_string(),
                crate::element::StrokeAlign::Outside => "outside".to_string(),
            },
            opacity: base.opacity,
            detail,
            points: absolute_points(element),
            segments: absolute_segments(element),
        }
    }
}

/// Returns `value` when finite, else `0.0` — keeps NaN/Infinity authored
/// on an element from leaking into the draw list (never panics).
fn finite_or_zero(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

/// Returns `crop` when every coordinate is finite, else `None` — a
/// partially-NaN source rectangle would mislead `drawImage` host-side.
fn sanitized_crop(crop: Option<CropRegion>) -> Option<CropRegion> {
    crop.filter(|region| {
        region.x.is_finite()
            && region.y.is_finite()
            && region.width.is_finite()
            && region.height.is_finite()
    })
}

/// Resolves element-relative polyline points to absolute scene coordinates
/// for the stroke kinds (line/arrow/freedraw). Returns `None` otherwise.
fn absolute_points(element: &Element) -> Option<Vec<Point>> {
    let base = element.base();
    let rel: &[Point] = match element {
        Element::Line(el) => &el.points,
        Element::Arrow(el) => &el.points,
        Element::Freedraw(el) => &el.points,
        _ => return None,
    };
    Some(
        rel.iter()
            .map(|point| [base.x + point[0], base.y + point[1]])
            .collect(),
    )
}

/// Resolves element-relative path anchors to absolute scene coordinates.
/// Returns `None` for non-path elements.
fn absolute_segments(element: &Element) -> Option<Vec<AbsoluteSegment>> {
    let Element::Path(el) = element else {
        return None;
    };
    let base = element.base();
    Some(
        el.segments
            .iter()
            .map(|segment| {
                let anchor = [base.x + segment.point[0], base.y + segment.point[1]];
                AbsoluteSegment {
                    point: anchor,
                    handle_in: segment
                        .handle_in
                        .map(|handle| [anchor[0] + handle[0], anchor[1] + handle[1]]),
                    handle_out: segment
                        .handle_out
                        .map(|handle| [anchor[0] + handle[0], anchor[1] + handle[1]]),
                }
            })
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Render configuration + model (TS `RenderLoop` pure parts)
// ---------------------------------------------------------------------------

/// Render configuration: canvas size, grid hint, asset generation.
///
/// `asset_generation` is the explicit invalidation root for async assets
/// (module 06): the host bumps it when an image/font load completes and
/// rebuilds the model. Two models built from equal
/// `(document, viewport, config)` are identical — determinism pin.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderConfig {
    /// Canvas width in screen pixels.
    pub canvas_width: f64,
    /// Canvas height in screen pixels.
    pub canvas_height: f64,
    /// Whether the host paints the background grid.
    pub show_grid: bool,
    /// Grid spacing in scene units.
    pub grid_size: f64,
    /// Asset generation (host-bumped on async load completion).
    pub asset_generation: u64,
}

impl RenderConfig {
    /// Default config for an 800×600 canvas, no grid, generation 0.
    pub fn new(canvas_width: f64, canvas_height: f64) -> Self {
        Self {
            canvas_width,
            canvas_height,
            show_grid: false,
            grid_size: crate::geometry::snap::DEFAULT_GRID_SIZE,
            asset_generation: 0,
        }
    }
}

/// One frame with clipping: the frame plus its in-view children.
#[derive(Debug, Clone, PartialEq)]
pub struct FramePass {
    /// The frame entry itself.
    pub frame: DrawEntry,
    /// In-view children of this frame (z-ordered with the model).
    pub children: Vec<DrawEntry>,
}

/// Deterministic document render: culled, z-ordered entries plus frame passes.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderModel {
    /// Non-frame entries and children of out-of-view frames, z-ordered.
    pub base: Vec<DrawEntry>,
    /// In-view frames with their clipped children, z-ordered.
    pub frames: Vec<FramePass>,
    /// Viewport the model was built for.
    pub viewport: Viewport,
    /// Asset generation the model was built for.
    pub asset_generation: u64,
}

impl RenderModel {
    /// Builds the model from `(document, viewport, config)`.
    ///
    /// Ports the TS `renderStaticScene` pure parts: viewport cull (world
    /// bounds vs. element bounds, inclusive), deleted/hidden skip,
    /// instance-as-box (use [`RenderModel::build_with_registry`] for
    /// resolved instances), z-order sort (document order is already
    /// back-to-front), and the frame-clip partition — framed children draw
    /// ONLY in their frame's pass when the frame is in view, otherwise
    /// unclipped in the base pass (TS `framedChildIds` rule preserved
    /// verbatim).
    ///
    /// Culling consults the document spatial index for candidates, then
    /// filters in document order so results are identical to the linear
    /// scan with z-order preserved.
    pub fn build(
        document: &Document,
        viewport: &Viewport,
        config: &RenderConfig,
        is_image_ready: &dyn Fn(&str) -> bool,
    ) -> Self {
        let (vx, vy, vw, vh) = viewport_bounds(viewport, config.canvas_width, config.canvas_height);
        let view = Bounds::new(vx, vy, vx + vw, vy + vh);
        Self::build_filtered(document, viewport, config, is_image_ready, &view)
    }

    /// Builds the model with instance resolution via `registry` (TS
    /// `resolveInstance` parity for rendering): `Instance` elements are
    /// replaced by their resolved master copies (unresolvable instances
    /// fall back to the raw box). All other rules match [`RenderModel::build`].
    pub fn build_with_registry(
        document: &Document,
        registry: &crate::components::ComponentRegistry,
        viewport: &Viewport,
        config: &RenderConfig,
        is_image_ready: &dyn Fn(&str) -> bool,
    ) -> Self {
        let plain = Self::build(document, viewport, config, is_image_ready);
        // Resolve instances inside the already-culled entry lists so the
        // viewport/frame-partition rules stay identical; only the instance
        // boxes expand.
        let resolve_entry = |entry: DrawEntry| -> Vec<DrawEntry> {
            if entry.kind != DrawKind::Instance {
                return vec![entry];
            }
            let Some(element) = document.get(entry.id.as_str()) else {
                return vec![entry];
            };
            let crate::element::Element::Instance(instance) = element else {
                return vec![entry];
            };
            let Some(component) = registry.get(instance.component_id.as_str()) else {
                return vec![entry];
            };
            match crate::components::resolve_instance(document, element, component) {
                Ok(resolved) if !resolved.is_empty() => resolved
                    .iter()
                    .map(|el| DrawEntry::for_element(el, is_image_ready))
                    .collect(),
                _ => vec![entry],
            }
        };
        let base = plain.base.into_iter().flat_map(resolve_entry).collect();
        let frames = plain
            .frames
            .into_iter()
            .map(|pass| FramePass {
                frame: pass.frame,
                children: pass.children.into_iter().flat_map(resolve_entry).collect(),
            })
            .collect();
        Self {
            base,
            frames,
            viewport: plain.viewport,
            asset_generation: plain.asset_generation,
        }
    }

    /// Shared cull + partition core used by [`RenderModel::build`].
    fn build_filtered(
        document: &Document,
        viewport: &Viewport,
        config: &RenderConfig,
        is_image_ready: &dyn Fn(&str) -> bool,
        view: &Bounds,
    ) -> Self {
        // Candidates from the spatial index, then exact-filtered in
        // document order so z-order is preserved. The index is synced on
        // every document mutation (tombstones evicted), so membership
        // implies a bounds overlap check is worthwhile; non-members skip
        // the (more expensive) exact math entirely.
        let candidates: std::collections::HashSet<String> = document
            .query_spatial(view)
            .into_iter()
            .map(|id| id.as_str().to_string())
            .collect();
        // Culled, visible, z-ordered elements (document order is the order).
        let mut visible: Vec<&Element> = Vec::new();
        for element in document.get_all() {
            if element.base().hidden {
                continue;
            }
            if !candidates.contains(element.id().as_str()) {
                continue;
            }
            if view.intersects(&element.bounds()) {
                visible.push(element);
            }
        }

        let frames_in_view: std::collections::HashSet<&str> = visible
            .iter()
            .filter(|el| matches!(el, Element::Frame(_)))
            .map(|el| el.id().as_str())
            .collect();

        let mut base = Vec::new();
        let mut frame_order: Vec<ElementId> = Vec::new();
        let mut children_by_frame: std::collections::HashMap<String, Vec<DrawEntry>> =
            std::collections::HashMap::new();

        for element in &visible {
            match element {
                Element::Frame(_) => {
                    frame_order.push(element.id().clone());
                }
                _ => {
                    let frame_id = element.base().frame_id.as_ref().map(|id| id.as_str());
                    match frame_id {
                        Some(fid) if frames_in_view.contains(fid) => {
                            children_by_frame
                                .entry(fid.to_string())
                                .or_default()
                                .push(DrawEntry::for_element(element, is_image_ready));
                        }
                        _ => base.push(DrawEntry::for_element(element, is_image_ready)),
                    }
                }
            }
        }

        let mut frames = Vec::new();
        for id in &frame_order {
            if let Some(element) = document.get(id.as_str()) {
                frames.push(FramePass {
                    frame: DrawEntry::for_element(element, is_image_ready),
                    children: children_by_frame.remove(id.as_str()).unwrap_or_default(),
                });
            }
        }

        Self {
            base,
            frames,
            viewport: *viewport,
            asset_generation: config.asset_generation,
        }
    }

    /// Total entry count (base + frames + children), for tests and hosts.
    pub fn entry_count(&self) -> usize {
        self.base.len()
            + self
                .frames
                .iter()
                .map(|pass| 1 + pass.children.len())
                .sum::<usize>()
    }
}

// ---------------------------------------------------------------------------
// Selection overlay (TS `renderSelectionOverlay` pure parts)
// ---------------------------------------------------------------------------

/// Selection overlay description: combined box + handle layout.
///
/// Pure data for the host's interactive canvas (the TS overlay paint
/// calls live host-side). `rotation` applies about the box center, as in
/// TS `renderSelectionBox` / `renderHandles`.
#[derive(Debug, Clone, PartialEq)]
pub struct SelectionOverlay {
    /// Combined AABB of the selection.
    pub bounds: Bounds,
    /// Eight resize handles in scene coordinates (unrotated frame).
    pub handles: [ResizeHandle; 8],
    /// Rotate-handle position in scene coordinates (unrotated frame).
    pub rotate_handle: crate::geometry::point::Point,
    /// Selection rotation in radians (single-element case).
    pub rotation: f64,
}

impl SelectionOverlay {
    /// Describes the overlay for `bounds` (already combined by the caller
    /// via [`crate::hit_test::combined_bounds`]).
    ///
    /// Handle sizes come from the theme; the rotate offset is
    /// zoom-normalized exactly like TS `getRotateHandlePosition`.
    pub fn for_bounds(bounds: &Bounds, zoom: f64, theme: &NaryTheme, rotation: f64) -> Self {
        Self {
            bounds: *bounds,
            handles: get_resize_handles(bounds),
            rotate_handle: get_rotate_handle_position(
                bounds,
                zoom,
                theme.sizes.rotate_handle_offset,
            ),
            rotation,
        }
    }
}

// ---------------------------------------------------------------------------
// Text measurement (host trait + pure layout)
// ---------------------------------------------------------------------------

/// Host text-measurement capability (TS `measureText` took a canvas ctx).
///
/// The engine never touches canvas text APIs (module 02 ownership):
/// hosts implement this with their 2D context, tests with a stub.
pub trait TextMeasurer {
    /// Width of one line in scene units for `font_size`/`family`.
    fn measure_line_width(&self, line: &str, font_size: f64, family: &str) -> f64;
}

/// Pure text-box layout over a host line-width function.
///
/// Ports the TS `measureText` arithmetic: width = max line width, height
/// = `lineCount × fontSize × 1.25` (empty text still yields one line of
/// height — pinned by `text.test.ts`).
pub fn measure_text_with(
    measure_line: &dyn Fn(&str) -> f64,
    text: &str,
    font_size: f64,
) -> (f64, f64) {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut max_width: f64 = 0.0;
    for line in &lines {
        max_width = max_width.max(measure_line(line));
    }
    let height =
        lines.len().max(1) as f64 * font_size * crate::element::TEXT_LINE_HEIGHT_MULTIPLIER;
    (max_width, height)
}

/// Measures `element` with a [`TextMeasurer`] host.
pub fn measure_text_element<M: TextMeasurer>(
    measurer: &M,
    text: &str,
    font_size: f64,
    family: &str,
) -> (f64, f64) {
    measure_text_with(
        &|line| measurer.measure_line_width(line, font_size, family),
        text,
        font_size,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubMeasurer;

    impl TextMeasurer for StubMeasurer {
        fn measure_line_width(&self, line: &str, font_size: f64, _family: &str) -> f64 {
            // Mirrors the TS test mock (0.6 × fontSize per char).
            line.chars().count() as f64 * font_size * 0.6
        }
    }

    #[test]
    fn paint_resolution_stays_serializable_data() {
        let solid = resolve_paint(&FillStyle::Solid {
            color: "#ff0000".to_string(),
        });
        assert_eq!(
            solid,
            PaintDesc::Solid {
                color: "#ff0000".to_string()
            }
        );
        let gradient = resolve_paint(&FillStyle::Gradient {
            gradient_type: crate::element::GradientType::Linear,
            angle: 45.0,
            stops: vec![
                crate::element::GradientStop {
                    offset: 0.0,
                    color: "#ff0000".to_string(),
                },
                crate::element::GradientStop {
                    offset: 1.0,
                    color: "#0000ff".to_string(),
                },
            ],
        });
        assert!(matches!(gradient, PaintDesc::Linear { angle, .. } if angle == 45.0));
        // Full JSON round-trip (fill-style.test.ts parity: data, not objects).
        let json = serde_like_round_trip(&gradient);
        assert!(json.contains("45"));
    }

    // std-only JSON-shaped assertion (no serde until Phase 06): the desc
    // is plain data with no canvas handles — Debug form carries values.
    fn serde_like_round_trip(paint: &PaintDesc) -> String {
        format!("{paint:?}")
    }

    #[test]
    fn rectangle_roundness_rides_in_detail() {
        use crate::element::{create_rectangle, CounterIdGenerator};
        let mut gen = CounterIdGenerator::new();
        let ready = |_: &str| true;

        let mut rounded = create_rectangle(&mut gen);
        rounded.roundness = Some(12.0);
        let entry = DrawEntry::for_element(&Element::Rectangle(rounded), &ready);
        assert_eq!(entry.kind, DrawKind::Rectangle);
        assert_eq!(
            entry.detail,
            DrawDetail::Rectangle {
                roundness: Some(12.0),
                corners: None,
            }
        );

        let sharp = create_rectangle(&mut gen);
        assert_eq!(sharp.roundness, None);
        let entry = DrawEntry::for_element(&Element::Rectangle(sharp), &ready);
        assert_eq!(
            entry.detail,
            DrawDetail::Rectangle {
                roundness: None,
                corners: None
            }
        );

        // Non-finite roundness sanitizes to sharp instead of leaking NaN.
        let mut nan = create_rectangle(&mut gen);
        nan.roundness = Some(f64::NAN);
        let entry = DrawEntry::for_element(&Element::Rectangle(nan), &ready);
        assert_eq!(
            entry.detail,
            DrawDetail::Rectangle {
                roundness: None,
                corners: None
            }
        );
    }

    #[test]
    fn text_align_mirrors_element() {
        use crate::element::{create_text, CounterIdGenerator, TextAlign};
        let mut gen = CounterIdGenerator::new();
        let ready = |_: &str| true;

        for align in [TextAlign::Left, TextAlign::Center, TextAlign::Right] {
            let mut text = create_text(&mut gen);
            text.text = "hi".to_string();
            text.text_align = align;
            let entry = DrawEntry::for_element(&Element::Text(text), &ready);
            match entry.detail {
                DrawDetail::Text {
                    align: got,
                    text,
                    font_size,
                    font_family,
                } => {
                    assert_eq!(got, align);
                    assert_eq!(text, "hi");
                    assert_eq!(font_size, 16.0);
                    assert_eq!(font_family, "Virgil");
                }
                other => panic!("expected text detail, got {other:?}"),
            }
        }
    }

    #[test]
    fn image_carries_natural_and_crop() {
        use crate::element::{create_image, CounterIdGenerator, CropRegion};
        let mut gen = CounterIdGenerator::new();
        let ready = |_: &str| true;

        // Cropped image: natural size + source rectangle for drawImage.
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
        assert_eq!(
            entry.detail,
            DrawDetail::Image {
                asset_id: "asset-1".to_string(),
                ready: true,
                natural_w: 800.0,
                natural_h: 600.0,
                crop: Some(CropRegion {
                    x: 10.0,
                    y: 20.0,
                    width: 100.0,
                    height: 50.0,
                }),
            }
        );

        // Uncropped image: full pixels, readiness from the host closure.
        let mut full = create_image(&mut gen);
        full.asset_id = "missing".to_string();
        let entry = DrawEntry::for_element(&Element::Image(full), &|_: &str| false);
        match entry.detail {
            DrawDetail::Image {
                ready,
                natural_w,
                natural_h,
                crop,
                ..
            } => {
                assert!(!ready);
                assert_eq!((natural_w, natural_h), (100.0, 100.0));
                assert_eq!(crop, None);
            }
            other => panic!("expected image detail, got {other:?}"),
        }
    }

    #[test]
    fn image_non_finite_sanitizes_without_panic() {
        use crate::element::{create_image, CounterIdGenerator, CropRegion};
        let mut gen = CounterIdGenerator::new();
        let mut img = create_image(&mut gen);
        img.natural_width = f64::NAN;
        img.natural_height = f64::INFINITY;
        img.crop = Some(CropRegion {
            x: 0.0,
            y: f64::NAN,
            width: 10.0,
            height: 10.0,
        });
        let entry = DrawEntry::for_element(&Element::Image(img), &|_: &str| true);
        assert_eq!(
            entry.detail,
            DrawDetail::Image {
                asset_id: String::new(),
                ready: true,
                natural_w: 0.0,
                natural_h: 0.0,
                crop: None,
            }
        );
    }

    #[test]
    fn arrow_carries_full_head_variants() {
        use crate::element::{create_arrow, ArrowheadType, CounterIdGenerator};
        let mut gen = CounterIdGenerator::new();
        let ready = |_: &str| true;

        // Factory default: no start head, arrow end head.
        let arrow = create_arrow(&mut gen);
        let entry = DrawEntry::for_element(&Element::Arrow(arrow), &ready);
        assert_eq!(
            entry.detail,
            DrawDetail::Arrow {
                start: None,
                end: Some(ArrowheadType::Arrow),
            }
        );

        // Bar + dot combination (triangle geometry derives host-side).
        let mut heads = create_arrow(&mut gen);
        heads.start_arrowhead = Some(ArrowheadType::Bar);
        heads.end_arrowhead = Some(ArrowheadType::Dot);
        let entry = DrawEntry::for_element(&Element::Arrow(heads), &ready);
        assert_eq!(
            entry.detail,
            DrawDetail::Arrow {
                start: Some(ArrowheadType::Bar),
                end: Some(ArrowheadType::Dot),
            }
        );

        // Headless polyline.
        let mut bare = create_arrow(&mut gen);
        bare.start_arrowhead = None;
        bare.end_arrowhead = None;
        let entry = DrawEntry::for_element(&Element::Arrow(bare), &ready);
        assert_eq!(
            entry.detail,
            DrawDetail::Arrow {
                start: None,
                end: None,
            }
        );
    }

    #[test]
    fn fill_hatch_mirrors_element_on_every_kind() {
        use crate::element::{
            create_ellipse, create_rectangle, create_text, CounterIdGenerator, ElementFillStyle,
        };
        let mut gen = CounterIdGenerator::new();
        let ready = |_: &str| true;

        for hatch in [
            ElementFillStyle::Solid,
            ElementFillStyle::Hachure,
            ElementFillStyle::CrossHatch,
        ] {
            let mut rect = create_rectangle(&mut gen);
            rect.base.fill_style = hatch;
            let entry = DrawEntry::for_element(&Element::Rectangle(rect), &ready);
            assert_eq!(entry.fill_hatch, hatch);

            let mut ellipse = create_ellipse(&mut gen);
            ellipse.base.fill_style = hatch;
            let entry = DrawEntry::for_element(&Element::Ellipse(ellipse), &ready);
            assert_eq!(entry.fill_hatch, hatch);

            let mut text = create_text(&mut gen);
            text.base.fill_style = hatch;
            let entry = DrawEntry::for_element(&Element::Text(text), &ready);
            assert_eq!(entry.fill_hatch, hatch);
        }
    }

    #[test]
    fn text_layout_matches_ts_measure_contract() {
        let m = StubMeasurer;
        let (w1, h1) = measure_text_element(&m, "Hello", 16.0, "sans-serif");
        let (w2, h2) = measure_text_element(&m, "Hello", 16.0, "sans-serif");
        assert_eq!((w1, h1), (w2, h2));
        let (short, _) = measure_text_element(&m, "Hi", 16.0, "sans-serif");
        let (long, _) = measure_text_element(&m, "Hello World", 16.0, "sans-serif");
        assert!(long > short);
        let (_, single) = measure_text_element(&m, "One line", 16.0, "sans-serif");
        let (_, multi) =
            measure_text_element(&m, "Line one\nLine two\nLine three", 16.0, "sans-serif");
        assert!((multi - single * 3.0).abs() < 1e-9);
        let (_, empty) = measure_text_element(&m, "", 16.0, "sans-serif");
        assert!(empty > 0.0);
    }
}
