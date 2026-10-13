//! Lock / unlock operations.
//!
//! Local flags live on each node while the observed state inherits through
//! ancestors. Locking a group container makes every descendant effectively
//! locked without rewriting stored child flags, and unlocking restores each
//! descendant to its own stored flag.

use crate::command::{Command, SetGroupLocked};
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

/// Sets the local lock flag on group containers.
pub fn lock_groups(doc: &mut Document, group_ids: &[ElementId]) -> EngineResult<()> {
    set_group_locked(doc, group_ids, true)
}

/// Clears the local lock flag on group containers.
pub fn unlock_groups(doc: &mut Document, group_ids: &[ElementId]) -> EngineResult<()> {
    set_group_locked(doc, group_ids, false)
}

/// Shared group lock writer.
fn set_group_locked(doc: &mut Document, group_ids: &[ElementId], locked: bool) -> EngineResult<()> {
    let mut groups = doc.groups();
    let mut touched = false;
    for id in group_ids {
        if let Some(record) = groups.iter_mut().find(|group| group.id == *id) {
            if record.locked != locked {
                record.locked = locked;
                touched = true;
            }
        }
    }
    if touched {
        doc.set_groups(groups)?;
    }
    Ok(())
}

/// Direct wrapper for the history-backed group lock command.
pub fn apply_group_lock(
    ctx: &mut crate::command::CommandContext,
    ids: &[ElementId],
    locked: bool,
) -> EngineResult<crate::command::CommandOutcome> {
    let mut cmd = SetGroupLocked::new(ids.to_vec(), locked);
    cmd.execute(ctx)
}

/// Returns `true` when the node is effectively locked through itself or an
/// ancestor container.
pub fn is_effectively_locked(doc: &Document, id: &str) -> bool {
    doc.effective_locked(id)
}

/// Returns `true` when the group container is effectively locked through
/// itself or an ancestor container.
pub fn is_group_effectively_locked(doc: &Document, group_id: &str) -> bool {
    doc.group_effective_locked(group_id)
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
