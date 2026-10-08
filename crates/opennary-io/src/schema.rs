//! Versioned JSON schema (v1): DTOs mirroring the TS contract field by
//! field, plus envelope version resolution.
//!
//! TS sources: `packages/core/src/scene/types.ts` (field names and shapes),
//! `packages/core/src/io/export-json.ts` (`SerializedScene`), and
//! `packages/core/src/io/import-json.ts` (`migrateScene` version rule,
//! per-element leniency).
//!
//! Design: the schema lives here — not as serde derives on the domain —
//! domain — so the wire format can version and migrate independently of the
//! domain model while `opennary-core` stays dependency-free. Element
//! dispatch is manual on the `type` tag (unknown tags skip the element,
//! mirroring the TS registry check) instead of a flattened tagged enum,
//! keeping one conversion path in each direction.
//!
//! Strictness (lenient-version / strict-data): the envelope
//! version is resolved leniently (`schemaVersion ?? version ?? 1`, exactly
//! like TS `migrateScene`), while element data parses strictly into typed
//! DTOs — anything mistyped skips the element instead of entering the
//! document. Domain [`Element::validate`](opennary_core::element::Element::validate)
//! remains the final gate before admission.

use std::collections::HashMap;

use opennary_core::element::ElementId;
use opennary_core::element::{
    ArrowElement, ArrowheadType, AutoLayoutConfig, BaseElement, Binding, ChildLayoutSizing,
    ConstraintAnchor, Constraints, CornerRadii, CounterAxisAlign, CropRegion, Element,
    ElementFillStyle, EllipseElement, FillStyle, FrameElement, FramePadding, FrameSizing,
    FreedrawElement, GradientStop, GradientType, ImageElement, InstanceElement, LayoutDirection,
    LineElement, PatchValue, PathElement, PathSegment, PrimaryAxisAlign, RectangleElement,
    StrokeAlign, StrokeCap, StrokeJoin, StrokeStyle, TextAlign, TextElement,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Type tags (TS `ElementType` discriminators)
// ---------------------------------------------------------------------------

pub(crate) const TYPE_RECTANGLE: &str = "rectangle";
pub(crate) const TYPE_ELLIPSE: &str = "ellipse";
pub(crate) const TYPE_LINE: &str = "line";
pub(crate) const TYPE_ARROW: &str = "arrow";
pub(crate) const TYPE_TEXT: &str = "text";
pub(crate) const TYPE_FREEDRAW: &str = "freedraw";
pub(crate) const TYPE_FRAME: &str = "frame";
pub(crate) const TYPE_IMAGE: &str = "image";
pub(crate) const TYPE_PATH: &str = "path";
pub(crate) const TYPE_INSTANCE: &str = "instance";

// ---------------------------------------------------------------------------
// Style primitives
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StrokeStyleDto {
    Solid,
    Dashed,
    Dotted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StrokeCapDto {
    #[default]
    Butt,
    Round,
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StrokeJoinDto {
    #[default]
    Miter,
    Round,
    Bevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum StrokeAlignDto {
    Inside,
    #[default]
    Center,
    Outside,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum ElementFillStyleDto {
    #[serde(rename = "solid")]
    Solid,
    #[serde(rename = "hachure")]
    Hachure,
    #[serde(rename = "cross-hatch")]
    CrossHatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum GradientTypeDto {
    Linear,
    Radial,
    Angular,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct GradientStopDto {
    pub offset: f64,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum FillStyleDto {
    Solid {
        color: String,
    },
    Gradient {
        gradient_type: GradientTypeDto,
        angle: f64,
        stops: Vec<GradientStopDto>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ArrowheadDto {
    Arrow,
    Bar,
    Dot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TextAlignDto {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ConstraintAnchorDto {
    Min,
    Max,
    Center,
    Stretch,
    Scale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct ConstraintsDto {
    pub horizontal: ConstraintAnchorDto,
    pub vertical: ConstraintAnchorDto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChildLayoutSizingDto {
    Fixed,
    Fill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LayoutDirectionDto {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum PrimaryAxisAlignDto {
    #[serde(rename = "start")]
    Start,
    #[serde(rename = "center")]
    Center,
    #[serde(rename = "end")]
    End,
    #[serde(rename = "space-between")]
    SpaceBetween,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CounterAxisAlignDto {
    Start,
    Center,
    End,
    Stretch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FrameSizingDto {
    Hug,
    Fixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(crate) struct FramePaddingDto {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoLayoutDto {
    pub direction: LayoutDirectionDto,
    pub gap: f64,
    pub padding: FramePaddingDto,
    pub primary_axis_align: PrimaryAxisAlignDto,
    pub counter_axis_align: CounterAxisAlignDto,
    pub sizing: FrameSizingDto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindingDto {
    pub element_id: String,
    pub focus: f64,
    pub gap: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub(crate) struct CropDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathSegmentDto {
    pub point: [f64; 2],
    pub handle_in: Option<[f64; 2]>,
    pub handle_out: Option<[f64; 2]>,
}

// ---------------------------------------------------------------------------
// Base + per-type DTOs
// ---------------------------------------------------------------------------

/// Mirror of TS `BaseElement`. `hidden`/`frameId` and the layout configs
/// default for backward compatibility with older exports (TS parity —
/// `import-json.ts` fills `hidden = false`, `frameId = null` when absent).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BaseDto {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub stroke_color: String,
    pub background_color: FillStyleDto,
    pub stroke_width: f64,
    pub stroke_style: StrokeStyleDto,
    /// Cap style; absent in older exports means butt.
    #[serde(default)]
    pub stroke_cap: StrokeCapDto,
    /// Join style; absent in older exports means miter.
    #[serde(default)]
    pub stroke_join: StrokeJoinDto,
    /// Stroke alignment; absent in older exports means center.
    #[serde(default)]
    pub stroke_align: StrokeAlignDto,
    pub fill_style: ElementFillStyleDto,
    pub opacity: f64,
    pub seed: u32,
    pub version: u32,
    pub version_nonce: u32,
    pub is_deleted: bool,
    pub group_ids: Vec<String>,
    pub locked: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub frame_id: Option<String>,
    #[serde(default)]
    pub constraints: Option<ConstraintsDto>,
    #[serde(default)]
    pub child_layout_sizing: Option<ChildLayoutSizingDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct RectangleDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub roundness: Option<f64>,
    /// Per-corner radii; absent in older exports.
    #[serde(default)]
    pub corners: Option<CornerRadiiDto>,
}

/// Per-corner radii, clockwise from top-left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CornerRadiiDto {
    pub top_left: f64,
    pub top_right: f64,
    pub bottom_right: f64,
    pub bottom_left: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct EllipseDto {
    #[serde(flatten)]
    pub base: BaseDto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct LineDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub points: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArrowDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub points: Vec<[f64; 2]>,
    pub start_binding: Option<BindingDto>,
    pub end_binding: Option<BindingDto>,
    pub start_arrowhead: Option<ArrowheadDto>,
    pub end_arrowhead: Option<ArrowheadDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TextDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub text: String,
    pub font_size: f64,
    pub font_family: String,
    pub text_align: TextAlignDto,
    pub container_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct FreedrawDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub points: Vec<[f64; 2]>,
    pub pressures: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrameDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub name: String,
    pub clip_content: bool,
    #[serde(default)]
    pub auto_layout: Option<AutoLayoutDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub asset_id: String,
    pub natural_width: f64,
    pub natural_height: f64,
    pub crop: Option<CropDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct PathDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub segments: Vec<PathSegmentDto>,
    pub closed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstanceDto {
    #[serde(flatten)]
    pub base: BaseDto,
    pub component_id: String,
    #[serde(default)]
    pub overrides: HashMap<String, Value>,
}

// ---------------------------------------------------------------------------
// Domain conversions
// ---------------------------------------------------------------------------

fn stroke_to_domain(value: StrokeStyleDto) -> StrokeStyle {
    match value {
        StrokeStyleDto::Solid => StrokeStyle::Solid,
        StrokeStyleDto::Dashed => StrokeStyle::Dashed,
        StrokeStyleDto::Dotted => StrokeStyle::Dotted,
    }
}

fn stroke_to_dto(value: StrokeStyle) -> StrokeStyleDto {
    match value {
        StrokeStyle::Solid => StrokeStyleDto::Solid,
        StrokeStyle::Dashed => StrokeStyleDto::Dashed,
        StrokeStyle::Dotted => StrokeStyleDto::Dotted,
    }
}

fn cap_to_domain(value: StrokeCapDto) -> StrokeCap {
    match value {
        StrokeCapDto::Butt => StrokeCap::Butt,
        StrokeCapDto::Round => StrokeCap::Round,
        StrokeCapDto::Square => StrokeCap::Square,
    }
}

fn cap_to_dto(value: StrokeCap) -> StrokeCapDto {
    match value {
        StrokeCap::Butt => StrokeCapDto::Butt,
        StrokeCap::Round => StrokeCapDto::Round,
        StrokeCap::Square => StrokeCapDto::Square,
    }
}

fn join_to_domain(value: StrokeJoinDto) -> StrokeJoin {
    match value {
        StrokeJoinDto::Miter => StrokeJoin::Miter,
        StrokeJoinDto::Round => StrokeJoin::Round,
        StrokeJoinDto::Bevel => StrokeJoin::Bevel,
    }
}

fn join_to_dto(value: StrokeJoin) -> StrokeJoinDto {
    match value {
        StrokeJoin::Miter => StrokeJoinDto::Miter,
        StrokeJoin::Round => StrokeJoinDto::Round,
        StrokeJoin::Bevel => StrokeJoinDto::Bevel,
    }
}

fn align_to_domain(value: StrokeAlignDto) -> StrokeAlign {
    match value {
        StrokeAlignDto::Inside => StrokeAlign::Inside,
        StrokeAlignDto::Center => StrokeAlign::Center,
        StrokeAlignDto::Outside => StrokeAlign::Outside,
    }
}

fn align_to_dto(value: StrokeAlign) -> StrokeAlignDto {
    match value {
        StrokeAlign::Inside => StrokeAlignDto::Inside,
        StrokeAlign::Center => StrokeAlignDto::Center,
        StrokeAlign::Outside => StrokeAlignDto::Outside,
    }
}

fn fill_style_to_domain(value: &ElementFillStyleDto) -> ElementFillStyle {
    match value {
        ElementFillStyleDto::Solid => ElementFillStyle::Solid,
        ElementFillStyleDto::Hachure => ElementFillStyle::Hachure,
        ElementFillStyleDto::CrossHatch => ElementFillStyle::CrossHatch,
    }
}

fn fill_style_to_dto(value: ElementFillStyle) -> ElementFillStyleDto {
    match value {
        ElementFillStyle::Solid => ElementFillStyleDto::Solid,
        ElementFillStyle::Hachure => ElementFillStyleDto::Hachure,
        ElementFillStyle::CrossHatch => ElementFillStyleDto::CrossHatch,
    }
}

fn fill_to_domain(value: &FillStyleDto) -> FillStyle {
    match value {
        FillStyleDto::Solid { color } => FillStyle::Solid {
            color: color.clone(),
        },
        FillStyleDto::Gradient {
            gradient_type,
            angle,
            stops,
        } => FillStyle::Gradient {
            gradient_type: match gradient_type {
                GradientTypeDto::Linear => GradientType::Linear,
                GradientTypeDto::Radial => GradientType::Radial,
                GradientTypeDto::Angular => GradientType::Angular,
            },
            angle: *angle,
            stops: stops
                .iter()
                .map(|stop| GradientStop {
                    offset: stop.offset,
                    color: stop.color.clone(),
                })
                .collect(),
        },
    }
}

/// Parses one fill value into the domain [`FillStyle`]: a plain string sets
/// a solid fill, a fill object parses as [`FillStyleDto`]. Returns `None`
/// for mistyped payloads (same leniency as element dispatch).
///
/// Shared by file import and `setStyle` so both paths validate identically
/// — one parser, no drift.
pub(crate) fn fill_from_value(value: &Value) -> Option<FillStyle> {
    match value {
        Value::String(color) => Some(FillStyle::Solid {
            color: color.clone(),
        }),
        Value::Object(_) => {
            let dto: FillStyleDto = serde_json::from_value(value.clone()).ok()?;
            Some(fill_to_domain(&dto))
        }
        _ => None,
    }
}

fn fill_to_dto(value: &FillStyle) -> FillStyleDto {
    match value {
        FillStyle::Solid { color } => FillStyleDto::Solid {
            color: color.clone(),
        },
        FillStyle::Gradient {
            gradient_type,
            angle,
            stops,
        } => FillStyleDto::Gradient {
            gradient_type: match gradient_type {
                GradientType::Linear => GradientTypeDto::Linear,
                GradientType::Radial => GradientTypeDto::Radial,
                GradientType::Angular => GradientTypeDto::Angular,
            },
            angle: *angle,
            stops: stops
                .iter()
                .map(|stop| GradientStopDto {
                    offset: stop.offset,
                    color: stop.color.clone(),
                })
                .collect(),
        },
    }
}

fn anchor_to_domain(value: ConstraintAnchorDto) -> ConstraintAnchor {
    match value {
        ConstraintAnchorDto::Min => ConstraintAnchor::Min,
        ConstraintAnchorDto::Max => ConstraintAnchor::Max,
        ConstraintAnchorDto::Center => ConstraintAnchor::Center,
        ConstraintAnchorDto::Stretch => ConstraintAnchor::Stretch,
        ConstraintAnchorDto::Scale => ConstraintAnchor::Scale,
    }
}

fn anchor_to_dto(value: ConstraintAnchor) -> ConstraintAnchorDto {
    match value {
        ConstraintAnchor::Min => ConstraintAnchorDto::Min,
        ConstraintAnchor::Max => ConstraintAnchorDto::Max,
        ConstraintAnchor::Center => ConstraintAnchorDto::Center,
        ConstraintAnchor::Stretch => ConstraintAnchorDto::Stretch,
        ConstraintAnchor::Scale => ConstraintAnchorDto::Scale,
    }
}

fn base_to_domain(value: BaseDto) -> BaseElement {
    BaseElement {
        id: ElementId::of(value.id),
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
        rotation: value.rotation,
        stroke_color: value.stroke_color,
        background_color: fill_to_domain(&value.background_color),
        stroke_width: value.stroke_width,
        stroke_style: stroke_to_domain(value.stroke_style),
        stroke_cap: cap_to_domain(value.stroke_cap),
        stroke_join: join_to_domain(value.stroke_join),
        stroke_align: align_to_domain(value.stroke_align),
        fill_style: fill_style_to_domain(&value.fill_style),
        opacity: value.opacity,
        seed: value.seed,
        version: value.version,
        version_nonce: value.version_nonce,
        is_deleted: value.is_deleted,
        group_ids: value.group_ids.into_iter().map(ElementId::of).collect(),
        locked: value.locked,
        hidden: value.hidden,
        frame_id: value.frame_id.map(ElementId::of),
        constraints: value.constraints.map(|constraints| Constraints {
            horizontal: anchor_to_domain(constraints.horizontal),
            vertical: anchor_to_domain(constraints.vertical),
        }),
        child_layout_sizing: value.child_layout_sizing.map(|sizing| match sizing {
            ChildLayoutSizingDto::Fixed => ChildLayoutSizing::Fixed,
            ChildLayoutSizingDto::Fill => ChildLayoutSizing::Fill,
        }),
    }
}

fn base_to_dto(value: &BaseElement) -> BaseDto {
    BaseDto {
        id: value.id.as_str().to_string(),
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
        rotation: value.rotation,
        stroke_color: value.stroke_color.clone(),
        background_color: fill_to_dto(&value.background_color),
        stroke_width: value.stroke_width,
        stroke_style: stroke_to_dto(value.stroke_style),
        stroke_cap: cap_to_dto(value.stroke_cap),
        stroke_join: join_to_dto(value.stroke_join),
        stroke_align: align_to_dto(value.stroke_align),
        fill_style: fill_style_to_dto(value.fill_style),
        opacity: value.opacity,
        seed: value.seed,
        version: value.version,
        version_nonce: value.version_nonce,
        is_deleted: value.is_deleted,
        group_ids: value
            .group_ids
            .iter()
            .map(|id| id.as_str().to_string())
            .collect(),
        locked: value.locked,
        hidden: value.hidden,
        frame_id: value.frame_id.as_ref().map(|id| id.as_str().to_string()),
        constraints: value.constraints.map(|constraints| ConstraintsDto {
            horizontal: anchor_to_dto(constraints.horizontal),
            vertical: anchor_to_dto(constraints.vertical),
        }),
        child_layout_sizing: value.child_layout_sizing.map(|sizing| match sizing {
            ChildLayoutSizing::Fixed => ChildLayoutSizingDto::Fixed,
            ChildLayoutSizing::Fill => ChildLayoutSizingDto::Fill,
        }),
    }
}

fn binding_to_domain(value: BindingDto) -> Binding {
    Binding {
        element_id: ElementId::of(value.element_id),
        focus: value.focus,
        gap: value.gap,
    }
}

fn binding_to_dto(value: &Binding) -> BindingDto {
    BindingDto {
        element_id: value.element_id.as_str().to_string(),
        focus: value.focus,
        gap: value.gap,
    }
}

fn arrowhead_to_domain(value: ArrowheadDto) -> ArrowheadType {
    match value {
        ArrowheadDto::Arrow => ArrowheadType::Arrow,
        ArrowheadDto::Bar => ArrowheadType::Bar,
        ArrowheadDto::Dot => ArrowheadType::Dot,
    }
}

fn arrowhead_to_dto(value: ArrowheadType) -> ArrowheadDto {
    match value {
        ArrowheadType::Arrow => ArrowheadDto::Arrow,
        ArrowheadType::Bar => ArrowheadDto::Bar,
        ArrowheadType::Dot => ArrowheadDto::Dot,
    }
}

fn patch_from_value(value: Value) -> PatchValue {
    match value {
        Value::Null => PatchValue::Null,
        Value::Bool(flag) => PatchValue::Bool(flag),
        Value::Number(number) => PatchValue::Number(number.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => PatchValue::Text(text),
        Value::Array(items) => PatchValue::Array(items.into_iter().map(patch_from_value).collect()),
        Value::Object(entries) => PatchValue::Object(
            entries
                .into_iter()
                .map(|(key, item)| (key, patch_from_value(item)))
                .collect(),
        ),
    }
}

fn patch_to_value(value: &PatchValue) -> Value {
    match value {
        PatchValue::Null => Value::Null,
        PatchValue::Bool(flag) => Value::Bool(*flag),
        PatchValue::Number(number) => serde_json::Number::from_f64(*number)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        PatchValue::Text(text) => Value::String(text.clone()),
        PatchValue::Array(items) => Value::Array(items.iter().map(patch_to_value).collect()),
        PatchValue::Object(entries) => Value::Object(
            entries
                .iter()
                .map(|(key, item)| (key.clone(), patch_to_value(item)))
                .collect(),
        ),
    }
}

// ---------------------------------------------------------------------------
// Element dispatch
// ---------------------------------------------------------------------------

/// Converts one envelope element value to a domain element.
///
/// Returns `None` for unknown types and mistyped payloads (TS skip parity).
/// The caller gates the result through [`Element::validate`](opennary_core::element::Element::validate)
/// before admission.
pub(crate) fn element_from_value(value: &Value) -> Option<Element> {
    let tag = value.get("type")?.as_str()?;
    let element = match tag {
        TYPE_RECTANGLE => {
            let dto: RectangleDto = serde_json::from_value(value.clone()).ok()?;
            Element::Rectangle(RectangleElement {
                base: base_to_domain(dto.base),
                roundness: dto.roundness,
                corners: dto.corners.map(|corners| CornerRadii {
                    top_left: corners.top_left,
                    top_right: corners.top_right,
                    bottom_right: corners.bottom_right,
                    bottom_left: corners.bottom_left,
                }),
            })
        }
        TYPE_ELLIPSE => {
            let dto: EllipseDto = serde_json::from_value(value.clone()).ok()?;
            Element::Ellipse(EllipseElement {
                base: base_to_domain(dto.base),
            })
        }
        TYPE_LINE => {
            let dto: LineDto = serde_json::from_value(value.clone()).ok()?;
            Element::Line(LineElement {
                base: base_to_domain(dto.base),
                points: dto.points,
            })
        }
        TYPE_ARROW => {
            let dto: ArrowDto = serde_json::from_value(value.clone()).ok()?;
            Element::Arrow(ArrowElement {
                base: base_to_domain(dto.base),
                points: dto.points,
                start_binding: dto.start_binding.map(binding_to_domain),
                end_binding: dto.end_binding.map(binding_to_domain),
                start_arrowhead: dto.start_arrowhead.map(arrowhead_to_domain),
                end_arrowhead: dto.end_arrowhead.map(arrowhead_to_domain),
            })
        }
        TYPE_TEXT => {
            let dto: TextDto = serde_json::from_value(value.clone()).ok()?;
            Element::Text(TextElement {
                base: base_to_domain(dto.base),
                text: dto.text,
                font_size: dto.font_size,
                font_family: dto.font_family,
                text_align: match dto.text_align {
                    TextAlignDto::Left => TextAlign::Left,
                    TextAlignDto::Center => TextAlign::Center,
                    TextAlignDto::Right => TextAlign::Right,
                },
                container_id: dto.container_id.map(ElementId::of),
            })
        }
        TYPE_FREEDRAW => {
            let dto: FreedrawDto = serde_json::from_value(value.clone()).ok()?;
            Element::Freedraw(FreedrawElement {
                base: base_to_domain(dto.base),
                points: dto.points,
                pressures: dto.pressures,
            })
        }
        TYPE_FRAME => {
            let dto: FrameDto = serde_json::from_value(value.clone()).ok()?;
            Element::Frame(FrameElement {
                base: base_to_domain(dto.base),
                name: dto.name,
                clip_content: dto.clip_content,
                auto_layout: dto.auto_layout.map(|layout| AutoLayoutConfig {
                    direction: match layout.direction {
                        LayoutDirectionDto::Horizontal => LayoutDirection::Horizontal,
                        LayoutDirectionDto::Vertical => LayoutDirection::Vertical,
                    },
                    gap: layout.gap,
                    padding: FramePadding {
                        top: layout.padding.top,
                        right: layout.padding.right,
                        bottom: layout.padding.bottom,
                        left: layout.padding.left,
                    },
                    primary_axis_align: match layout.primary_axis_align {
                        PrimaryAxisAlignDto::Start => PrimaryAxisAlign::Start,
                        PrimaryAxisAlignDto::Center => PrimaryAxisAlign::Center,
                        PrimaryAxisAlignDto::End => PrimaryAxisAlign::End,
                        PrimaryAxisAlignDto::SpaceBetween => PrimaryAxisAlign::SpaceBetween,
                    },
                    counter_axis_align: match layout.counter_axis_align {
                        CounterAxisAlignDto::Start => CounterAxisAlign::Start,
                        CounterAxisAlignDto::Center => CounterAxisAlign::Center,
                        CounterAxisAlignDto::End => CounterAxisAlign::End,
                        CounterAxisAlignDto::Stretch => CounterAxisAlign::Stretch,
                    },
                    sizing: match layout.sizing {
                        FrameSizingDto::Hug => FrameSizing::Hug,
                        FrameSizingDto::Fixed => FrameSizing::Fixed,
                    },
                }),
            })
        }
        TYPE_IMAGE => {
            let dto: ImageDto = serde_json::from_value(value.clone()).ok()?;
            Element::Image(ImageElement {
                base: base_to_domain(dto.base),
                asset_id: dto.asset_id,
                natural_width: dto.natural_width,
                natural_height: dto.natural_height,
                crop: dto.crop.map(|crop| CropRegion {
                    x: crop.x,
                    y: crop.y,
                    width: crop.width,
                    height: crop.height,
                }),
            })
        }
        TYPE_PATH => {
            let dto: PathDto = serde_json::from_value(value.clone()).ok()?;
            Element::Path(PathElement {
                base: base_to_domain(dto.base),
                segments: dto
                    .segments
                    .into_iter()
                    .map(|segment| PathSegment {
                        point: segment.point,
                        handle_in: segment.handle_in,
                        handle_out: segment.handle_out,
                    })
                    .collect(),
                closed: dto.closed,
            })
        }
        TYPE_INSTANCE => {
            let dto: InstanceDto = serde_json::from_value(value.clone()).ok()?;
            Element::Instance(InstanceElement {
                base: base_to_domain(dto.base),
                component_id: dto.component_id,
                overrides: dto
                    .overrides
                    .into_iter()
                    .map(|(key, item)| (key, patch_from_value(item)))
                    .collect(),
            })
        }
        _ => return None,
    };
    Some(element)
}

/// Converts one domain element to its envelope JSON value (with `type` tag).
///
/// Fails loudly on non-finite floats (which JSON cannot represent) instead
/// of emitting `null` — stored elements are validated finite at upsert, so
/// this path is infallible for document-sourced elements.
pub(crate) fn element_to_value(element: &Element) -> Result<Value, serde_json::Error> {
    let (tag, mut value) = match element {
        Element::Rectangle(inner) => (
            TYPE_RECTANGLE,
            serde_json::to_value(RectangleDto {
                base: base_to_dto(&inner.base),
                roundness: inner.roundness,
                corners: inner.corners.map(|corners| CornerRadiiDto {
                    top_left: corners.top_left,
                    top_right: corners.top_right,
                    bottom_right: corners.bottom_right,
                    bottom_left: corners.bottom_left,
                }),
            })?,
        ),
        Element::Ellipse(inner) => (
            TYPE_ELLIPSE,
            serde_json::to_value(EllipseDto {
                base: base_to_dto(&inner.base),
            })?,
        ),
        Element::Line(inner) => (
            TYPE_LINE,
            serde_json::to_value(LineDto {
                base: base_to_dto(&inner.base),
                points: inner.points.clone(),
            })?,
        ),
        Element::Arrow(inner) => (
            TYPE_ARROW,
            serde_json::to_value(ArrowDto {
                base: base_to_dto(&inner.base),
                points: inner.points.clone(),
                start_binding: inner.start_binding.as_ref().map(binding_to_dto),
                end_binding: inner.end_binding.as_ref().map(binding_to_dto),
                start_arrowhead: inner.start_arrowhead.map(arrowhead_to_dto),
                end_arrowhead: inner.end_arrowhead.map(arrowhead_to_dto),
            })?,
        ),
        Element::Text(inner) => (
            TYPE_TEXT,
            serde_json::to_value(TextDto {
                base: base_to_dto(&inner.base),
                text: inner.text.clone(),
                font_size: inner.font_size,
                font_family: inner.font_family.clone(),
                text_align: match inner.text_align {
                    TextAlign::Left => TextAlignDto::Left,
                    TextAlign::Center => TextAlignDto::Center,
                    TextAlign::Right => TextAlignDto::Right,
                },
                container_id: inner
                    .container_id
                    .as_ref()
                    .map(|id| id.as_str().to_string()),
            })?,
        ),
        Element::Freedraw(inner) => (
            TYPE_FREEDRAW,
            serde_json::to_value(FreedrawDto {
                base: base_to_dto(&inner.base),
                points: inner.points.clone(),
                pressures: inner.pressures.clone(),
            })?,
        ),
        Element::Frame(inner) => (
            TYPE_FRAME,
            serde_json::to_value(FrameDto {
                base: base_to_dto(&inner.base),
                name: inner.name.clone(),
                clip_content: inner.clip_content,
                auto_layout: inner.auto_layout.as_ref().map(|layout| AutoLayoutDto {
                    direction: match layout.direction {
                        LayoutDirection::Horizontal => LayoutDirectionDto::Horizontal,
                        LayoutDirection::Vertical => LayoutDirectionDto::Vertical,
                    },
                    gap: layout.gap,
                    padding: FramePaddingDto {
                        top: layout.padding.top,
                        right: layout.padding.right,
                        bottom: layout.padding.bottom,
                        left: layout.padding.left,
                    },
                    primary_axis_align: match layout.primary_axis_align {
                        PrimaryAxisAlign::Start => PrimaryAxisAlignDto::Start,
                        PrimaryAxisAlign::Center => PrimaryAxisAlignDto::Center,
                        PrimaryAxisAlign::End => PrimaryAxisAlignDto::End,
                        PrimaryAxisAlign::SpaceBetween => PrimaryAxisAlignDto::SpaceBetween,
                    },
                    counter_axis_align: match layout.counter_axis_align {
                        CounterAxisAlign::Start => CounterAxisAlignDto::Start,
                        CounterAxisAlign::Center => CounterAxisAlignDto::Center,
                        CounterAxisAlign::End => CounterAxisAlignDto::End,
                        CounterAxisAlign::Stretch => CounterAxisAlignDto::Stretch,
                    },
                    sizing: match layout.sizing {
                        FrameSizing::Hug => FrameSizingDto::Hug,
                        FrameSizing::Fixed => FrameSizingDto::Fixed,
                    },
                }),
            })?,
        ),
        Element::Image(inner) => (
            TYPE_IMAGE,
            serde_json::to_value(ImageDto {
                base: base_to_dto(&inner.base),
                asset_id: inner.asset_id.clone(),
                natural_width: inner.natural_width,
                natural_height: inner.natural_height,
                crop: inner.crop.map(|crop| CropDto {
                    x: crop.x,
                    y: crop.y,
                    width: crop.width,
                    height: crop.height,
                }),
            })?,
        ),
        Element::Path(inner) => (
            TYPE_PATH,
            serde_json::to_value(PathDto {
                base: base_to_dto(&inner.base),
                segments: inner
                    .segments
                    .iter()
                    .map(|segment| PathSegmentDto {
                        point: segment.point,
                        handle_in: segment.handle_in,
                        handle_out: segment.handle_out,
                    })
                    .collect(),
                closed: inner.closed,
            })?,
        ),
        Element::Instance(inner) => (
            TYPE_INSTANCE,
            serde_json::to_value(InstanceDto {
                base: base_to_dto(&inner.base),
                component_id: inner.component_id.clone(),
                overrides: inner
                    .overrides
                    .iter()
                    .map(|(key, patch)| (key.clone(), patch_to_value(patch)))
                    .collect(),
            })?,
        ),
        Element::Custom(inner) => {
            let mut map = serde_json::Map::new();
            map.insert("type".to_string(), Value::String(inner.type_name.clone()));
            let base_dto = base_to_dto(&inner.base);
            if let Value::Object(base_map) = serde_json::to_value(base_dto)? {
                for (k, v) in base_map {
                    map.insert(k, v);
                }
            }
            for (key, patch) in &inner.data {
                map.insert(key.clone(), patch_to_value(patch));
            }
            (inner.type_name.as_str(), Value::Object(map))
        }
    };
    if let Value::Object(ref mut map) = value {
        map.insert("type".to_string(), Value::String(tag.to_string()));
    }
    Ok(value)
}
