//! Rectangle boolean operations as document commands.
//!
//! Set ops (`union`, `subtract`, `intersect`, `exclude`) over exactly two
//! unrotated rectangles, computed exactly by
//! [`crate::geometry::boolean`] and committed as one undoable entry: both
//! inputs are soft-deleted and every result box becomes a fresh rectangle
//! inheriting the first input's style (stroke, fill, opacity, hatching,
//! frame membership, visibility) with fresh ids, version 0, and no group
//! membership (regrouping stays an explicit user action).
//!
//! Scope rules (explicit, never silent):
//!
//! - unknown or deleted ids are `NotFound`;
//! - locked inputs are `InvalidInput` (locked elements never participate in
//!   destructive ops);
//! - rotated inputs are `InvalidInput` (unrotate first — axis-aligned results
//!   cannot faithfully cover rotated inputs, and silent AABB approximation
//!   would violate the explicit-over-implicit rule);
//! - non-rectangle inputs are `Unsupported`: path boolean ops are a follow-up
//!   behind a precision ADR (`i_overlay` is the top candidate).

use crate::document::Document;
use crate::element::{BaseElement, Element, ElementId, RectangleElement};
use crate::geometry::boolean;
use crate::geometry::rect::Bounds;
use crate::EngineError;
use crate::EngineResult;

/// Boolean operation kind (one protocol op each).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BooleanOp {
    /// Exact disjoint cover of both inputs.
    Union,
    /// Parts of the first input not covered by the second.
    Subtract,
    /// Overlap of both inputs, or nothing when they only touch.
    Intersect,
    /// Parts covered by exactly one input.
    Exclude,
}

impl BooleanOp {
    /// Wire-facing operation name (stable, used in error messages).
    pub fn name(&self) -> &'static str {
        match self {
            BooleanOp::Union => "union",
            BooleanOp::Subtract => "subtract",
            BooleanOp::Intersect => "intersect",
            BooleanOp::Exclude => "exclude",
        }
    }
}

/// Validated inputs plus exact result boxes (pure: borrows the document,
/// stores nothing). Callers mint fresh ids and commit through a history
/// transaction.
pub struct BooleanPlan {
    /// First input id (style source).
    pub first: ElementId,
    /// Second input id.
    pub second: ElementId,
    /// Style source base (first input's base, cloned).
    pub style_source: BaseElement,
    /// Exact result boxes (possibly empty: full-cover subtraction destroys).
    pub results: Vec<Bounds>,
}

fn live_rectangle(doc: &Document, op: &'static str, id: &ElementId) -> EngineResult<Bounds> {
    let Some(element) = doc.get(id.as_str()) else {
        return Err(EngineError::NotFound(format!(
            "boolean.{op}: unknown element '{}'",
            id.as_str()
        )));
    };
    let base = element.base();
    if base.is_deleted {
        return Err(EngineError::NotFound(format!(
            "boolean.{op}: element '{}' is deleted",
            id.as_str()
        )));
    }
    if base.locked {
        return Err(EngineError::InvalidInput(format!(
            "boolean.{op}: element '{}' is locked",
            id.as_str()
        )));
    }
    if element.element_type_name() != "rectangle" {
        return Err(EngineError::Unsupported(format!(
            "boolean.{op} supports rectangle elements only in this version; '{}' is '{}'",
            id.as_str(),
            element.element_type_name()
        )));
    }
    if base.rotation != 0.0 {
        return Err(EngineError::InvalidInput(format!(
            "boolean.{op}: element '{}' is rotated; unrotate before combining",
            id.as_str()
        )));
    }
    Ok(Bounds::from_xywh(base.x, base.y, base.width, base.height))
}

/// Validates two inputs and computes the exact result boxes.
pub fn plan_boolean(
    doc: &Document,
    kind: BooleanOp,
    first: ElementId,
    second: ElementId,
) -> EngineResult<BooleanPlan> {
    let op = kind.name();
    if first == second {
        return Err(EngineError::InvalidInput(format!(
            "boolean.{op}: needs two distinct elements"
        )));
    }
    let first_box = live_rectangle(doc, op, &first)?;
    let second_box = live_rectangle(doc, op, &second)?;
    let style_source = doc
        .get(first.as_str())
        .map(|element| element.base().clone());
    let Some(style_source) = style_source else {
        return Err(EngineError::NotFound(format!(
            "boolean.{op}: unknown element '{}'",
            first.as_str()
        )));
    };
    let results = match kind {
        BooleanOp::Union => boolean::union_partition(&first_box, &second_box),
        BooleanOp::Subtract => boolean::subtract(&first_box, &second_box),
        BooleanOp::Intersect => boolean::intersect(&first_box, &second_box)
            .into_iter()
            .collect(),
        BooleanOp::Exclude => boolean::exclude(&first_box, &second_box),
    };
    Ok(BooleanPlan {
        first,
        second,
        style_source,
        results,
    })
}

/// Builds one fresh result rectangle over `bounds`, inheriting the style
/// source's paint, frame membership, and visibility.
pub fn result_element(
    style_source: &BaseElement,
    id: ElementId,
    seed: u32,
    nonce: u32,
    bounds: &Bounds,
) -> Element {
    Element::Rectangle(RectangleElement {
        base: BaseElement {
            id,
            x: bounds.min_x,
            y: bounds.min_y,
            width: bounds.max_x - bounds.min_x,
            height: bounds.max_y - bounds.min_y,
            rotation: 0.0,
            stroke_color: style_source.stroke_color.clone(),
            background_color: style_source.background_color.clone(),
            stroke_width: style_source.stroke_width,
            stroke_style: style_source.stroke_style,
            fill_style: style_source.fill_style,
            opacity: style_source.opacity,
            seed,
            version: 0,
            version_nonce: nonce,
            is_deleted: false,
            group_ids: Vec::new(),
            locked: false,
            hidden: style_source.hidden,
            frame_id: style_source.frame_id.clone(),
            constraints: None,
            child_layout_sizing: None,
        },
        roundness: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator};

    fn doc_with_two_rects() -> (Document, ElementId, ElementId) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut first = create_rectangle(&mut gen);
        first.base.id = ElementId::of("a");
        first.base.x = 0.0;
        first.base.y = 0.0;
        first.base.width = 10.0;
        first.base.height = 10.0;
        let mut second = create_rectangle(&mut gen);
        second.base.id = ElementId::of("b");
        second.base.x = 5.0;
        second.base.y = 5.0;
        second.base.width = 10.0;
        second.base.height = 10.0;
        doc.upsert(Element::Rectangle(first)).unwrap();
        doc.upsert(Element::Rectangle(second)).unwrap();
        (doc, ElementId::of("a"), ElementId::of("b"))
    }

    #[test]
    fn plan_computes_exact_boxes_per_kind() {
        let (doc, a, b) = doc_with_two_rects();
        let union = plan_boolean(&doc, BooleanOp::Union, a.clone(), b.clone()).unwrap();
        assert_eq!(union.results.len(), 3);
        let subtract = plan_boolean(&doc, BooleanOp::Subtract, a.clone(), b.clone()).unwrap();
        assert_eq!(subtract.results.len(), 2);
        let intersect = plan_boolean(&doc, BooleanOp::Intersect, a.clone(), b.clone()).unwrap();
        assert_eq!(intersect.results, vec![Bounds::new(5.0, 5.0, 10.0, 10.0)]);
        let exclude = plan_boolean(&doc, BooleanOp::Exclude, a.clone(), b.clone()).unwrap();
        assert_eq!(exclude.results.len(), 4);
    }

    #[test]
    fn plan_rejects_bad_inputs_explicitly() {
        let (doc, a, b) = doc_with_two_rects();
        assert!(matches!(
            plan_boolean(&doc, BooleanOp::Union, a.clone(), a.clone()),
            Err(EngineError::InvalidInput(_))
        ));
        assert!(matches!(
            plan_boolean(&doc, BooleanOp::Union, ElementId::of("ghost"), b.clone()),
            Err(EngineError::NotFound(_))
        ));
        // Non-rectangle input is Unsupported, never InvalidInput.
        let mut gen = CounterIdGenerator::new();
        let mut doc2 = Document::new();
        let mut ellipse = crate::element::create_ellipse(&mut gen);
        ellipse.base.id = ElementId::of("e");
        doc2.upsert(Element::Ellipse(ellipse)).unwrap();
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of("r");
        doc2.upsert(Element::Rectangle(rect)).unwrap();
        assert!(matches!(
            plan_boolean(
                &doc2,
                BooleanOp::Union,
                ElementId::of("e"),
                ElementId::of("r")
            ),
            Err(EngineError::Unsupported(_))
        ));
    }

    #[test]
    fn plan_rejects_locked_and_rotated_inputs() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut locked = create_rectangle(&mut gen);
        locked.base.id = ElementId::of("locked");
        locked.base.locked = true;
        doc.upsert(Element::Rectangle(locked)).unwrap();
        let mut rotated = create_rectangle(&mut gen);
        rotated.base.id = ElementId::of("rotated");
        rotated.base.rotation = 0.5;
        doc.upsert(Element::Rectangle(rotated)).unwrap();
        let mut plain = create_rectangle(&mut gen);
        plain.base.id = ElementId::of("plain");
        doc.upsert(Element::Rectangle(plain)).unwrap();
        assert!(matches!(
            plan_boolean(
                &doc,
                BooleanOp::Union,
                ElementId::of("locked"),
                ElementId::of("plain")
            ),
            Err(EngineError::InvalidInput(_))
        ));
        assert!(matches!(
            plan_boolean(
                &doc,
                BooleanOp::Union,
                ElementId::of("rotated"),
                ElementId::of("plain")
            ),
            Err(EngineError::InvalidInput(_))
        ));
    }
}
