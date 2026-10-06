//! Boolean operations as document commands (rectangles exact, closed
//! paths via flatten + `i_overlay`).
//!
//! Set ops (`union`, `subtract`, `intersect`, `exclude`) over exactly two
//! unrotated rectangles and/or closed paths, committed as one undoable
//! entry: both inputs are soft-deleted and every result becomes a fresh
//! element inheriting the first input's style (stroke, fill, opacity,
//! hatching, frame membership, visibility) with fresh ids, version 0, and
//! no group membership (regrouping stays an explicit user action).
//!
//! Rectangle pairs compute exactly ([`crate::geometry::boolean`]); any pair
//! involving a path flattens to polygons first (see [`crate::path_boolean`]
//! for the precision contract — exact on flattened polygons, holed results
//! unsupported).
//!
//! Scope rules (explicit, never silent):
//!
//! - unknown or deleted ids are `NotFound`;
//! - locked inputs are `InvalidInput` (locked elements never participate in
//!   destructive ops);
//! - rotated inputs are `InvalidInput` (unrotate first — results cannot
//!   faithfully cover rotated inputs, and silent AABB approximation would
//!   violate the explicit-over-implicit rule);
//! - open paths are `InvalidInput` (only closed paths combine);
//! - other element types are `Unsupported`: path coverage beyond closed
//!   paths (and holed results) is follow-up work, recorded in ADR-0020.

use crate::document::Document;
use crate::element::{BaseElement, Element, ElementId, PathElement, PathSegment, RectangleElement};
use crate::geometry::boolean;
use crate::geometry::point::Point;
use crate::geometry::rect::Bounds;
use crate::path_boolean::{flatten_closed_path, path_overlay};
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

/// Validated inputs plus results (pure: borrows the document, stores
/// nothing). Callers mint fresh ids and commit through a history
/// transaction.
pub struct BooleanPlan {
    /// First input id (style source).
    pub first: ElementId,
    /// Second input id.
    pub second: ElementId,
    /// Style source base (first input's base, cloned).
    pub style_source: BaseElement,
    /// Results: exact boxes, or absolute path anchors for polygon results
    /// (possibly empty: full-cover subtraction destroys).
    pub results: BooleanResults,
}

/// Planned result payloads: exact boxes or absolute path anchors.
#[derive(Debug, Clone, PartialEq)]
pub enum BooleanResults {
    /// Exact rectangle boxes.
    Rects(Vec<Bounds>),
    /// Absolute scene-space anchors per result path.
    Paths(Vec<Vec<Point>>),
}

/// One validated operand: a rectangle box or a flattened closed contour.
enum Operand {
    Rect(Bounds),
    Path(Vec<Point>),
}

/// Validates one input and converts it to an operand.
fn live_operand(doc: &Document, op: &'static str, id: &ElementId) -> EngineResult<Operand> {
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
    if base.rotation != 0.0 {
        return Err(EngineError::InvalidInput(format!(
            "boolean.{op}: element '{}' is rotated; unrotate before combining",
            id.as_str()
        )));
    }
    match element {
        Element::Rectangle(_) => Ok(Operand::Rect(Bounds::from_xywh(
            base.x,
            base.y,
            base.width,
            base.height,
        ))),
        Element::Path(path) => {
            if !path.closed {
                return Err(EngineError::InvalidInput(format!(
                    "boolean.{op}: element '{}' is an open path; only closed paths combine",
                    id.as_str()
                )));
            }
            let contour = flatten_closed_path([base.x, base.y], &path.segments);
            if contour_area(&contour) <= 0.0 {
                return Err(EngineError::InvalidInput(format!(
                    "boolean.{op}: element '{}' flattens to a degenerate contour",
                    id.as_str()
                )));
            }
            Ok(Operand::Path(contour))
        }
        _ => Err(EngineError::Unsupported(format!(
            "boolean.{op} supports rectangles and closed paths only in this version; '{}' is '{}'",
            id.as_str(),
            element.element_type_name()
        ))),
    }
}

/// Shoelace area (absolute value, orientation-independent).
fn contour_area(contour: &[Point]) -> f64 {
    if contour.len() < 3 {
        return 0.0;
    }
    let mut area = 0.0;
    for i in 0..contour.len() {
        let [x0, y0] = contour[i];
        let [x1, y1] = contour[(i + 1) % contour.len()];
        area += x0 * y1 - x1 * y0;
    }
    (area / 2.0).abs()
}

/// Four corners of a box as a closed-implicit contour.
fn rect_contour(bounds: &Bounds) -> Vec<Point> {
    vec![
        [bounds.min_x, bounds.min_y],
        [bounds.max_x, bounds.min_y],
        [bounds.max_x, bounds.max_y],
        [bounds.min_x, bounds.max_y],
    ]
}

/// Validates two inputs and computes the results: exact boxes for
/// rectangle pairs, flattened-polygon paths otherwise.
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
    let first_operand = live_operand(doc, op, &first)?;
    let second_operand = live_operand(doc, op, &second)?;
    let style_source = doc
        .get(first.as_str())
        .map(|element| element.base().clone());
    let Some(style_source) = style_source else {
        return Err(EngineError::NotFound(format!(
            "boolean.{op}: unknown element '{}'",
            first.as_str()
        )));
    };
    let results = match (first_operand, second_operand) {
        (Operand::Rect(first_box), Operand::Rect(second_box)) => {
            BooleanResults::Rects(match kind {
                BooleanOp::Union => boolean::union_partition(&first_box, &second_box),
                BooleanOp::Subtract => boolean::subtract(&first_box, &second_box),
                BooleanOp::Intersect => boolean::intersect(&first_box, &second_box)
                    .into_iter()
                    .collect(),
                BooleanOp::Exclude => boolean::exclude(&first_box, &second_box),
            })
        }
        (Operand::Rect(first_box), Operand::Path(second_contour)) => BooleanResults::Paths(
            path_overlay(kind, &rect_contour(&first_box), &second_contour)?,
        ),
        (Operand::Path(first_contour), Operand::Rect(second_box)) => BooleanResults::Paths(
            path_overlay(kind, &first_contour, &rect_contour(&second_box))?,
        ),
        (Operand::Path(first_contour), Operand::Path(second_contour)) => {
            BooleanResults::Paths(path_overlay(kind, &first_contour, &second_contour)?)
        }
    };
    Ok(BooleanPlan {
        first,
        second,
        style_source,
        results,
    })
}

/// Shared fresh-result base: first input's paint, frame membership, and
/// visibility; fresh identity, ungrouped, unlocked. Takes the tight
/// `Bounds` (not four scalars) to stay under the argument-count lint.
fn result_base(
    style_source: &BaseElement,
    id: ElementId,
    seed: u32,
    nonce: u32,
    bounds: &Bounds,
) -> BaseElement {
    BaseElement {
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
        stroke_cap: style_source.stroke_cap,
        stroke_join: style_source.stroke_join,
        stroke_align: style_source.stroke_align,
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
    }
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
        base: result_base(style_source, id, seed, nonce, bounds),
        roundness: None,
        // Fresh results start sharp; per-corner styling is a follow-up
        // user edit, like regrouping.
        corners: None,
    })
}

/// Builds one fresh result path over absolute `anchors`, re-based to a
/// tight origin box with sharp (handle-free) segments, inheriting the
/// style source's paint, frame membership, and visibility.
pub fn path_result_element(
    style_source: &BaseElement,
    id: ElementId,
    seed: u32,
    nonce: u32,
    anchors: &[Point],
) -> Element {
    let min_x = anchors
        .iter()
        .map(|point| point[0])
        .fold(f64::INFINITY, f64::min);
    let min_y = anchors
        .iter()
        .map(|point| point[1])
        .fold(f64::INFINITY, f64::min);
    let max_x = anchors
        .iter()
        .map(|point| point[0])
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = anchors
        .iter()
        .map(|point| point[1])
        .fold(f64::NEG_INFINITY, f64::max);
    Element::Path(PathElement {
        base: result_base(
            style_source,
            id,
            seed,
            nonce,
            &Bounds::new(min_x, min_y, max_x, max_y),
        ),
        segments: anchors
            .iter()
            .map(|point| PathSegment {
                point: [point[0] - min_x, point[1] - min_y],
                handle_in: None,
                handle_out: None,
            })
            .collect(),
        closed: true,
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
        assert!(matches!(union.results, BooleanResults::Rects(ref boxes) if boxes.len() == 3));
        let subtract = plan_boolean(&doc, BooleanOp::Subtract, a.clone(), b.clone()).unwrap();
        assert!(matches!(subtract.results, BooleanResults::Rects(ref boxes) if boxes.len() == 2));
        let intersect = plan_boolean(&doc, BooleanOp::Intersect, a.clone(), b.clone()).unwrap();
        assert_eq!(
            intersect.results,
            BooleanResults::Rects(vec![Bounds::new(5.0, 5.0, 10.0, 10.0)])
        );
        let exclude = plan_boolean(&doc, BooleanOp::Exclude, a.clone(), b.clone()).unwrap();
        assert!(matches!(exclude.results, BooleanResults::Rects(ref boxes) if boxes.len() == 4));
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

#[cfg(test)]
mod path_plan_tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator, PathElement, PathSegment};

    fn closed_square(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64, size: f64) -> Element {
        let mut base = create_rectangle(gen).base;
        base.id = ElementId::of(id);
        base.x = x;
        base.y = y;
        base.width = size;
        base.height = size;
        Element::Path(PathElement {
            base,
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [size, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [size, size],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [0.0, size],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: true,
        })
    }

    fn two_squares() -> (Document, ElementId, ElementId) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(closed_square(&mut gen, "p", 0.0, 0.0, 10.0))
            .unwrap();
        doc.upsert(closed_square(&mut gen, "q", 5.0, 5.0, 10.0))
            .unwrap();
        (doc, ElementId::of("p"), ElementId::of("q"))
    }

    fn path_area(results: &BooleanResults) -> f64 {
        let BooleanResults::Paths(contours) = results else {
            panic!("expected path results");
        };
        contours.iter().map(|contour| contour_area(contour)).sum()
    }

    #[test]
    fn path_pairs_combine_through_polygons() {
        let (doc, p, q) = two_squares();
        let union = plan_boolean(&doc, BooleanOp::Union, p.clone(), q.clone()).unwrap();
        assert!((path_area(&union.results) - 175.0).abs() < 1e-9);
        let intersect = plan_boolean(&doc, BooleanOp::Intersect, p.clone(), q.clone()).unwrap();
        assert!((path_area(&intersect.results) - 25.0).abs() < 1e-9);
        let subtract = plan_boolean(&doc, BooleanOp::Subtract, p.clone(), q.clone()).unwrap();
        assert!((path_area(&subtract.results) - 75.0).abs() < 1e-9);
        // Results rebase to a tight origin box as closed sharp paths.
        let BooleanResults::Paths(contours) = &union.results else {
            panic!("expected path results");
        };
        assert_eq!(contours.len(), 1);
        assert!(contours[0]
            .iter()
            .all(|point| point[0] >= 0.0 && point[1] >= 0.0));
    }

    #[test]
    fn mixed_rect_and_path_pairs_combine() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of("r");
        rect.base.x = 0.0;
        rect.base.y = 0.0;
        rect.base.width = 10.0;
        rect.base.height = 10.0;
        doc.upsert(Element::Rectangle(rect)).unwrap();
        doc.upsert(closed_square(&mut gen, "p", 5.0, 5.0, 10.0))
            .unwrap();
        let union = plan_boolean(
            &doc,
            BooleanOp::Union,
            ElementId::of("r"),
            ElementId::of("p"),
        )
        .unwrap();
        assert!((path_area(&union.results) - 175.0).abs() < 1e-9);
    }

    #[test]
    fn open_paths_are_invalid_and_holed_results_unsupported() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut open = closed_square(&mut gen, "open", 0.0, 0.0, 10.0);
        if let Element::Path(ref mut path) = open {
            path.closed = false;
        }
        doc.upsert(open).unwrap();
        doc.upsert(closed_square(&mut gen, "shut", 20.0, 20.0, 10.0))
            .unwrap();
        assert!(matches!(
            plan_boolean(
                &doc,
                BooleanOp::Union,
                ElementId::of("open"),
                ElementId::of("shut")
            ),
            Err(EngineError::InvalidInput(_))
        ));
        // Full-cover subtraction makes a hole: explicit Unsupported.
        let mut doc2 = Document::new();
        doc2.upsert(closed_square(&mut gen, "big", 0.0, 0.0, 10.0))
            .unwrap();
        doc2.upsert(closed_square(&mut gen, "hole", 3.0, 3.0, 4.0))
            .unwrap();
        assert!(matches!(
            plan_boolean(
                &doc2,
                BooleanOp::Subtract,
                ElementId::of("big"),
                ElementId::of("hole")
            ),
            Err(EngineError::Unsupported(_))
        ));
    }
}
