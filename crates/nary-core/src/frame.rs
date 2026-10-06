//! Frame containment and child operations.
//!
//! TS source: `packages/core/src/scene/frame-actions.ts` (AABB containment,
//! child move/release, `DEFAULT_CONSTRAINTS`). Frame clipping itself is a
//! render-loop pass, not document state.
//!
//! Parent/child addressing via `frame_id`, topmost-frame assignment, and
//! child move/release. Constraint *application* on resize and auto-layout
//! consume this addressing.

use nary_geometry::Bounds;

use crate::document::Document;
use crate::element::{ConstraintAnchor, Constraints, Element, ElementId};
use crate::EngineResult;

/// Default constraints for an element newly assigned to a frame: pin
/// left/top (Figma convention, TS `DEFAULT_CONSTRAINTS`).
pub const DEFAULT_CONSTRAINTS: Constraints = Constraints {
    horizontal: ConstraintAnchor::Min,
    vertical: ConstraintAnchor::Min,
};

/// Inclusive AABB containment (touching frame edges count as inside),
/// mirroring TS `isContainedInFrame`.
pub fn is_contained(child: &Bounds, frame: &Bounds) -> bool {
    frame.contains(child)
}

/// Assigns elements to frames by spatial containment.
///
/// An element whose bounds sit fully inside a frame becomes that frame's
/// child; the topmost (last in z-order) containing frame wins. With `None`,
/// every non-frame element is checked; with `Some`, only the listed ids
/// (existing, non-deleted, non-frame) are. Newly assigned elements without
/// constraints receive [`DEFAULT_CONSTRAINTS`] (TS parity).
pub fn auto_assign_to_frames(
    doc: &mut Document,
    element_ids: Option<&[ElementId]>,
) -> EngineResult<()> {
    let frame_ids: Vec<ElementId> = doc
        .get_all()
        .iter()
        .filter(|element| matches!(element, Element::Frame(_)))
        .map(|element| (*element).id().clone())
        .collect();
    if frame_ids.is_empty() {
        return Ok(());
    }

    let candidates: Vec<ElementId> = match element_ids {
        Some(ids) => ids
            .iter()
            .filter(|id| {
                doc.get(id.as_str()).is_some_and(|element| {
                    !element.base().is_deleted && !matches!(element, Element::Frame(_))
                })
            })
            .cloned()
            .collect(),
        None => doc
            .get_all()
            .iter()
            .filter(|element| !matches!(element, Element::Frame(_)))
            .map(|element| (*element).id().clone())
            .collect(),
    };

    for id in candidates {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        let element_bounds = element.bounds();
        let mut assigned: Option<ElementId> = None;
        for frame_id in &frame_ids {
            // Frames were collected from live elements above.
            if let Some(frame) = doc.get(frame_id.as_str()) {
                if is_contained(&element_bounds, &frame.bounds()) {
                    assigned = Some(frame_id.clone());
                }
            }
        }
        let current = element.base().frame_id.clone();
        if assigned != current {
            let is_newly_assigned = assigned.is_some() && current.is_none();
            let mut next = element.clone();
            next.base_mut().frame_id = assigned;
            if is_newly_assigned && next.base().constraints.is_none() {
                next.base_mut().constraints = Some(DEFAULT_CONSTRAINTS);
            }
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Returns the child ids of a frame, in z-order.
pub fn frame_children(doc: &Document, frame_id: &str) -> Vec<ElementId> {
    doc.get_all()
        .iter()
        .filter(|element| {
            element
                .base()
                .frame_id
                .as_ref()
                .is_some_and(|owner| owner.as_str() == frame_id)
        })
        .map(|element| (*element).id().clone())
        .collect()
}

/// Moves every child of a frame by a scene-space delta.
pub fn move_frame_children(
    doc: &mut Document,
    frame_id: &str,
    dx: f64,
    dy: f64,
) -> EngineResult<()> {
    if !dx.is_finite() || !dy.is_finite() {
        return Err(crate::EngineError::InvalidInput(
            "frame child move delta must be finite".to_string(),
        ));
    }
    for child_id in frame_children(doc, frame_id) {
        if let Some(child) = doc.get(child_id.as_str()) {
            let mut next = child.clone();
            next.base_mut().x += dx;
            next.base_mut().y += dy;
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Detaches every child of a frame (`frame_id = None`).
pub fn clear_frame_children(doc: &mut Document, frame_id: &str) -> EngineResult<()> {
    for child_id in frame_children(doc, frame_id) {
        if let Some(child) = doc.get(child_id.as_str()) {
            let mut next = child.clone();
            next.base_mut().frame_id = None;
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Releases a frame's children when the frame is deleted (Figma
/// convention: the frame goes, children stay as free elements).
pub fn release_frame_children_on_delete(doc: &mut Document, frame_id: &str) -> EngineResult<()> {
    clear_frame_children(doc, frame_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_frame, create_rectangle, CounterIdGenerator, Element};

    fn rectangle(
        gen: &mut CounterIdGenerator,
        id: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        rect.base.x = x;
        rect.base.y = y;
        rect.base.width = w;
        rect.base.height = h;
        Element::Rectangle(rect)
    }

    fn frame(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
        let mut frame = create_frame(gen);
        frame.base.id = ElementId::of(id);
        frame.base.x = x;
        frame.base.y = y;
        frame.base.width = w;
        frame.base.height = h;
        Element::Frame(frame)
    }

    #[test]
    fn containment_assigns_topmost_frame_with_defaults() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(frame(&mut gen, "f1", 0.0, 0.0, 200.0, 200.0))
            .unwrap();
        doc.upsert(frame(&mut gen, "f2", 10.0, 10.0, 100.0, 100.0))
            .unwrap();
        doc.upsert(rectangle(&mut gen, "inside", 20.0, 20.0, 10.0, 10.0))
            .unwrap();
        doc.upsert(rectangle(&mut gen, "outside", 500.0, 500.0, 10.0, 10.0))
            .unwrap();

        auto_assign_to_frames(&mut doc, None).unwrap();

        // Nested frames: the topmost containing frame wins.
        assert_eq!(
            doc.get("inside").unwrap().base().frame_id,
            Some(ElementId::of("f2"))
        );
        assert_eq!(
            doc.get("inside").unwrap().base().constraints,
            Some(DEFAULT_CONSTRAINTS)
        );
        assert_eq!(doc.get("outside").unwrap().base().frame_id, None);
    }

    #[test]
    fn move_and_release_children() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(frame(&mut gen, "f1", 0.0, 0.0, 200.0, 200.0))
            .unwrap();
        doc.upsert(rectangle(&mut gen, "child", 20.0, 30.0, 10.0, 10.0))
            .unwrap();
        auto_assign_to_frames(&mut doc, None).unwrap();
        assert_eq!(frame_children(&doc, "f1"), vec![ElementId::of("child")]);

        move_frame_children(&mut doc, "f1", 5.0, -5.0).unwrap();
        let child = doc.get("child").unwrap();
        assert_eq!(child.base().x, 25.0);
        assert_eq!(child.base().y, 25.0);

        release_frame_children_on_delete(&mut doc, "f1").unwrap();
        assert_eq!(doc.get("child").unwrap().base().frame_id, None);
        assert!(frame_children(&doc, "f1").is_empty());
    }

    #[test]
    fn move_rejects_non_finite_delta() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(frame(&mut gen, "f1", 0.0, 0.0, 200.0, 200.0))
            .unwrap();
        assert!(move_frame_children(&mut doc, "f1", f64::NAN, 0.0).is_err());
    }
}
