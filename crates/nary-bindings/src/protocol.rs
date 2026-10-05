//! JSON-string protocol for the host boundary (ADR-0010, module 09).
//!
//! Every value crossing the JS/Rust boundary is a JSON string described
//! here. The protocol is versioned ([`PROTOCOL_VERSION`]); hosts must
//! check it on wrap and refuse to talk to a skewed artifact instead of
//! dropping work silently. No Rust type crosses the boundary except through
//! these shapes — in particular, [`nary_core`] domain structs and
//! [`nary_io`] DTOs are never serialized directly.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use nary_core::EngineError;

/// Protocol version. Bump only with an explicit breaking-change note in
/// the TS mirror and the phase report.
pub const PROTOCOL_VERSION: u32 = 1;

/// One intent inside an [`apply_batch`](crate::Engine::apply_batch) array.
///
/// Serialized form is `{ "op": "<camelCase>", ...params }`. Unknown `op`
/// strings fail the whole batch parse (explicit, not silent) so hosts
/// notice a version skew immediately instead of dropping work.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum BatchOp {
    /// Create one element from its scene-JSON object. The object goes
    /// through the same validation as file import (see
    /// [`crate::Engine`] docs); unknown element types are skipped and
    /// reported as a per-op error.
    Create {
        /// Element object in scene-JSON shape (same fields as file import).
        element: Value,
    },
    /// Soft-delete elements by id (unknown ids are skipped, TS parity).
    Delete {
        /// Ids to soft-delete.
        ids: Vec<String>,
    },
    /// Translate elements by a scene-space delta.
    Move {
        /// Ids to translate.
        ids: Vec<String>,
        /// Scene-space delta x.
        dx: f64,
        /// Scene-space delta y.
        dy: f64,
    },
    /// Directly replace one element's bounds (TS `resizeElement` parity).
    SetBounds {
        /// Target id.
        id: String,
        /// New bounds in scene units.
        x: f64,
        /// New bounds in scene units.
        y: f64,
        /// New bounds in scene units (must be `>= 1`).
        width: f64,
        /// New bounds in scene units (must be `>= 1`).
        height: f64,
    },
    /// Directly set one element's rotation in radians.
    SetRotation {
        /// Target id.
        id: String,
        /// Rotation in radians.
        rotation: f64,
    },
    /// Apply a scalar style patch to many elements as one undo step.
    SetStyle {
        /// Ids to style.
        ids: Vec<String>,
        /// Scalar patch (see [`StylePatchJson`]).
        patch: StylePatchJson,
    },
    /// Set the lock flag on elements as one undo step.
    SetLocked {
        /// Ids to update.
        ids: Vec<String>,
        /// Flag value to write.
        locked: bool,
    },
    /// Replace the z-order vector as one undo step.
    Reorder {
        /// New z-order, back-to-front.
        order: Vec<String>,
    },
    /// Tag elements with a fresh group id as one undo step.
    Group {
        /// Ids to group.
        ids: Vec<String>,
    },
    /// Strip a group id as one undo step.
    Ungroup {
        /// Group id to strip.
        #[serde(rename = "groupId")]
        group_id: String,
    },
    /// Replace the engine-side selection (session state, no history).
    Select {
        /// Selected ids.
        ids: Vec<String>,
    },
    /// Set the active tool id (session state, no history).
    SetTool {
        /// Tool id (unknown ids are kept verbatim as custom tools).
        tool: String,
    },
    /// Copy elements into the instance clipboard buffer.
    Copy {
        /// Ids to buffer.
        ids: Vec<String>,
    },
    /// Paste the buffer as one undo step (fresh ids, cascade offset).
    Paste {
        /// Optional scene-space paste target (defaults to cascade).
        target: Option<PointJson>,
    },
    /// Duplicate elements as one undo step (no buffer touch).
    Duplicate {
        /// Ids to duplicate.
        ids: Vec<String>,
    },
    /// Copy plus soft-delete as one undo step.
    Cut {
        /// Ids to cut.
        ids: Vec<String>,
    },
    /// Nudge the current selection by a scene-space delta.
    Nudge {
        /// Scene-space delta x.
        dx: f64,
        /// Scene-space delta y.
        dy: f64,
    },
    /// Delete the current selection as one undo step.
    DeleteSelected,
    /// Undo one history entry.
    Undo,
    /// Redo one history entry.
    Redo,
    /// Replace document content from a scene object (same shape and
    /// validation as file import).
    ImportScene {
        /// Scene object (`{ schemaVersion, elements, elementOrder }`).
        scene: Value,
        /// `true` records one undo entry; `false` replaces without history.
        #[serde(default)]
        tracked: bool,
    },
    /// Export the document to its scene-JSON string (returned in `data`).
    ExportScene,
    /// Pointer pressed (screen px — the host translates DOM coordinates;
    /// double-click detection stays host-side and arrives as `clickCount`).
    PointerDown {
        /// Screen x in pixels.
        x: f64,
        /// Screen y in pixels.
        y: f64,
        /// `"left"`, `"middle"`, or `"right"` (touch counts as left).
        button: String,
        /// Modifiers held.
        #[serde(default)]
        modifiers: ModifiersJson,
        /// Host-detected click count (TS: within 400 ms and 5 px).
        #[serde(default = "default_click_count", rename = "clickCount")]
        click_count: u32,
    },
    /// Pointer moved (screen px plus current modifiers).
    PointerMove {
        /// Screen x in pixels.
        x: f64,
        /// Screen y in pixels.
        y: f64,
        /// Modifiers held.
        #[serde(default)]
        modifiers: ModifiersJson,
    },
    /// Pointer released.
    PointerUp {
        /// Screen x in pixels.
        x: f64,
        /// Screen y in pixels.
        y: f64,
        /// `"left"`, `"middle"`, or `"right"`.
        button: String,
        /// Modifiers held.
        #[serde(default)]
        modifiers: ModifiersJson,
    },
    /// Pointer stream aborted (touch interruption, browser gesture).
    PointerCancel,
    /// Key pressed (never forwarded for IME-composing or field-owned keys —
    /// the host owns focus guards; see module 07).
    KeyDown {
        /// Host `KeyboardEvent.key` value (`"Delete"`, `"a"`, …).
        key: String,
        /// Modifiers held.
        #[serde(default)]
        modifiers: ModifiersJson,
    },
    /// Mouse-wheel event (deltas in screen pixels; `zoomGesture` = Ctrl/Cmd
    /// held, i.e. pinch-zoom rather than scroll).
    Wheel {
        /// Horizontal scroll delta in pixels.
        dx: f64,
        /// Vertical scroll delta in pixels.
        dy: f64,
        /// True when Ctrl/Cmd is held (zoom gesture, not scroll).
        #[serde(default, rename = "zoomGesture")]
        zoom_gesture: bool,
        /// Screen x of the cursor (zoom anchor).
        x: f64,
        /// Screen y of the cursor (zoom anchor).
        y: f64,
    },
    /// Start text editing at a scene point (reopens the topmost text
    /// element under the point, else creates one as one history entry).
    StartTextAt {
        /// Scene-space x.
        x: f64,
        /// Scene-space y.
        y: f64,
    },
    /// Insert plain text at the caret (never forwarded mid-composition).
    TextInput {
        /// Text to insert at the caret.
        text: String,
    },
    /// Delete the char before the caret (Backspace inside the session).
    /// Errors without an active session; no-op at the start or
    /// mid-composition (Phase 12: `keyDown` never reaches the draft while
    /// editing, so hosts forward Backspace explicitly here).
    TextBackspace,
    /// Delete the char after the caret (Delete inside the session).
    /// Errors without an active session; no-op at the end or
    /// mid-composition.
    TextDelete,
    /// Move the caret to a char index into the draft (clamped to the
    /// draft length, returned in `data.caret`). Errors without an active
    /// session. Hosts sync their native selection through this after
    /// arrow-key or pointer caret motion.
    TextSetCaret {
        /// Desired caret as a char index into the draft.
        caret: usize,
    },
    /// IME composition started on the active session.
    CompositionStart,
    /// Intermediate IME update (buffered only, never finalizes text).
    CompositionUpdate {
        /// Current composition buffer.
        buffer: String,
    },
    /// IME composition ended (the final string merges at the caret).
    CompositionEnd {
        /// Final composed string.
        #[serde(rename = "finalText")]
        final_text: String,
    },
    /// Commit the active text session (trim + delete-when-empty +
    /// deterministic fallback sizing — see `Engine` docs).
    CommitText,
    /// Cancel the active text session (no document change, TS parity).
    CancelText,
    /// Move elements to the front as one undo step (TS `bringToFront`).
    BringToFront {
        /// Ids to move (unknown ids ignored, relative order kept).
        ids: Vec<String>,
    },
    /// Move elements to the back as one undo step (TS `sendToBack`).
    SendToBack {
        /// Ids to move.
        ids: Vec<String>,
    },
    /// Move elements forward by one step as one undo step.
    BringForward {
        /// Ids to move (consecutive selections move as a block, TS parity).
        ids: Vec<String>,
    },
    /// Move elements backward by one step as one undo step.
    SendBackward {
        /// Ids to move.
        ids: Vec<String>,
    },
    /// Align elements to one edge (or center) of their combined bounds as
    /// one undo step (TS `alignment.ts` parity).
    Align {
        /// Ids to align.
        ids: Vec<String>,
        /// One of `"left"`, `"right"`, `"top"`, `"bottom"`,
        /// `"centerH"`, `"centerV"`.
        mode: String,
    },
    /// Distribute elements with equal gaps along one axis as one undo step
    /// (outer elements stay fixed; fewer than 3 valid elements is a no-op).
    Distribute {
        /// Ids to distribute.
        ids: Vec<String>,
        /// `"horizontal"` or `"vertical"`.
        axis: String,
    },
    /// Run a frame's auto-layout config as one undo step (child constraints
    /// ignored while layout runs; non-frames and frames without config are
    /// no-ops).
    ApplyAutoLayout {
        /// Frame id whose config runs.
        #[serde(rename = "frameId")]
        frame_id: String,
    },
    /// Proportionally rescale a multi-selection from `original` to `next`
    /// combined bounds as one undo step (TS multi-select resize parity).
    ResizeSelection {
        /// Elements to scale.
        ids: Vec<String>,
        /// Combined bounds before the drag.
        original: BoundsJson,
        /// Combined bounds after the drag.
        next: BoundsJson,
    },
    /// Start a pen session for multi-click path creation.
    PenBegin,
    /// Click a pen anchor at a scene point (returns `closed: true` when the
    /// click closes the path).
    PenClick {
        /// Scene-space x.
        x: f64,
        /// Scene-space y.
        y: f64,
    },
    /// Drag the last pen anchor's Bezier handles (symmetric unless
    /// `altBreak` holds Alt independent-handle behavior).
    PenDragHandle {
        /// Scene-space x.
        x: f64,
        /// Scene-space y.
        y: f64,
        /// Alt held (break handle symmetry).
        #[serde(default, rename = "altBreak")]
        alt_break: bool,
    },
    /// Commit the pen session as one history entry (returns the new path
    /// id, or `committed: false` when fewer than 2 anchors exist).
    PenCommit,
    /// Cancel the pen session with no document effect.
    PenCancel,
    /// Start a crop session over an image element.
    CropStart {
        /// Target image element id.
        id: String,
    },
    /// Drag the crop session's handle to natural-pixel coordinates.
    CropDrag {
        /// Handle name (`"top-left"`, `"top"`, `"top-right"`, `"right"`,
        /// `"bottom-right"`, `"bottom"`, `"bottom-left"`, `"left"`).
        handle: String,
        /// Natural-pixel x.
        x: f64,
        /// Natural-pixel y.
        y: f64,
    },
    /// Commit the crop session as one history entry (full-image commits
    /// store `None`).
    CropCommit,
    /// Cancel the crop session with no document effect.
    CropCancel,
    /// Start a path-edit session over a path element.
    PathEditBegin {
        /// Target path element id.
        id: String,
    },
    /// Press at a scene point during path editing (returns the press kind:
    /// `"anchor"`, `"handle"`, `"add"`, `"delete"`, `"none"`).
    PathEditPress {
        /// Scene-space x.
        x: f64,
        /// Scene-space y.
        y: f64,
        /// Current zoom (hit radii are zoom-normalized).
        #[serde(default = "default_zoom")]
        zoom: f64,
        /// Alt held (delete anchor instead of dragging).
        #[serde(default)]
        alt: bool,
    },
    /// Drag the active path-edit target (Alt breaks handle symmetry).
    PathEditDrag {
        /// Scene-space x.
        x: f64,
        /// Scene-space y.
        y: f64,
        /// Alt held (break handle symmetry).
        #[serde(default, rename = "altBreak")]
        alt_break: bool,
    },
    /// Release the active path-edit drag (no document effect yet).
    PathEditRelease,
    /// Commit the path-edit session as one history entry.
    PathEditCommit,
    /// Cancel the path-edit session with no document effect.
    PathEditCancel,
    /// Replace the viewport (host-driven presets/restores; per-move
    /// streaming stays in pointer/wheel ops). Zoom clamps to `0.1–10`.
    SetViewport {
        /// New viewport state.
        #[serde(flatten)]
        viewport: ViewportJson,
    },
    /// Fit content into the canvas as one session change (no history).
    /// `ids` restricts to a selection; absent fits all visible content.
    /// Padding is scene units on every side.
    FitViewport {
        /// Canvas width in screen pixels.
        #[serde(rename = "canvasWidth")]
        canvas_width: f64,
        /// Canvas height in screen pixels.
        #[serde(rename = "canvasHeight")]
        canvas_height: f64,
        /// Padding in scene units (default 0).
        #[serde(default)]
        padding: f64,
        /// Selection to frame (default all visible content).
        #[serde(default)]
        ids: Option<Vec<String>>,
    },
    /// Fill the canvas with content as one session change (no history):
    /// like `fitViewport`, but content covers the canvas (edges may crop).
    FillViewport {
        /// Canvas width in screen pixels.
        #[serde(rename = "canvasWidth")]
        canvas_width: f64,
        /// Canvas height in screen pixels.
        #[serde(rename = "canvasHeight")]
        canvas_height: f64,
        /// Padding in scene units (default 0).
        #[serde(default)]
        padding: f64,
        /// Selection to frame (default all visible content).
        #[serde(default)]
        ids: Option<Vec<String>>,
    },
    /// Propagate host configuration: tool allow-list, theme override, snap
    /// config. Absent fields are unchanged; `enabledTools: null` clears the
    /// allow-list (every tool allowed, TS default).
    Configure {
        /// Tool allow-list update (`None` = unchanged).
        #[serde(
            default,
            deserialize_with = "deserialize_some",
            rename = "enabledTools"
        )]
        enabled_tools: Option<Option<Vec<String>>>,
        /// Partial theme override (merged over the current theme).
        #[serde(default)]
        theme: Box<Option<ThemeOverrideJson>>,
        /// Partial snap-config update (merged over the current config).
        #[serde(default)]
        snap: Box<Option<SnapConfigJson>>,
    },
    /// Tell the engine async asset availability changed (image/font load
    /// completed). Bumps the asset generation — the explicit invalidation
    /// root hosts include in the next `renderModel` query (module 06).
    NotifyAssetsChanged,
    /// Build the deterministic render model for the host canvas
    /// (returned in `data`; document render + selection overlay +
    /// interaction hints — the host draws, core never touches canvas).
    RenderModel {
        /// Query parameters (canvas size, grid hint, ready assets).
        #[serde(flatten)]
        query: RenderQueryJson,
    },
    /// Ask core which context-menu intents apply to the current selection
    /// (returned in `data`; the host renders the menu — module 07).
    ContextMenu,
    /// Drain queued normalized engine events, oldest first (returned in
    /// `data`; the queue clears — React subscribes by draining per frame).
    DrainEvents,
    /// Read-only move preview for host live rendering: the snapped delta
    /// and guides for a drag without touching the document or history
    /// (the commit path reuses the same math, so preview and commit agree).
    PreviewMove {
        /// Elements the drag moves (unknown/deleted/locked filter exactly
        /// like the commit path).
        ids: Vec<String>,
        /// Drag start in scene coordinates.
        from: PointJson,
        /// Current pointer in scene coordinates.
        to: PointJson,
        /// Shift held at the latest move (dominant-axis lock).
        #[serde(default, rename = "axisLock")]
        axis_lock: bool,
    },
    /// Read-only resize preview: the box a handle drag would commit,
    /// without touching the document or history.
    PreviewResize {
        /// Element being resized.
        id: String,
        /// Dragged handle in TS kebab-case (`"top-left"`, …).
        handle: String,
        /// Current pointer in scene coordinates.
        x: f64,
        /// Current pointer in scene coordinates.
        y: f64,
        /// Aspect-lock flag (Shift held).
        #[serde(default, rename = "lockAspect")]
        lock_aspect: bool,
    },
    /// Read-only rotation preview: the angle a rotate drag would commit,
    /// without touching the document or history.
    PreviewRotate {
        /// Element being rotated.
        id: String,
        /// Pointer position at gesture start, in scene coordinates.
        anchor: PointJson,
        /// Current pointer position, in scene coordinates.
        current: PointJson,
        /// Snap flag (Shift held → 15° increments).
        #[serde(default)]
        snap: bool,
    },
    /// Snapshot the host-visible session (selection, tool, viewport, text
    /// state, pointer phase, undo/redo, allow-list — returned in `data`).
    SessionState,
    /// Execute a registered plugin command by id as one undo step.
    /// Unknown ids are a per-op `notFound` error that changes nothing.
    /// Plugin registration itself is native (Rust objects never cross the
    /// JSON boundary); this op is the dynamic-dispatch half of the command
    /// system (`plugin.execute`), additive to protocol v1.
    ExecuteCommand {
        /// Plugin command id (e.g. `"acme.sticker.create"`).
        #[serde(rename = "commandId")]
        command_id: String,
    },
    /// Boolean union of two rectangles as one undo step (inputs consumed,
    /// exact disjoint cover created with the first input's style).
    BooleanUnion {
        /// Exactly two element ids.
        ids: Vec<String>,
    },
    /// Boolean subtraction (first minus second) as one undo step.
    BooleanSubtract {
        /// Exactly two element ids.
        ids: Vec<String>,
    },
    /// Boolean intersection of two rectangles as one undo step.
    BooleanIntersect {
        /// Exactly two element ids.
        ids: Vec<String>,
    },
    /// Boolean exclusion (symmetric difference) as one undo step.
    BooleanExclude {
        /// Exactly two element ids.
        ids: Vec<String>,
    },
}

/// Modifier keys for an input op (host translates DOM `shiftKey`/`altKey`/
/// `ctrlKey || metaKey` here — core never hard-codes an OS modifier name).
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifiersJson {
    /// Shift key held.
    #[serde(default)]
    pub shift: bool,
    /// Alt/Option key held.
    #[serde(default)]
    pub alt: bool,
    /// Ctrl (Win/Linux) or Cmd (macOS) held.
    #[serde(default)]
    pub ctrl_or_cmd: bool,
}

/// Viewport shape (`scrollX/scrollY` scene units, `zoom` factor).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportJson {
    /// Horizontal scroll offset in scene units.
    pub scroll_x: f64,
    /// Vertical scroll offset in scene units.
    pub scroll_y: f64,
    /// Zoom factor (clamped to `0.1–10` like TS on write).
    pub zoom: f64,
}

/// Partial theme colors override (every field optional, TS parity).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColorsOverrideJson {
    /// Canvas background color.
    pub canvas_background: Option<String>,
    /// Selection outline color.
    pub selection_outline: Option<String>,
    /// Resize handle fill color.
    pub handle_fill: Option<String>,
    /// Resize handle stroke color.
    pub handle_stroke: Option<String>,
    /// Rubber-band selection fill.
    pub rubber_band_fill: Option<String>,
    /// Rubber-band selection border color.
    pub rubber_band_stroke: Option<String>,
    /// Grid line color.
    pub grid_line: Option<String>,
    /// Out-of-bounds overlay color (bounded canvas mode).
    pub canvas_out_of_bounds_overlay: Option<String>,
    /// Canvas bounds border color (bounded canvas mode).
    pub canvas_bounds_border: Option<String>,
}

/// Partial theme fonts override.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFontsOverrideJson {
    /// Default font family.
    pub family: Option<String>,
    /// Families offered by the font picker.
    pub available_families: Option<Vec<String>>,
}

/// Partial theme sizes override.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSizesOverrideJson {
    /// Resize handle size in px.
    pub handle_size: Option<f64>,
    /// Rotate handle circle radius in px.
    pub rotate_handle_radius: Option<f64>,
    /// Distance from selection-box top edge to the rotate handle in px.
    pub rotate_handle_offset: Option<f64>,
    /// Selection outline stroke width in px.
    pub selection_outline_width: Option<f64>,
    /// Rotate handle connector line width in px.
    pub rotate_handle_line_width: Option<f64>,
    /// Resize handle stroke width in px.
    pub handle_line_width: Option<f64>,
    /// Bounding-box hit-test threshold in px.
    pub bounding_box_hit_threshold: Option<f64>,
}

/// Partial theme corner-radius override.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeBorderRadiusOverrideJson {
    /// Resize handle radius.
    pub handle: Option<f64>,
    /// UI panel radius.
    pub panel: Option<f64>,
}

/// Developer-supplied partial theme (TS `ThemeOverride` parity).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeOverrideJson {
    /// Color overrides.
    pub colors: Option<ThemeColorsOverrideJson>,
    /// Font overrides.
    pub fonts: Option<ThemeFontsOverrideJson>,
    /// Size overrides.
    pub sizes: Option<ThemeSizesOverrideJson>,
    /// Corner-radius overrides.
    pub border_radius: Option<ThemeBorderRadiusOverrideJson>,
}

/// Partial snap-config update (absent fields keep their current value).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapConfigJson {
    /// Grid spacing in scene units.
    pub grid_size: Option<f64>,
    /// Whether snap-to-grid is enabled.
    pub snap_to_grid: Option<bool>,
    /// Whether the host paints the background grid (host hint, no math).
    pub show_grid: Option<bool>,
    /// Whether snap-to-object is enabled.
    pub snap_to_objects: Option<bool>,
    /// Snap threshold in screen px (zoom-normalized at call time).
    pub snap_threshold: Option<f64>,
}

/// Render-model query parameters (host canvas size + asset availability).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderQueryJson {
    /// Canvas width in screen pixels.
    pub canvas_width: f64,
    /// Canvas height in screen pixels.
    pub canvas_height: f64,
    /// Whether the host paints the background grid.
    #[serde(default)]
    pub show_grid: bool,
    /// Grid spacing in scene units (used only when `showGrid` is set).
    #[serde(default)]
    pub grid_size: Option<f64>,
    /// Asset ids whose pixels the host has cached (`Image` entries with
    /// other ids arrive as `ready: false` placeholders, TS parity).
    #[serde(default)]
    pub ready_images: Vec<String>,
}

/// Scalar style patch (v1).
///
/// Covers the scalar fields plus `background` fills: a plain-string
/// `background` sets a solid fill, a fill object parses through the shared
/// io fill parser (M4 fill-DTO phase — no duplicated parser, ADR-0010 note
/// retired).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylePatchJson {
    /// New stroke color (CSS string).
    pub stroke_color: Option<String>,
    /// New stroke width.
    pub stroke_width: Option<f64>,
    /// New dash pattern (`"solid"`, `"dashed"`, `"dotted"`).
    pub stroke_style: Option<String>,
    /// New opacity (`0–100`, clamped like TS).
    pub opacity: Option<f64>,
    /// New background: a plain string sets a solid fill, a fill object
    /// (`{"type":"solid"|"gradient", …}`) parses through the shared io
    /// fill parser (same validation as file import).
    pub background: Option<Value>,
}

/// Scene-space point for paste targets.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct PointJson {
    /// Scene-space x.
    pub x: f64,
    /// Scene-space y.
    pub y: f64,
}

/// Scene-space bounds for multi-select resize (`minX/minY/maxX/maxY`).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundsJson {
    /// Minimum x.
    #[serde(rename = "minX")]
    pub min_x: f64,
    /// Minimum y.
    #[serde(rename = "minY")]
    pub min_y: f64,
    /// Maximum x.
    #[serde(rename = "maxX")]
    pub max_x: f64,
    /// Maximum y.
    #[serde(rename = "maxY")]
    pub max_y: f64,
}

/// PNG export options (all fields optional, TS defaults apply).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngOptionsJson {
    /// Canvas background (`"transparent"` leaves alpha untouched).
    pub background: Option<String>,
    /// Padding around content bounds in scene units.
    pub padding: Option<f64>,
    /// Resolution scale factor.
    pub scale: Option<f64>,
}

/// JPEG export options (all fields optional; JPEG defaults apply).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JpegOptionsJson {
    /// Canvas background (`"transparent"` resolves to white — no alpha).
    pub background: Option<String>,
    /// Padding around content bounds in scene units.
    pub padding: Option<f64>,
    /// Resolution scale factor.
    pub scale: Option<f64>,
    /// Quality hint 1–100 (clamped, default 90).
    pub quality: Option<u8>,
}

/// WebP export options (all fields optional; WebP defaults apply).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebpOptionsJson {
    /// Canvas background (`"transparent"` leaves alpha untouched).
    pub background: Option<String>,
    /// Padding around content bounds in scene units.
    pub padding: Option<f64>,
    /// Resolution scale factor.
    pub scale: Option<f64>,
    /// Quality hint 1–100 for lossy encoding (clamped, default 90).
    pub quality: Option<u8>,
    /// Lossless encoding hint (default false).
    pub lossless: Option<bool>,
}

/// Default host click count (single click) when the field is absent.
fn default_click_count() -> u32 {
    1
}

/// Default zoom for path-edit presses when the field is absent.
fn default_zoom() -> f64 {
    1.0
}

/// Three-state optional-field deserializer for `Configure.enabledTools`:
/// absent means unchanged, `null` clears the allow-list, an array sets it.
/// (Plain `Option<Option<T>>` would collapse `null` into absent.)
fn deserialize_some<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    serde::Deserialize::deserialize(deserializer).map(Some)
}

/// Per-op outcome inside a [`BatchResult`].
#[derive(Debug, Clone, Serialize)]
pub struct OpResult {
    /// Op name as sent (`"create"`, `"move"`, …, `"<parse>"` never
    /// appears here — whole-batch parse failures use [`ErrorEnvelope`]).
    pub op: String,
    /// Whether the op applied.
    pub ok: bool,
    /// Machine-readable failure code (absent on success).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Human-readable failure detail (absent on success).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Op result payload (shape depends on `op`, absent when empty).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Structured result of one [`apply_batch`](crate::Engine::apply_batch)
/// crossing: every op reports individually, so one bad op never hides
/// the rest. Each op is individually atomic; the batch itself is NOT a
/// transaction (documented, not incidental).
#[derive(Debug, Clone, Serialize)]
pub struct BatchResult {
    /// [`PROTOCOL_VERSION`] echo for skew detection.
    pub version: u32,
    /// Number of ops with `ok: true`.
    pub applied: usize,
    /// Per-op outcomes in request order.
    pub results: Vec<OpResult>,
}

/// Top-level failure envelope for whole-crossing failures (unparseable
/// batch JSON, unknown `op`, unparseable clipboard payload, …).
/// Per-op failures never use this shape — they live in [`BatchResult`].
#[derive(Debug, Clone, Serialize)]
pub struct ErrorEnvelope {
    /// Always `false`.
    pub ok: bool,
    /// Machine-readable code (`"parseError"`, `"unsupported"`, or an
    /// [`engine_error_code`] value).
    pub code: String,
    /// Human-readable detail.
    pub message: String,
    /// [`PROTOCOL_VERSION`] echo for skew detection.
    pub version: u32,
}

/// Whitelisted engine snapshot for hosts (render-loop dirty checks,
/// toolbar undo/redo state, selection/tool/viewport/session mirrors).
///
/// Deliberately small: hosts batch mutations through
/// `apply_batch` and read this — there is no per-element getter loop
/// (module 09 anti-pattern).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// Bindings crate version.
    pub bindings_version: String,
    /// [`PROTOCOL_VERSION`] echo for skew detection.
    pub protocol_version: u32,
    /// Scene schema version the engine reads/writes.
    pub schema_version: u32,
    /// Live (non-deleted) element count.
    pub element_count: usize,
    /// Document nonce (bump = re-render / re-query).
    pub scene_nonce: u64,
    /// Whether `undo` would do anything.
    pub can_undo: bool,
    /// Whether `redo` would do anything.
    pub can_redo: bool,
    /// Undo stack depth.
    pub undo_len: usize,
    /// Redo stack depth.
    pub redo_len: usize,
    /// Engine-side selection mirror.
    pub selection: Vec<String>,
    /// Active tool id.
    pub tool: String,
    /// Full z-order (back-to-front, including tombstone ids — same
    /// convention as the export envelope).
    pub order: Vec<String>,
    /// Current viewport (scroll + zoom, TS `Viewport` parity).
    pub viewport: ViewportStatusJson,
    /// Id of the element under text edit, if any.
    pub text_editing: Option<String>,
    /// Pointer-machine phase (`"idle"`, `"pressed"`, `"dragging"`,
    /// `"rubberBand"`, `"drawing"`, `"panning"`).
    pub pointer_phase: String,
    /// Asset generation (bumped by `notifyAssetsChanged`; hosts echo it
    /// in `renderModel` so equal inputs build identical models).
    pub asset_generation: u64,
    /// Whether a pen session is active.
    pub pen_active: bool,
    /// Image element id under crop, if any.
    pub cropping: Option<String>,
    /// Path element id under edit, if any.
    pub path_editing: Option<String>,
}

/// Viewport half of [`EngineStatus`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportStatusJson {
    /// Horizontal scroll offset in scene units.
    pub scroll_x: f64,
    /// Vertical scroll offset in scene units.
    pub scroll_y: f64,
    /// Zoom factor.
    pub zoom: f64,
}

/// Maps an [`EngineError`] to its wire code.
pub fn engine_error_code(err: &EngineError) -> &'static str {
    match err {
        EngineError::InvalidInput(_) => "invalidInput",
        EngineError::NotFound(_) => "notFound",
        EngineError::InvariantViolation(_) => "invariantViolation",
        EngineError::Unsupported(_) => "unsupported",
        _ => "engineError",
    }
}

/// Builds a successful per-op result.
pub fn ok_result(op: impl Into<String>, data: Option<Value>) -> OpResult {
    OpResult {
        op: op.into(),
        ok: true,
        code: None,
        message: None,
        data,
    }
}

/// Builds a failed per-op result from an engine error.
pub fn err_result(op: impl Into<String>, err: &EngineError) -> OpResult {
    let message = err.to_string();
    OpResult {
        op: op.into(),
        ok: false,
        code: Some(engine_error_code(err).to_string()),
        message: Some(message),
        data: None,
    }
}

/// Builds a failed per-op result for boundary-level (non-engine) errors.
pub fn unsupported_result(op: impl Into<String>, message: impl Into<String>) -> OpResult {
    OpResult {
        op: op.into(),
        ok: false,
        code: Some("unsupported".to_string()),
        message: Some(message.into()),
        data: None,
    }
}

/// Serializes a whole-crossing failure envelope (never panics: the
/// fallback is a static literal for the same failure).
pub fn error_envelope(code: &str, message: &str) -> String {
    let envelope = ErrorEnvelope {
        ok: false,
        code: code.to_string(),
        message: message.to_string(),
        version: PROTOCOL_VERSION,
    };
    serde_json::to_string(&envelope)
        .unwrap_or_else(|_| r#"{"ok":false,"code":"serializeError","message":"failed to serialize error envelope","version":1}"#.to_string())
}

/// Extracts the discriminant name of a [`BatchOp`] for result labeling.
pub fn op_name(op: &BatchOp) -> &'static str {
    match op {
        BatchOp::Create { .. } => "create",
        BatchOp::Delete { .. } => "delete",
        BatchOp::Move { .. } => "move",
        BatchOp::SetBounds { .. } => "setBounds",
        BatchOp::SetRotation { .. } => "setRotation",
        BatchOp::SetStyle { .. } => "setStyle",
        BatchOp::SetLocked { .. } => "setLocked",
        BatchOp::Reorder { .. } => "reorder",
        BatchOp::Group { .. } => "group",
        BatchOp::Ungroup { .. } => "ungroup",
        BatchOp::Select { .. } => "select",
        BatchOp::SetTool { .. } => "setTool",
        BatchOp::Copy { .. } => "copy",
        BatchOp::Paste { .. } => "paste",
        BatchOp::Duplicate { .. } => "duplicate",
        BatchOp::Cut { .. } => "cut",
        BatchOp::Nudge { .. } => "nudge",
        BatchOp::DeleteSelected => "deleteSelected",
        BatchOp::Undo => "undo",
        BatchOp::Redo => "redo",
        BatchOp::ImportScene { .. } => "importScene",
        BatchOp::ExportScene => "exportScene",
        BatchOp::PointerDown { .. } => "pointerDown",
        BatchOp::PointerMove { .. } => "pointerMove",
        BatchOp::PointerUp { .. } => "pointerUp",
        BatchOp::PointerCancel => "pointerCancel",
        BatchOp::KeyDown { .. } => "keyDown",
        BatchOp::Wheel { .. } => "wheel",
        BatchOp::StartTextAt { .. } => "startTextAt",
        BatchOp::TextInput { .. } => "textInput",
        BatchOp::TextBackspace => "textBackspace",
        BatchOp::TextDelete => "textDelete",
        BatchOp::TextSetCaret { .. } => "textSetCaret",
        BatchOp::CompositionStart => "compositionStart",
        BatchOp::CompositionUpdate { .. } => "compositionUpdate",
        BatchOp::CompositionEnd { .. } => "compositionEnd",
        BatchOp::CommitText => "commitText",
        BatchOp::CancelText => "cancelText",
        BatchOp::BringToFront { .. } => "bringToFront",
        BatchOp::SendToBack { .. } => "sendToBack",
        BatchOp::BringForward { .. } => "bringForward",
        BatchOp::SendBackward { .. } => "sendBackward",
        BatchOp::Align { .. } => "align",
        BatchOp::Distribute { .. } => "distribute",
        BatchOp::ApplyAutoLayout { .. } => "applyAutoLayout",
        BatchOp::ResizeSelection { .. } => "resizeSelection",
        BatchOp::PenBegin => "penBegin",
        BatchOp::PenClick { .. } => "penClick",
        BatchOp::PenDragHandle { .. } => "penDragHandle",
        BatchOp::PenCommit => "penCommit",
        BatchOp::PenCancel => "penCancel",
        BatchOp::CropStart { .. } => "cropStart",
        BatchOp::CropDrag { .. } => "cropDrag",
        BatchOp::CropCommit => "cropCommit",
        BatchOp::CropCancel => "cropCancel",
        BatchOp::PathEditBegin { .. } => "pathEditBegin",
        BatchOp::PathEditPress { .. } => "pathEditPress",
        BatchOp::PathEditDrag { .. } => "pathEditDrag",
        BatchOp::PathEditRelease => "pathEditRelease",
        BatchOp::PathEditCommit => "pathEditCommit",
        BatchOp::PathEditCancel => "pathEditCancel",
        BatchOp::SetViewport { .. } => "setViewport",
        BatchOp::FitViewport { .. } => "fitViewport",
        BatchOp::FillViewport { .. } => "fillViewport",
        BatchOp::Configure { .. } => "configure",
        BatchOp::NotifyAssetsChanged => "notifyAssetsChanged",
        BatchOp::RenderModel { .. } => "renderModel",
        BatchOp::PreviewMove { .. } => "previewMove",
        BatchOp::PreviewResize { .. } => "previewResize",
        BatchOp::PreviewRotate { .. } => "previewRotate",
        BatchOp::ContextMenu => "contextMenu",
        BatchOp::DrainEvents => "drainEvents",
        BatchOp::SessionState => "sessionState",
        BatchOp::ExecuteCommand { .. } => "executeCommand",
        BatchOp::BooleanUnion { .. } => "booleanUnion",
        BatchOp::BooleanSubtract { .. } => "booleanSubtract",
        BatchOp::BooleanIntersect { .. } => "booleanIntersect",
        BatchOp::BooleanExclude { .. } => "booleanExclude",
    }
}
