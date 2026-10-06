//! Lock / unlock operations.
//!
//! TS source: `packages/core/src/scene/lock-actions.ts`.
//!
//! Locked is a mutation guard, not a UI hint: locked elements are skipped
//! by destructive paths (delete, group tagging), and move/resize/rotate
//! skip them as well.

use crate::document::Document;
use crate::element::ElementId;
use crate::EngineResult;

/// Sets `locked = true` on stored, non-deleted elements. Unknown and
/// deleted ids are skipped (TS parity).
pub fn lock_elements(doc: &mut Document, element_ids: &[ElementId]) -> EngineResult<()> {
    set_locked(doc, element_ids, true)
}

/// Sets `locked = false` on stored, non-deleted elements.
pub fn unlock_elements(doc: &mut Document, element_ids: &[ElementId]) -> EngineResult<()> {
    set_locked(doc, element_ids, false)
}

/// Flips the lock flag on stored, non-deleted elements.
pub fn toggle_lock(doc: &mut Document, element_ids: &[ElementId]) -> EngineResult<()> {
    for id in element_ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted {
            continue;
        }
        let locked = !element.base().locked;
        let mut next = element.clone();
        next.base_mut().locked = locked;
        doc.upsert(next)?;
    }
    Ok(())
}

/// Shared lock writer for [`lock_elements`] and [`unlock_elements`].
fn set_locked(doc: &mut Document, element_ids: &[ElementId], locked: bool) -> EngineResult<()> {
    for id in element_ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted {
            continue;
        }
        let mut next = element.clone();
        next.base_mut().locked = locked;
        doc.upsert(next)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator, Element};

    fn document_with(ids: &[&str]) -> Document {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        for id in ids {
            let mut rect = create_rectangle(&mut gen);
            rect.base.id = ElementId::of(*id);
            doc.upsert(Element::Rectangle(rect)).unwrap();
        }
        doc
    }

    #[test]
    fn lock_unlock_toggle_cycle() {
        let mut doc = document_with(&["a", "b"]);
        lock_elements(&mut doc, &[ElementId::of("a")]).unwrap();
        assert!(doc.get("a").unwrap().base().locked);
        assert!(!doc.get("b").unwrap().base().locked);

        toggle_lock(&mut doc, &[ElementId::of("a"), ElementId::of("b")]).unwrap();
        assert!(!doc.get("a").unwrap().base().locked);
        assert!(doc.get("b").unwrap().base().locked);

        unlock_elements(&mut doc, &[ElementId::of("b")]).unwrap();
        assert!(!doc.get("b").unwrap().base().locked);
    }

    #[test]
    fn lock_skips_deleted_and_unknown() {
        let mut doc = document_with(&["a"]);
        doc.soft_delete("a").unwrap();
        let nonce_before = doc.scene_nonce();
        lock_elements(&mut doc, &[ElementId::of("a"), ElementId::of("ghost")]).unwrap();
        assert_eq!(
            doc.scene_nonce(),
            nonce_before,
            "skipped ids mutate nothing"
        );
        assert!(!doc.get("a").unwrap().base().locked);
    }
}
