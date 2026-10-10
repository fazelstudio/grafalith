//! Z-order operations (domain state, undoable, serialized).
//!
//! TS source: `packages/core/src/scene/layer-actions.ts`
//! (`bringToFront` / `sendToBack` / `bringForward` / `sendBackward` via
//! `setElementOrder`, so order deltas flow to history).
//!
//! Pure order operations over the document's explicit order vector. Render
//! order and hit-test order agree (top-wins: the last id in the order is
//! visually on top). One intentional hardening versus TS: unknown ids are
//! ignored instead of being spliced into the order, because ordering
//! references must stay valid.

use crate::document::Document;
use crate::element::ElementId;
use crate::EngineResult;

/// Moves elements to the front (end of the order vector).
///
/// Unknown ids are ignored; known ids keep their relative order.
pub fn bring_to_front(doc: &mut Document, ids: &[ElementId]) -> EngineResult<()> {
    let targets: Vec<ElementId> = ids
        .iter()
        .filter(|id| doc.contains(id.as_str()))
        .cloned()
        .collect();
    doc.set_order(bring_to_front_order(doc.order(), &targets))
}

/// Pure order math behind [`bring_to_front`]: `targets` must already be
/// filtered to known ids (the document check lives in the caller, so the
/// history-tracked `Reorder` command path and this direct path share one
/// implementation instead of two).
pub fn bring_to_front_order(current: Vec<ElementId>, targets: &[ElementId]) -> Vec<ElementId> {
    let mut next: Vec<ElementId> = current
        .into_iter()
        .filter(|id| !targets.contains(id))
        .collect();
    next.extend(targets.iter().cloned());
    next
}

/// Moves elements to the back (start of the order vector).
///
/// Unknown ids are ignored; known ids keep their relative order.
pub fn send_to_back(doc: &mut Document, ids: &[ElementId]) -> EngineResult<()> {
    let targets: Vec<ElementId> = ids
        .iter()
        .filter(|id| doc.contains(id.as_str()))
        .cloned()
        .collect();
    doc.set_order(send_to_back_order(doc.order(), &targets))
}

/// Pure order math behind [`send_to_back`] (see [`bring_to_front_order`]).
pub fn send_to_back_order(current: Vec<ElementId>, targets: &[ElementId]) -> Vec<ElementId> {
    let mut next: Vec<ElementId> = targets.to_vec();
    next.extend(current.into_iter().filter(|id| !targets.contains(id)));
    next
}

/// Moves elements forward by one step (TS `bringForward` swap loop).
pub fn bring_forward(doc: &mut Document, ids: &[ElementId]) -> EngineResult<()> {
    doc.set_order(bring_forward_order(doc.order(), ids))
}

/// Pure order math behind [`bring_forward`].
pub fn bring_forward_order(mut next: Vec<ElementId>, ids: &[ElementId]) -> Vec<ElementId> {
    // High index to low, so consecutive selections move as a block without
    // index-shift interference (TS parity).
    for i in (0..next.len().saturating_sub(1)).rev() {
        if ids.contains(&next[i]) && !ids.contains(&next[i + 1]) {
            next.swap(i, i + 1);
        }
    }
    next
}

/// Moves elements backward by one step (TS `sendBackward` swap loop).
pub fn send_backward(doc: &mut Document, ids: &[ElementId]) -> EngineResult<()> {
    doc.set_order(send_backward_order(doc.order(), ids))
}

/// Pure order math behind [`send_backward`].
pub fn send_backward_order(mut next: Vec<ElementId>, ids: &[ElementId]) -> Vec<ElementId> {
    // Low index to high, mirroring the forward loop (TS parity).
    for i in 1..next.len() {
        if ids.contains(&next[i]) && !ids.contains(&next[i - 1]) {
            next.swap(i, i - 1);
        }
    }
    next
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::element::{create_rectangle, CounterIdGenerator, Element};

    fn document_with(ids: &[&str]) -> (Document, CounterIdGenerator) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        for id in ids {
            let mut rect = create_rectangle(&mut gen);
            rect.base.id = ElementId::of(*id);
            doc.upsert(Element::Rectangle(rect)).unwrap();
        }
        (doc, gen)
    }

    fn order_names(doc: &Document) -> Vec<String> {
        doc.order()
            .iter()
            .map(|id| id.as_str().to_string())
            .collect()
    }

    #[test]
    fn front_and_back_reorder() {
        let (mut doc, _) = document_with(&["a", "b", "c"]);
        bring_to_front(&mut doc, &[ElementId::of("a")]).unwrap();
        assert_eq!(order_names(&doc), vec!["b", "c", "a"]);
        send_to_back(&mut doc, &[ElementId::of("c")]).unwrap();
        assert_eq!(order_names(&doc), vec!["c", "b", "a"]);
    }

    #[test]
    fn stepwise_moves_swap_one_position() {
        let (mut doc, _) = document_with(&["a", "b", "c"]);
        bring_forward(&mut doc, &[ElementId::of("a")]).unwrap();
        assert_eq!(order_names(&doc), vec!["b", "a", "c"]);
        send_backward(&mut doc, &[ElementId::of("a")]).unwrap();
        assert_eq!(order_names(&doc), vec!["a", "b", "c"]);
    }

    #[test]
    fn multi_selection_moves_as_a_block() {
        let (mut doc, _) = document_with(&["a", "b", "c", "d"]);
        bring_forward(&mut doc, &[ElementId::of("b"), ElementId::of("c")]).unwrap();
        assert_eq!(order_names(&doc), vec!["a", "d", "b", "c"]);
    }

    #[test]
    fn unknown_ids_are_ignored_not_spliced() {
        let (mut doc, _) = document_with(&["a", "b"]);
        bring_to_front(&mut doc, &[ElementId::of("ghost")]).unwrap();
        assert_eq!(order_names(&doc), vec!["a", "b"]);
        doc.validate().unwrap();
    }
}
