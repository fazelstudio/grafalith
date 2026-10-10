//! Element model: `BaseElement` + concrete variants + style unions.
//!
//! TS sources: `packages/core/src/scene/types.ts` (the `BaseElement` freeze
//! zone — `AGENTS.md` forbids changing it without explicit approval) plus
//! per-type factory defaults in `packages/core/src/scene/create-element.ts`.
//!
//! Field-for-field parity with the TS contract: `id`, scene-space
//! scene-space `x/y/width/height`, `rotation` (radians about the center),
//! stroke/fill style, `opacity`, `seed`, `version` + `versionNonce`,
//! `isDeleted`, `groupIds` (innermost-first), `locked`, `hidden`, `frameId`,
//! `constraints`, `childLayoutSizing`, and per-type extras (points,
//! bindings, text, pressures, crop, segments, component refs).
//!
//! Elements are plain data: `struct`s + one closed [`Element`] enum, never
//! classes. Behavior (bounds here; hit-test/render elsewhere) is free
//! functions that take elements, never inherent behavior on the data —
//! ARCHITECTURE §1. The `Element` union is closed over ten built-in
//! variants; custom shape *data* arrives through the extensible shape
//! system, with name reservation in the instance-scoped
//! [`crate::shape_registry`]. Mutation of a stored element goes through
//! [`crate::document::Document`] only: external code sees shared references,
//! and `base_mut` is `pub(crate)` so operation modules can build the next
//! version of an element before handing it to `upsert`.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::fmt;

use grafalith_geometry::{points_are_finite, rotated_bounds, Bounds, Point};

use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/// Stable element identity, mirroring the TS engine: never an array index
/// (z-order lives in the document's explicit order vector, not in the id);
/// duplication and paste mint fresh ids; group ids share this type — stable
/// identities in the same namespace family (never element ids, never
/// indexes).
///
/// `ElementId` is a plain wrapper: emptiness is rejected by element and
/// document validation (mirroring TS import validation), not by
/// construction, so order vectors and lookup maps stay ergonomic.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ElementId(String);

impl ElementId {
    /// Wraps a raw id string.
    pub fn of(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Borrows the raw id string.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consumes the wrapper, returning the raw id string.
    pub fn into_string(self) -> String {
        self.0
    }
}

impl Borrow<str> for ElementId {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl AsRef<str> for ElementId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl From<&str> for ElementId {
    fn from(value: &str) -> Self {
        Self::of(value)
    }
}

impl fmt::Display for ElementId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Source of fresh identities, nonces, and seeds.
///
/// Injectable so tests are deterministic ([`CounterIdGenerator`]) while
/// production hosts supply UUID-style sources at the binding layer. Owned
/// by the [`crate::document::Document`] instance that consumes it — never a
/// process global.
///
/// `Send + Sync` is a hard bound: the Tauri host owns the engine behind
/// managed state, which requires `Send + Sync + 'static`. The bound is free
/// for all in-tree generators (plain-data counters) and for host generators
/// built from owned state.
pub trait IdGenerator: Send + Sync {
    /// Mints a fresh element id.
    fn new_element_id(&mut self) -> ElementId;
    /// Mints a fresh group id.
    fn new_group_id(&mut self) -> ElementId;
    /// Mints a fresh version nonce.
    fn new_nonce(&mut self) -> u32;
    /// Mints a fresh render seed.
    fn new_seed(&mut self) -> u32;
}

/// Deterministic counter-based generator for tests and headless use.
///
/// Element ids are `el-1`, `el-2`, …; group ids `group-1`, …; nonces and
/// seeds count up from 1. Uniqueness holds within one generator instance;
/// hosts that merge documents from several generators must remap ids (the
/// same rule the TS clipboard/import paths follow).
#[derive(Debug)]
pub struct CounterIdGenerator {
    /// Prefix for element ids.
    element_prefix: String,
    /// Prefix for group ids.
    group_prefix: String,
    /// Next element counter value.
    next_element: u64,
    /// Next group counter value.
    next_group: u64,
    /// Next nonce/seed counter value.
    next_nonce: u32,
}

impl CounterIdGenerator {
    /// Creates a generator with default prefixes (`el`, `group`).
    pub fn new() -> Self {
        Self {
            element_prefix: "el".to_string(),
            group_prefix: "group".to_string(),
            next_element: 1,
            next_group: 1,
            next_nonce: 1,
        }
    }

    /// Creates a generator with custom id prefixes.
    pub fn with_prefixes(
        element_prefix: impl Into<String>,
        group_prefix: impl Into<String>,
    ) -> Self {
        Self {
            element_prefix: element_prefix.into(),
            group_prefix: group_prefix.into(),
            next_element: 1,
            next_group: 1,
            next_nonce: 1,
        }
    }
}

impl Default for CounterIdGenerator {
    fn default() -> Self {
        Self::new()
    }
}

impl IdGenerator for CounterIdGenerator {
    fn new_element_id(&mut self) -> ElementId {
        let id = ElementId::of(format!("{}-{}", self.element_prefix, self.next_element));
        self.next_element += 1;
        id
    }

    fn new_group_id(&mut self) -> ElementId {
        let id = ElementId::of(format!("{}-{}", self.group_prefix, self.next_group));
        self.next_group += 1;
        id
    }

    fn new_nonce(&mut self) -> u32 {
        let nonce = self.next_nonce;
        self.next_nonce = self.next_nonce.wrapping_add(1);
        nonce.max(1)
    }

    fn new_seed(&mut self) -> u32 {
        self.new_nonce()
    }
}

// ---------------------------------------------------------------------------
// Style primitives (persistent style data)
// ---------------------------------------------------------------------------

/// Stroke dash pattern. Persistent element data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrokeStyle {
    /// Solid stroke.
    Solid,
    /// Dashed stroke.
    Dashed,
    /// Dotted stroke.
    Dotted,
}

/// Stroke cap style (line endpoints). Canvas defaults apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StrokeCap {
    /// Flat cap (canvas and TS default).
    #[default]
    Butt,
    /// Round cap.
    Round,
    /// Square cap.
    Square,
}

/// Stroke join style (polyline vertices). Canvas defaults apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StrokeJoin {
    /// Miter join (canvas and TS default).
    #[default]
    Miter,
    /// Round join.
    Round,
    /// Bevel join.
    Bevel,
}

/// Stroke alignment relative to the shape edge. Paint-time instruction
/// for hosts (like hatching): bounds and hit-testing stay fill-based, so
/// alignment never silently rescales geometry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StrokeAlign {
    /// Stroke inside the edge.
    Inside,
    /// Stroke centered on the edge (canvas and TS default).
    #[default]
    Center,
    /// Stroke outside the edge.
    Outside,
}

/// Fill hatching variant. Persistent element data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementFillStyle {
    /// Solid fill.
    Solid,
    /// Hand-drawn hachure fill.
    Hachure,
    /// Cross-hatch fill.
    CrossHatch,
}

/// Gradient interpolation shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GradientType {
    /// Linear gradient at `angle` degrees.
    Linear,
    /// Radial gradient.
    Radial,
    /// Angular (conic) gradient sweeping around the center.
    Angular,
}

/// One color stop of a gradient fill. `offset` follows the TS contract
/// (authored 0–1); only finiteness is enforced at validation.
#[derive(Debug, Clone, PartialEq)]
pub struct GradientStop {
    /// Stop offset.
    pub offset: f64,
    /// CSS color string.
    pub color: String,
}

/// Fill description. Persistent data only — never a canvas gradient object
/// (ARCHITECTURE §2.3); hosts resolve this to paint at render time.
#[derive(Debug, Clone, PartialEq)]
pub enum FillStyle {
    /// Flat color (`"transparent"` disables the fill pass, as in TS render).
    Solid {
        /// CSS color string.
        color: String,
    },
    /// Gradient fill.
    Gradient {
        /// Linear or radial interpolation.
        gradient_type: GradientType,
        /// Angle in degrees (linear gradients).
        angle: f64,
        /// Color stops.
        stops: Vec<GradientStop>,
    },
}

impl FillStyle {
    /// The default fill: solid transparent (mirrors TS `defaultFillStyle`).
    pub fn default_transparent() -> Self {
        Self::Solid {
            color: "transparent".to_string(),
        }
    }

    /// Validates nested gradient numbers (finite only, mirroring TS import).
    pub fn validate(&self) -> EngineResult<()> {
        if let Self::Gradient { angle, stops, .. } = self {
            finite(*angle, "backgroundColor.angle")?;
            for stop in stops {
                finite(stop.offset, "backgroundColor.stops[].offset")?;
            }
        }
        Ok(())
    }
}

/// Arrowhead marker type. `None` on the element means "no head".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrowheadType {
    /// Filled triangle.
    Arrow,
    /// Perpendicular bar.
    Bar,
    /// Filled dot.
    Dot,
}

/// Horizontal text alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextAlign {
    /// Left aligned.
    Left,
    /// Center aligned.
    Center,
    /// Right aligned.
    Right,
}

/// Frame-constraint anchor on one axis (Figma naming, TS `Constraints`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConstraintAnchor {
    /// Pin to the leading edge.
    Min,
    /// Pin to the trailing edge.
    Max,
    /// Keep centered.
    Center,
    /// Stretch with the frame.
    Stretch,
    /// Scale proportionally with the frame.
    Scale,
}

/// Constraint behavior of a frame child on resize.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Constraints {
    /// Horizontal behavior.
    pub horizontal: ConstraintAnchor,
    /// Vertical behavior.
    pub vertical: ConstraintAnchor,
}

/// Child sizing inside an auto-layout frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChildLayoutSizing {
    /// Keep the child's own size.
    Fixed,
    /// Expand to fill available space on the primary axis.
    Fill,
}

/// Crop region in natural image pixels (mirrors TS `CropRegion`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CropRegion {
    /// Left edge in natural pixels.
    pub x: f64,
    /// Top edge in natural pixels.
    pub y: f64,
    /// Width in natural pixels.
    pub width: f64,
    /// Height in natural pixels.
    pub height: f64,
}

impl CropRegion {
    /// Rejects non-finite coordinates (mirrors import strictness for floats).
    pub fn validate(&self) -> EngineResult<()> {
        finite(self.x, "crop.x")?;
        finite(self.y, "crop.y")?;
        finite(self.width, "crop.width")?;
        finite(self.height, "crop.height")?;
        Ok(())
    }
}

/// Arrow endpoint binding to another element (TS `Binding`).
#[derive(Debug, Clone, PartialEq)]
pub struct Binding {
    /// Bound target element id.
    pub element_id: ElementId,
    /// Relative position along the target edge (wraps in `[0, 1)`).
    pub focus: f64,
    /// Gap distance from the target element.
    pub gap: f64,
}

impl Binding {
    /// Rejects empty target ids and non-finite focus/gap.
    pub fn validate(&self) -> EngineResult<()> {
        if self.element_id.as_str().is_empty() {
            return Err(EngineError::InvalidInput(
                "binding.elementId must not be empty".to_string(),
            ));
        }
        finite(self.focus, "binding.focus")?;
        finite(self.gap, "binding.gap")?;
        Ok(())
    }
}

/// One vector-path anchor with optional relative Bezier handles
/// (TS `PathSegment`; handles are relative to the anchor).
#[derive(Debug, Clone, PartialEq)]
pub struct PathSegment {
    /// Anchor position, relative to the element origin.
    pub point: Point,
    /// Incoming control offset, or `None` for a sharp corner.
    pub handle_in: Option<Point>,
    /// Outgoing control offset, or `None` for a sharp corner.
    pub handle_out: Option<Point>,
}

impl PathSegment {
    /// Rejects non-finite anchors and handles.
    pub fn validate(&self) -> EngineResult<()> {
        if !crate::geometry::point_is_finite(&self.point) {
            return Err(EngineError::InvalidInput(
                "path segment point must be finite".to_string(),
            ));
        }
        for handle in [&self.handle_in, &self.handle_out].into_iter().flatten() {
            if !crate::geometry::point_is_finite(handle) {
                return Err(EngineError::InvalidInput(
                    "path segment handle must be finite".to_string(),
                ));
            }
        }
        Ok(())
    }
}

/// Auto-layout main-axis direction (persistent frame config).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutDirection {
    /// Children flow horizontally.
    Horizontal,
    /// Children flow vertically.
    Vertical,
}

/// Alignment along the primary (flow) axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrimaryAxisAlign {
    /// Pack at the start.
    Start,
    /// Pack at the center.
    Center,
    /// Pack at the end.
    End,
    /// Spread with equal gaps, pinning the outer children.
    SpaceBetween,
}

/// Alignment along the counter (cross) axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CounterAxisAlign {
    /// Pack at the start.
    Start,
    /// Pack at the center.
    Center,
    /// Pack at the end.
    End,
    /// Stretch children across the counter axis.
    Stretch,
}

/// Frame sizing mode under auto-layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameSizing {
    /// Frame resizes to fit children.
    Hug,
    /// Frame keeps its current size.
    Fixed,
}

/// Padding inside an auto-layout frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FramePadding {
    /// Top padding.
    pub top: f64,
    /// Right padding.
    pub right: f64,
    /// Bottom padding.
    pub bottom: f64,
    /// Left padding.
    pub left: f64,
}

/// Auto-layout configuration on a frame (TS `AutoLayoutConfig`). Pure
/// persistent data; constraints on children are ignored while this is set
/// (enforced by the layout pass).
#[derive(Debug, Clone, PartialEq)]
pub struct AutoLayoutConfig {
    /// Flow direction (primary axis).
    pub direction: LayoutDirection,
    /// Gap between children along the primary axis.
    pub gap: f64,
    /// Padding between frame edges and children.
    pub padding: FramePadding,
    /// Primary-axis distribution.
    pub primary_axis_align: PrimaryAxisAlign,
    /// Counter-axis alignment.
    pub counter_axis_align: CounterAxisAlign,
    /// Whether the frame hugs children or keeps its size.
    pub sizing: FrameSizing,
}

/// JSON-like override value for instance patches.
///
/// TS stores `overrides: Record<path, Partial<Element>>` — arbitrary
/// per-property patches applied at resolve time. This small value enum
/// stands in for untyped JSON (no serde on the element model); numbers are
/// validated finite so the no-NaN invariant holds through overrides too.
#[derive(Debug, Clone, PartialEq)]
pub enum PatchValue {
    /// Explicit null (clears a nullable property at resolve time).
    Null,
    /// Boolean property.
    Bool(bool),
    /// Numeric property (must be finite).
    Number(f64),
    /// String property.
    Text(String),
    /// Array property (e.g. points).
    Array(Vec<PatchValue>),
    /// Object property (e.g. backgroundColor, crop).
    Object(HashMap<String, PatchValue>),
}

impl PatchValue {
    /// Rejects non-finite numbers recursively.
    pub fn validate(&self) -> EngineResult<()> {
        match self {
            Self::Number(value) => finite(*value, "overrides patch number"),
            Self::Array(items) => {
                for item in items {
                    item.validate()?;
                }
                Ok(())
            }
            Self::Object(entries) => {
                for value in entries.values() {
                    value.validate()?;
                }
                Ok(())
            }
            Self::Null | Self::Bool(_) | Self::Text(_) => Ok(()),
        }
    }
}

// ---------------------------------------------------------------------------
// Base element + variants
// ---------------------------------------------------------------------------

/// Shared persistent fields of every element (TS `BaseElement`).
///
/// All positions are scene coordinates (ARCHITECTURE §3.5); conversion to
/// screen space happens only at render/input time. `version`/`version_nonce`
/// are owned by [`crate::document::Document`]: factories set the initial
/// values and `upsert` performs the authoritative bump — callers must not
/// pre-bump (TS `Scene.upsertElement` discipline).
#[derive(Debug, Clone, PartialEq)]
pub struct BaseElement {
    /// Stable identity.
    pub id: ElementId,
    /// Top-left x in scene coordinates.
    pub x: f64,
    /// Top-left y in scene coordinates.
    pub y: f64,
    /// Width in scene units.
    pub width: f64,
    /// Height in scene units.
    pub height: f64,
    /// Rotation in radians about the element center.
    pub rotation: f64,
    /// Stroke color (hex or `"transparent"`).
    pub stroke_color: String,
    /// Fill description (solid or gradient).
    pub background_color: FillStyle,
    /// Stroke width in scene units.
    pub stroke_width: f64,
    /// Stroke dash pattern.
    pub stroke_style: StrokeStyle,
    /// Stroke cap style.
    pub stroke_cap: StrokeCap,
    /// Stroke join style.
    pub stroke_join: StrokeJoin,
    /// Stroke alignment relative to the edge (paint-time only).
    pub stroke_align: StrokeAlign,
    /// Fill hatching variant.
    pub fill_style: ElementFillStyle,
    /// Opacity on the 0–100 scale (TS convention).
    pub opacity: f64,
    /// Render seed for hand-drawn styling.
    pub seed: u32,
    /// Mutation counter, bumped by the document on every stored change.
    pub version: u32,
    /// Fresh random-per-mutation marker for change detection without
    /// deep comparison.
    pub version_nonce: u32,
    /// Soft-delete flag (ARCHITECTURE §2.1); undo/history flip this back.
    pub is_deleted: bool,
    /// Group membership, innermost group first (outermost last).
    pub group_ids: Vec<ElementId>,
    /// Mutation guard (not a UI hint): locked elements are skipped by
    /// destructive paths.
    pub locked: bool,
    /// Visibility flag (PNG export skips hidden elements).
    pub hidden: bool,
    /// Parent frame id, or `None` for a free element.
    pub frame_id: Option<ElementId>,
    /// Resize behavior inside a non-auto-layout frame.
    pub constraints: Option<Constraints>,
    /// Sizing inside an auto-layout frame.
    pub child_layout_sizing: Option<ChildLayoutSizing>,
}

impl BaseElement {
    /// Validates intrinsic (single-element) invariants: non-empty id,
    /// finite transform and style numbers, non-empty group ids, and a valid
    /// fill style. Cross-element references (`frame_id`, bindings,
    /// `container_id`) are checked by [`crate::document::Document::validate`]
    /// instead, because multi-element operations (paste, import) build
    /// references incrementally.
    pub fn validate(&self) -> EngineResult<()> {
        if self.id.as_str().is_empty() {
            return Err(EngineError::InvalidInput(
                "element id must not be empty".to_string(),
            ));
        }
        finite(self.x, "x")?;
        finite(self.y, "y")?;
        finite(self.width, "width")?;
        finite(self.height, "height")?;
        finite(self.rotation, "rotation")?;
        finite(self.stroke_width, "strokeWidth")?;
        finite(self.opacity, "opacity")?;
        self.background_color.validate()?;
        for group_id in &self.group_ids {
            if group_id.as_str().is_empty() {
                return Err(EngineError::InvalidInput(
                    "groupIds must not contain empty ids".to_string(),
                ));
            }
        }
        Ok(())
    }
}

/// Rectangle element (`roundness` in scene units, `None` for sharp corners).
#[derive(Debug, Clone, PartialEq)]
pub struct RectangleElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Corner radius, or `None` for sharp corners.
    pub roundness: Option<f64>,
    /// Per-corner radii. Wins over `roundness` when present; `roundness`
    /// stays for backward compatibility with older files.
    pub corners: Option<CornerRadii>,
}

/// Per-corner radii in scene units, clockwise from top-left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CornerRadii {
    /// Top-left corner radius.
    pub top_left: f64,
    /// Top-right corner radius.
    pub top_right: f64,
    /// Bottom-right corner radius.
    pub bottom_right: f64,
    /// Bottom-left corner radius.
    pub bottom_left: f64,
}

impl CornerRadii {
    /// Rejects non-finite or negative radii.
    pub fn validate(&self) -> EngineResult<()> {
        for (name, value) in [
            ("topLeft", self.top_left),
            ("topRight", self.top_right),
            ("bottomRight", self.bottom_right),
            ("bottomLeft", self.bottom_left),
        ] {
            finite(value, &format!("corners.{name}"))?;
            if value < 0.0 {
                return Err(EngineError::InvalidInput(format!(
                    "corners.{name} must be non-negative, got {value}"
                )));
            }
        }
        Ok(())
    }
}

/// Ellipse element.
#[derive(Debug, Clone, PartialEq)]
pub struct EllipseElement {
    /// Shared fields.
    pub base: BaseElement,
}

/// Polyline element. Points are relative to the element origin.
#[derive(Debug, Clone, PartialEq)]
pub struct LineElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Polyline vertices, relative to (`x`, `y`).
    pub points: Vec<Point>,
}

/// Arrow element: polyline plus optional endpoint bindings and heads.
#[derive(Debug, Clone, PartialEq)]
pub struct ArrowElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Polyline vertices, relative to (`x`, `y`).
    pub points: Vec<Point>,
    /// Binding at the polyline start.
    pub start_binding: Option<Binding>,
    /// Binding at the polyline end.
    pub end_binding: Option<Binding>,
    /// Head marker at the polyline start.
    pub start_arrowhead: Option<ArrowheadType>,
    /// Head marker at the polyline end.
    pub end_arrowhead: Option<ArrowheadType>,
}

/// Text element. Whitespace (including leading/trailing spaces and blank
/// lines) is significant and must never be trimmed — the TS engine
/// preserves it and so does this port.
///
/// Three independent paints: glyphs use the base stroke color, the box
/// behind them uses the base background fill, and the box outline uses
/// `border_color` with the base stroke width/style (`None` or
/// `"transparent"` paints no outline). The split exists because the stroke
/// color is already the glyph color, so a second color is the only way to
/// outline the box without recoloring the text.
#[derive(Debug, Clone, PartialEq)]
pub struct TextElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Raw text content (may be empty; empty text keeps `height > 0` via the
    /// factory default, mirroring TS).
    pub text: String,
    /// Font size in scene units.
    pub font_size: f64,
    /// Font family name.
    pub font_family: String,
    /// Horizontal alignment within the element box.
    pub text_align: TextAlign,
    /// Box outline color (`None` for no outline). Width and dash come from
    /// the base stroke width/style.
    pub border_color: Option<String>,
    /// Container shape this text is bound inside, if any.
    pub container_id: Option<ElementId>,
}

impl TextElement {
    /// Number of lines (`text.split('\n')`; always at least 1).
    pub fn line_count(&self) -> usize {
        self.text.split('\n').count().max(1)
    }

    /// Line height in scene units (`font_size` × multiplier).
    pub fn line_height(&self) -> f64 {
        self.font_size * TEXT_LINE_HEIGHT_MULTIPLIER
    }
}

/// Freehand stroke. Points are relative to the element origin;
/// `pressures[i]` belongs to `points[i]` (equal lengths enforced).
#[derive(Debug, Clone, PartialEq)]
pub struct FreedrawElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Stroke samples, relative to (`x`, `y`).
    pub points: Vec<Point>,
    /// Stylus pressure per sample.
    pub pressures: Vec<f64>,
}

/// Frame element: a container addressed by children's `frame_id`.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Frame label.
    pub name: String,
    /// Whether children clip to the frame bounds (a render-loop pass, not
    /// document state — stored here as config).
    pub clip_content: bool,
    /// Auto-layout config; when set, the frame positions children
    /// automatically.
    pub auto_layout: Option<AutoLayoutConfig>,
}

/// Image element. Holds an asset *reference* only — pixel data lives in the
/// host `AssetStore`; the async cache/pending-load/object-URL machinery is
/// a host concern and stays out of core.
#[derive(Debug, Clone, PartialEq)]
pub struct ImageElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Asset id in the host store (may be empty for a placeholder).
    pub asset_id: String,
    /// Original file width, for aspect-ratio locking.
    pub natural_width: f64,
    /// Original file height, for aspect-ratio locking.
    pub natural_height: f64,
    /// Non-destructive crop in natural pixels, or `None` for the full image.
    pub crop: Option<CropRegion>,
}

/// Vector path element: cubic Bezier anchors.
#[derive(Debug, Clone, PartialEq)]
pub struct PathElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Ordered anchors.
    pub segments: Vec<PathSegment>,
    /// Closed (filled shape) vs. open (stroke only).
    pub closed: bool,
}

/// Live instance of a component master (TS `InstanceElement`).
///
/// Children are NOT stored as scene elements; they resolve from the master
/// at render/mutation time. Override keys are index paths into
/// the master's roots (`"0"`, `"1/0"`); identity fields (`id`, `type`) can
/// never be overridden.
#[derive(Debug, Clone, PartialEq)]
pub struct InstanceElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Owning component definition id.
    pub component_id: String,
    /// Per-child property patches by index path.
    pub overrides: HashMap<String, PatchValue>,
}

/// Custom shape element registered through the extensible shape system.
///
/// The `type_name` is the extension-registered discriminator (e.g. `"star"`,
/// `"sticky-note"`). `data` carries the extension-defined payload as a
/// JSON-like map — the core never interprets it; behavior (render, hit-test,
/// bounds) dispatches through the instance-scoped
/// [`crate::shape_extension::ShapeExtension`] trait object registered for
/// this type name.
#[derive(Debug, Clone, PartialEq)]
pub struct CustomElement {
    /// Shared fields.
    pub base: BaseElement,
    /// Extension-registered type discriminator (never a built-in name).
    pub type_name: String,
    /// Extension-defined payload (opaque to core).
    pub data: HashMap<String, PatchValue>,
}

/// All built-in element types plus the custom-shape extension point
/// (closed union).
#[derive(Debug, Clone, PartialEq)]
pub enum Element {
    /// Rectangle shape.
    Rectangle(RectangleElement),
    /// Ellipse shape.
    Ellipse(EllipseElement),
    /// Polyline.
    Line(LineElement),
    /// Arrow with optional bindings and heads.
    Arrow(ArrowElement),
    /// Text run.
    Text(TextElement),
    /// Freehand stroke.
    Freedraw(FreedrawElement),
    /// Frame container.
    Frame(FrameElement),
    /// Image placeholder with asset reference.
    Image(ImageElement),
    /// Bezier path.
    Path(PathElement),
    /// Component instance.
    Instance(InstanceElement),
    /// Extension-registered custom shape.
    Custom(CustomElement),
}

impl Element {
    /// Borrows the shared base fields.
    pub fn base(&self) -> &BaseElement {
        match self {
            Self::Rectangle(el) => &el.base,
            Self::Ellipse(el) => &el.base,
            Self::Line(el) => &el.base,
            Self::Arrow(el) => &el.base,
            Self::Text(el) => &el.base,
            Self::Freedraw(el) => &el.base,
            Self::Frame(el) => &el.base,
            Self::Image(el) => &el.base,
            Self::Path(el) => &el.base,
            Self::Instance(el) => &el.base,
            Self::Custom(el) => &el.base,
        }
    }

    /// Mutably borrows the shared base fields. Crate-internal only:
    /// operation modules build the next version of an element and hand it
    /// to [`crate::document::Document::upsert`], which owns versioning.
    /// External consumers never observe mutable element state.
    pub(crate) fn base_mut(&mut self) -> &mut BaseElement {
        match self {
            Self::Rectangle(el) => &mut el.base,
            Self::Ellipse(el) => &mut el.base,
            Self::Line(el) => &mut el.base,
            Self::Arrow(el) => &mut el.base,
            Self::Text(el) => &mut el.base,
            Self::Freedraw(el) => &mut el.base,
            Self::Frame(el) => &mut el.base,
            Self::Image(el) => &mut el.base,
            Self::Path(el) => &mut el.base,
            Self::Instance(el) => &mut el.base,
            Self::Custom(el) => &mut el.base,
        }
    }

    /// Borrows the stable identity.
    pub fn id(&self) -> &ElementId {
        &self.base().id
    }

    /// Returns the type discriminator string for this element.
    ///
    /// Built-in types return static strings; custom shapes return the
    /// extension-registered type name.
    pub fn element_type_name(&self) -> &str {
        match self {
            Self::Rectangle(_) => "rectangle",
            Self::Ellipse(_) => "ellipse",
            Self::Line(_) => "line",
            Self::Arrow(_) => "arrow",
            Self::Text(_) => "text",
            Self::Freedraw(_) => "freedraw",
            Self::Frame(_) => "frame",
            Self::Image(_) => "image",
            Self::Path(_) => "path",
            Self::Instance(_) => "instance",
            Self::Custom(el) => &el.type_name,
        }
    }

    /// Validates intrinsic invariants (base fields plus per-type extras).
    /// Cross-element references are checked by
    /// [`crate::document::Document::validate`].
    pub fn validate(&self) -> EngineResult<()> {
        self.base().validate()?;
        match self {
            Self::Rectangle(el) => {
                if let Some(roundness) = el.roundness {
                    finite(roundness, "roundness")?;
                }
                if let Some(corners) = &el.corners {
                    corners.validate()?;
                }
                Ok(())
            }
            Self::Ellipse(_) | Self::Frame(_) => Ok(()),
            Self::Image(_) | Self::Instance(_) => Ok(()),
            Self::Line(el) => {
                validate_points(&el.points, "points")?;
                Ok(())
            }
            Self::Arrow(el) => {
                validate_points(&el.points, "points")?;
                if let Some(binding) = &el.start_binding {
                    binding.validate()?;
                }
                if let Some(binding) = &el.end_binding {
                    binding.validate()?;
                }
                Ok(())
            }
            Self::Text(el) => {
                finite(el.font_size, "fontSize")?;
                Ok(())
            }
            Self::Freedraw(el) => {
                validate_points(&el.points, "points")?;
                for pressure in &el.pressures {
                    finite(*pressure, "pressures")?;
                }
                if el.pressures.len() != el.points.len() {
                    return Err(EngineError::InvalidInput(format!(
                        "freedraw pressures length {} must match points length {}",
                        el.pressures.len(),
                        el.points.len()
                    )));
                }
                Ok(())
            }
            Self::Path(el) => {
                for segment in &el.segments {
                    segment.validate()?;
                }
                Ok(())
            }
            Self::Custom(el) => {
                if el.type_name.is_empty() {
                    return Err(EngineError::InvalidInput(
                        "custom element type_name must not be empty".to_string(),
                    ));
                }
                for patch in el.data.values() {
                    patch.validate()?;
                }
                Ok(())
            }
        }?;
        // Per-type extras shared across variants.
        match self {
            Self::Image(el) => {
                finite(el.natural_width, "naturalWidth")?;
                finite(el.natural_height, "naturalHeight")?;
                if let Some(crop) = &el.crop {
                    crop.validate()?;
                }
                Ok(())
            }
            Self::Instance(el) => {
                if el.component_id.is_empty() {
                    return Err(EngineError::InvalidInput(
                        "instance componentId must not be empty".to_string(),
                    ));
                }
                for patch in el.overrides.values() {
                    patch.validate()?;
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// Axis-aligned scene-space bounds, rotation-aware.
    ///
    /// Ports the per-shape `get*Bounds` functions dispatched through TS
    /// `getElementBounds`: rectangle/ellipse/text/image rotate the box about
    /// its center; frame uses the unrotated box (TS `getFrameBounds` ignores
    /// rotation — preserved quirk); line/arrow/freedraw rotate the points
    /// AABB about its center, with empty point lists collapsing to the
    /// origin point; path includes anchors *and* control handles in the AABB
    /// before rotating, with empty segments collapsing to the origin point;
    /// instance and custom use the raw unrotated box (the ShapeExtension
    /// trait provides custom bounds when registered; this is the fallback).
    pub fn bounds(&self) -> Bounds {
        let base = self.base();
        match self {
            Self::Rectangle(_) | Self::Ellipse(_) | Self::Text(_) | Self::Image(_) => {
                rotated_bounds(base.x, base.y, base.width, base.height, base.rotation)
            }
            Self::Frame(_) | Self::Instance(_) | Self::Custom(_) => {
                Bounds::new(base.x, base.y, base.x + base.width, base.y + base.height)
            }
            Self::Line(el) => points_bounds(base, &el.points),
            Self::Arrow(el) => points_bounds(base, &el.points),
            Self::Freedraw(el) => points_bounds(base, &el.points),
            Self::Path(el) => path_bounds(base, &el.segments),
        }
    }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Rejects non-finite floats with a named error (no NaN/Infinity in
/// persistent state).
fn finite(value: f64, what: &str) -> EngineResult<()> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(EngineError::InvalidInput(format!("{what} must be finite")))
    }
}

/// Rejects non-finite points in a point list.
fn validate_points(points: &[Point], what: &str) -> EngineResult<()> {
    if points_are_finite(points) {
        Ok(())
    } else {
        Err(EngineError::InvalidInput(format!("{what} must be finite")))
    }
}

/// AABB of element-relative points shifted by the origin, then rotated.
/// Empty input collapses to the origin point (TS parity).
fn points_bounds(base: &BaseElement, points: &[Point]) -> Bounds {
    if points.is_empty() {
        return Bounds::point(base.x, base.y);
    }
    let mut min_px = f64::INFINITY;
    let mut min_py = f64::INFINITY;
    let mut max_px = f64::NEG_INFINITY;
    let mut max_py = f64::NEG_INFINITY;
    for point in points {
        if point[0] < min_px {
            min_px = point[0];
        }
        if point[1] < min_py {
            min_py = point[1];
        }
        if point[0] > max_px {
            max_px = point[0];
        }
        if point[1] > max_py {
            max_py = point[1];
        }
    }
    rotated_bounds(
        base.x + min_px,
        base.y + min_py,
        max_px - min_px,
        max_py - min_py,
        base.rotation,
    )
}

/// AABB of path anchors and their control handles, then rotated.
/// Empty input collapses to the origin point (TS parity).
fn path_bounds(base: &BaseElement, segments: &[PathSegment]) -> Bounds {
    if segments.is_empty() {
        return Bounds::point(base.x, base.y);
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut record = |x: f64, y: f64| {
        if x < min_x {
            min_x = x;
        }
        if y < min_y {
            min_y = y;
        }
        if x > max_x {
            max_x = x;
        }
        if y > max_y {
            max_y = y;
        }
    };
    for segment in segments {
        let ax = base.x + segment.point[0];
        let ay = base.y + segment.point[1];
        record(ax, ay);
        if let Some(handle) = segment.handle_in {
            record(ax + handle[0], ay + handle[1]);
        }
        if let Some(handle) = segment.handle_out {
            record(ax + handle[0], ay + handle[1]);
        }
    }
    rotated_bounds(min_x, min_y, max_x - min_x, max_y - min_y, base.rotation)
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/// Text line-height multiplier (TS `LINE_HEIGHT_MULTIPLIER` in
/// `shapes/text.ts`). Host text measurement multiplies the font size by
/// this; `TextElement::line_height` exposes the pure part.
pub const TEXT_LINE_HEIGHT_MULTIPLIER: f64 = 1.25;

/// Arrowhead triangle length in scene units (TS `ARROWHEAD_LENGTH`).
/// Consumed by the arrowhead hit-test; pinned here as contract.
pub const ARROWHEAD_LENGTH: f64 = 12.0;

/// Arrowhead triangle width in scene units (TS `ARROWHEAD_WIDTH`).
pub const ARROWHEAD_WIDTH: f64 = 8.0;

// ---------------------------------------------------------------------------
// Factories (TS `scene/create-element.ts` defaults)
// ---------------------------------------------------------------------------

/// Default shared fields for a new element. The id, seed, and nonces come
/// from the injected generator (deterministic under
/// [`CounterIdGenerator`]); everything else mirrors the TS per-type
/// defaults below.
fn base_defaults(gen: &mut impl IdGenerator) -> BaseElement {
    BaseElement {
        id: gen.new_element_id(),
        x: 0.0,
        y: 0.0,
        width: 100.0,
        height: 100.0,
        rotation: 0.0,
        stroke_color: "#000000".to_string(),
        background_color: FillStyle::default_transparent(),
        stroke_width: 1.0,
        stroke_style: StrokeStyle::Solid,
        stroke_cap: StrokeCap::default(),
        stroke_join: StrokeJoin::default(),
        stroke_align: StrokeAlign::default(),
        fill_style: ElementFillStyle::Solid,
        opacity: 100.0,
        seed: gen.new_seed(),
        version: 0,
        version_nonce: gen.new_nonce(),
        is_deleted: false,
        group_ids: Vec::new(),
        locked: false,
        hidden: false,
        frame_id: None,
        constraints: None,
        child_layout_sizing: None,
    }
}

/// Creates a rectangle with TS defaults (100×100, sharp corners).
pub fn create_rectangle(gen: &mut impl IdGenerator) -> RectangleElement {
    RectangleElement {
        base: base_defaults(gen),
        roundness: None,
        corners: None,
    }
}

/// Creates an ellipse with TS defaults (100×100).
pub fn create_ellipse(gen: &mut impl IdGenerator) -> EllipseElement {
    EllipseElement {
        base: base_defaults(gen),
    }
}

/// Creates a line with TS defaults (100×0, single origin point).
pub fn create_line(gen: &mut impl IdGenerator) -> LineElement {
    let mut base = base_defaults(gen);
    base.height = 0.0;
    LineElement {
        base,
        points: vec![[0.0, 0.0]],
    }
}

/// Creates an arrow with TS defaults (100×0, origin point, end head).
pub fn create_arrow(gen: &mut impl IdGenerator) -> ArrowElement {
    let mut base = base_defaults(gen);
    base.height = 0.0;
    ArrowElement {
        base,
        points: vec![[0.0, 0.0]],
        start_binding: None,
        end_binding: None,
        start_arrowhead: None,
        end_arrowhead: Some(ArrowheadType::Arrow),
    }
}

/// Creates a text element with TS defaults (100×20, empty Virgil 16px).
pub fn create_text(gen: &mut impl IdGenerator) -> TextElement {
    let mut base = base_defaults(gen);
    base.height = 20.0;
    TextElement {
        base,
        text: String::new(),
        font_size: 16.0,
        font_family: "Virgil".to_string(),
        text_align: TextAlign::Left,
        border_color: None,
        container_id: None,
    }
}

/// Creates a freedraw stroke with TS defaults (empty points/pressures).
pub fn create_freedraw(gen: &mut impl IdGenerator) -> FreedrawElement {
    FreedrawElement {
        base: base_defaults(gen),
        points: Vec::new(),
        pressures: Vec::new(),
    }
}

/// Creates a frame with TS defaults (400×300, named, clipping).
pub fn create_frame(gen: &mut impl IdGenerator) -> FrameElement {
    let mut base = base_defaults(gen);
    base.width = 400.0;
    base.height = 300.0;
    FrameElement {
        base,
        name: "Frame".to_string(),
        clip_content: true,
        auto_layout: None,
    }
}

/// Creates an image with TS defaults (100×100, empty asset, no crop).
pub fn create_image(gen: &mut impl IdGenerator) -> ImageElement {
    ImageElement {
        base: base_defaults(gen),
        asset_id: String::new(),
        natural_width: 100.0,
        natural_height: 100.0,
        crop: None,
    }
}

/// Creates a path with TS defaults (empty open path).
pub fn create_path(gen: &mut impl IdGenerator) -> PathElement {
    let mut base = base_defaults(gen);
    base.width = 0.0;
    base.height = 0.0;
    PathElement {
        base,
        segments: Vec::new(),
        closed: false,
    }
}

/// Creates an instance element with no overrides.
///
/// TS `createInstance` additionally derives `x/y/width/height` from the
/// master roots; that lookup needs the document and the component registry,
/// so master-derived sizing is left to the component actions. The caller
/// sets position and size explicitly.
pub fn create_instance(
    gen: &mut impl IdGenerator,
    component_id: impl Into<String>,
    x: f64,
    y: f64,
) -> InstanceElement {
    let mut base = base_defaults(gen);
    base.x = x;
    base.y = y;
    base.width = 0.0;
    base.height = 0.0;
    InstanceElement {
        base,
        component_id: component_id.into(),
        overrides: HashMap::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafalith_geometry::point::approx_eq;

    fn test_gen() -> CounterIdGenerator {
        CounterIdGenerator::new()
    }

    #[test]
    fn factory_defaults_match_ts_contract() {
        let mut gen = test_gen();
        let rect = create_rectangle(&mut gen);
        assert_eq!(rect.base.width, 100.0);
        assert_eq!(rect.base.height, 100.0);
        assert_eq!(rect.roundness, None);
        assert_eq!(rect.base.stroke_color, "#000000");
        assert!(matches!(
            rect.base.background_color,
            FillStyle::Solid { .. }
        ));
        assert_eq!(rect.base.opacity, 100.0);
        assert_eq!(rect.base.version, 0);
        assert!(!rect.base.is_deleted);
        assert!(!rect.base.locked);
        assert!(!rect.base.hidden);
        assert_eq!(rect.base.frame_id, None);

        let line = create_line(&mut gen);
        assert_eq!(line.base.height, 0.0);
        assert_eq!(line.points, vec![[0.0, 0.0]]);

        let arrow = create_arrow(&mut gen);
        assert_eq!(arrow.start_arrowhead, None);
        assert_eq!(arrow.end_arrowhead, Some(ArrowheadType::Arrow));
        assert_eq!(arrow.start_binding, None);

        let text = create_text(&mut gen);
        assert_eq!(text.base.height, 20.0);
        assert_eq!(text.text, "");
        assert_eq!(text.font_size, 16.0);
        assert_eq!(text.font_family, "Virgil");
        assert_eq!(text.text_align, TextAlign::Left);
        assert_eq!(text.border_color, None);
        assert_eq!(text.line_count(), 1);
        assert!(text.base.height > 0.0, "empty text keeps h > 0");

        let frame = create_frame(&mut gen);
        assert_eq!(frame.base.width, 400.0);
        assert_eq!(frame.base.height, 300.0);
        assert_eq!(frame.name, "Frame");
        assert!(frame.clip_content);

        let image = create_image(&mut gen);
        assert_eq!(image.asset_id, "");
        assert_eq!(image.natural_width, 100.0);
        assert_eq!(image.natural_height, 100.0);
        assert_eq!(image.crop, None);

        let path = create_path(&mut gen);
        assert!(path.segments.is_empty());
        assert!(!path.closed);

        let freedraw = create_freedraw(&mut gen);
        assert!(freedraw.points.is_empty());
        assert!(freedraw.pressures.is_empty());

        // Fresh ids are unique within the generator.
        let a = create_rectangle(&mut gen).base.id;
        let b = create_rectangle(&mut gen).base.id;
        assert_ne!(a, b);
    }

    #[test]
    fn text_whitespace_is_preserved() {
        let mut gen = test_gen();
        let mut text = create_text(&mut gen);
        text.text = "  padded\n\nsecond  ".to_string();
        assert_eq!(text.text, "  padded\n\nsecond  ", "never trim user text");
        assert_eq!(text.line_count(), 3);
        assert_eq!(text.line_height(), 16.0 * TEXT_LINE_HEIGHT_MULTIPLIER);
    }

    #[test]
    fn element_type_names_match_ts_discriminators() {
        let mut gen = test_gen();
        let cases: Vec<(Element, &str)> = vec![
            (Element::Rectangle(create_rectangle(&mut gen)), "rectangle"),
            (Element::Ellipse(create_ellipse(&mut gen)), "ellipse"),
            (Element::Line(create_line(&mut gen)), "line"),
            (Element::Arrow(create_arrow(&mut gen)), "arrow"),
            (Element::Text(create_text(&mut gen)), "text"),
            (Element::Freedraw(create_freedraw(&mut gen)), "freedraw"),
            (Element::Frame(create_frame(&mut gen)), "frame"),
            (Element::Image(create_image(&mut gen)), "image"),
            (Element::Path(create_path(&mut gen)), "path"),
            (
                Element::Instance(create_instance(&mut gen, "comp-1", 0.0, 0.0)),
                "instance",
            ),
        ];
        for (element, name) in cases {
            assert_eq!(element.element_type_name(), name);
            assert!(element.validate().is_ok(), "{name} default must validate");
        }
    }

    #[test]
    fn validation_rejects_non_finite_and_empty_ids() {
        let mut gen = test_gen();
        let mut rect = create_rectangle(&mut gen);
        let ok = Element::Rectangle(rect.clone());
        assert!(ok.validate().is_ok());

        rect.base.x = f64::NAN;
        assert!(Element::Rectangle(rect.clone()).validate().is_err());
        rect.base.x = 0.0;
        rect.base.rotation = f64::INFINITY;
        assert!(Element::Rectangle(rect.clone()).validate().is_err());
        rect.base.rotation = 0.0;
        rect.base.id = ElementId::of("");
        assert!(Element::Rectangle(rect.clone()).validate().is_err());
    }

    #[test]
    fn validation_rejects_freedraw_pressure_mismatch() {
        let mut gen = test_gen();
        let mut freedraw = create_freedraw(&mut gen);
        freedraw.points = vec![[0.0, 0.0], [10.0, 10.0]];
        freedraw.pressures = vec![0.5];
        assert!(
            Element::Freedraw(freedraw).validate().is_err(),
            "mirrors TS import: pressures length must match points length"
        );
    }

    #[test]
    fn bounds_match_ts_contracts() {
        let mut gen = test_gen();

        // Unrotated rectangle: exact box.
        let mut rect = create_rectangle(&mut gen);
        rect.base.x = 10.0;
        rect.base.y = 20.0;
        rect.base.width = 100.0;
        rect.base.height = 80.0;
        assert_eq!(
            Element::Rectangle(rect).bounds(),
            Bounds::new(10.0, 20.0, 110.0, 100.0)
        );

        // Freedraw points AABB (mirrors `getFreedrawBounds` exact case).
        let mut freedraw = create_freedraw(&mut gen);
        freedraw.base.x = 10.0;
        freedraw.base.y = 20.0;
        freedraw.points = vec![[0.0, 0.0], [50.0, 20.0], [100.0, 50.0]];
        freedraw.pressures = vec![0.5, 0.5, 0.5];
        assert_eq!(
            Element::Freedraw(freedraw).bounds(),
            Bounds::new(10.0, 20.0, 110.0, 70.0)
        );

        // Single point collapses to the origin point.
        let mut single = create_freedraw(&mut gen);
        single.base.x = 50.0;
        single.base.y = 50.0;
        single.points = vec![[0.0, 0.0]];
        single.pressures = vec![0.5];
        assert_eq!(
            Element::Freedraw(single).bounds(),
            Bounds::new(50.0, 50.0, 50.0, 50.0)
        );

        // Rotated freedraw segment matches the pinned TS values.
        let mut rotated = create_freedraw(&mut gen);
        rotated.base.rotation = std::f64::consts::FRAC_PI_4;
        rotated.points = vec![[0.0, 0.0], [100.0, 0.0]];
        rotated.pressures = vec![0.5, 0.5];
        let b = Element::Freedraw(rotated).bounds();
        let eps = 1e-9;
        assert!(approx_eq(b.min_x, 14.644_660_940_672_62, eps), "{b:?}");
        assert!(approx_eq(b.min_y, -35.355_339_059_327_38, eps), "{b:?}");
        assert!(approx_eq(b.max_x, 85.355_339_059_327_38, eps), "{b:?}");
        assert!(approx_eq(b.max_y, 35.355_339_059_327_38, eps), "{b:?}");

        // Path bounds include control handles (TS `getPathBounds`).
        let mut path = create_path(&mut gen);
        path.segments = vec![
            PathSegment {
                point: [0.0, 0.0],
                handle_in: None,
                handle_out: Some([50.0, 0.0]),
            },
            PathSegment {
                point: [100.0, 0.0],
                handle_in: Some([-50.0, 0.0]),
                handle_out: None,
            },
        ];
        assert_eq!(
            Element::Path(path).bounds(),
            Bounds::new(0.0, 0.0, 100.0, 0.0)
        );

        // Frame bounds ignore rotation (preserved TS quirk).
        let mut frame = create_frame(&mut gen);
        frame.base.x = 5.0;
        frame.base.y = 5.0;
        frame.base.width = 10.0;
        frame.base.height = 10.0;
        frame.base.rotation = std::f64::consts::FRAC_PI_4;
        assert_eq!(
            Element::Frame(frame).bounds(),
            Bounds::new(5.0, 5.0, 15.0, 15.0)
        );
    }
}

#[cfg(test)]
mod corner_radii_tests {
    use super::*;

    #[test]
    fn per_corner_radii_validate_and_round_trip() {
        let mut gen = CounterIdGenerator::new();
        let mut rect = create_rectangle(&mut gen);
        rect.corners = Some(CornerRadii {
            top_left: 4.0,
            top_right: 8.0,
            bottom_right: 12.0,
            bottom_left: 0.0,
        });
        Element::Rectangle(rect)
            .validate()
            .expect("valid corners pass");

        let mut negative = create_rectangle(&mut gen);
        negative.corners = Some(CornerRadii {
            top_left: -1.0,
            top_right: 0.0,
            bottom_right: 0.0,
            bottom_left: 0.0,
        });
        assert!(matches!(
            Element::Rectangle(negative).validate(),
            Err(EngineError::InvalidInput(_))
        ));

        let mut wild = create_rectangle(&mut gen);
        wild.corners = Some(CornerRadii {
            top_left: f64::NAN,
            top_right: 0.0,
            bottom_right: 0.0,
            bottom_left: 0.0,
        });
        assert!(matches!(
            Element::Rectangle(wild).validate(),
            Err(EngineError::InvalidInput(_))
        ));
    }
}
