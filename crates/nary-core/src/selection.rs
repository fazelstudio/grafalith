//! Transient selection state — explicitly NOT persistent.
//!
//! Transient UI state (`hovered`, `selected`, `editing`, `dragging`) must
//! never serialize into the document. [`SelectionState`] lives outside
//! [`crate::document::Document`], carries no version/nonce, and
//! [`crate::document::Document::to_snapshot`] cannot observe it by
//! construction.
//!
//! Selection *gestures* (click ordering, rubber-band, group-aware
//! expansion) are editor-session logic; this type is the structure those
//! gestures read and write.

use crate::element::ElementId;

/// Ordered, de-duplicated set of selected element ids.
///
/// Insertion order is preserved (first occurrence wins); the document's
/// z-order remains the single source for hit-test layering.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelectionState {
    /// Selected ids in selection order.
    selected: Vec<ElementId>,
}

impl SelectionState {
    /// Creates an empty selection.
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the selection, de-duplicating while preserving order.
    pub fn select(&mut self, ids: Vec<ElementId>) {
        let mut deduped = Vec::with_capacity(ids.len());
        for id in ids {
            if !deduped.contains(&id) {
                deduped.push(id);
            }
        }
        self.selected = deduped;
    }

    /// Adds an id when absent.
    pub fn add(&mut self, id: ElementId) {
        if !self.selected.contains(&id) {
            self.selected.push(id);
        }
    }

    /// Removes an id when present.
    pub fn remove(&mut self, id: &ElementId) {
        self.selected.retain(|selected| selected != id);
    }

    /// Toggles membership: present ids are removed, absent ids appended.
    pub fn toggle(&mut self, id: ElementId) {
        if self.selected.contains(&id) {
            self.remove(&id);
        } else {
            self.selected.push(id);
        }
    }

    /// Clears the selection.
    pub fn clear(&mut self) {
        self.selected.clear();
    }

    /// Returns `true` when the id is selected.
    pub fn contains(&self, id: &ElementId) -> bool {
        self.selected.contains(id)
    }

    /// Returns `true` when nothing is selected.
    pub fn is_empty(&self) -> bool {
        self.selected.is_empty()
    }

    /// Number of selected ids.
    pub fn len(&self) -> usize {
        self.selected.len()
    }

    /// Borrows the selected ids in selection order.
    pub fn ids(&self) -> &[ElementId] {
        &self.selected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_is_an_ordered_deduped_set() {
        let mut selection = SelectionState::new();
        assert!(selection.is_empty());
        selection.select(vec![
            ElementId::of("b"),
            ElementId::of("a"),
            ElementId::of("b"),
        ]);
        assert_eq!(selection.ids(), &[ElementId::of("b"), ElementId::of("a")]);
        selection.toggle(ElementId::of("a"));
        assert_eq!(selection.ids(), &[ElementId::of("b")]);
        selection.toggle(ElementId::of("c"));
        assert!(selection.contains(&ElementId::of("c")));
        assert_eq!(selection.len(), 2);
        selection.remove(&ElementId::of("b"));
        selection.clear();
        assert!(selection.is_empty());
    }
}
