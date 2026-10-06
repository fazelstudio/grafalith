//! Group / ungroup and member queries.
//!
//! TS source: `packages/core/src/scene/group-actions.ts` (group/ungroup,
//! member queries, outermost-group; group-click member expansion lives in
//! the editor session, the pure part lives here).
//!
//! Group membership over stable ids (`groupIds`, innermost-first), never
//! indexes. Fresh group ids come from the document's id source, so grouping
//! stays instance-scoped instead of using the TS `Date.now()` +
//! `Math.random()` global recipe.

use crate::document::Document;
use crate::element::ElementId;
use crate::EngineResult;

/// Creates a group from the given element ids and returns the fresh group
/// id. Only stored, non-deleted elements are tagged; unknown or deleted
/// ids are skipped (TS parity). The id is minted even when nothing is
/// tagged (TS parity).
pub fn group_elements(doc: &mut Document, element_ids: &[ElementId]) -> EngineResult<ElementId> {
    let group_id = doc.next_group_id();
    for id in element_ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted {
            continue;
        }
        let mut next = element.clone();
        next.base_mut().group_ids.push(group_id.clone());
        doc.upsert(next)?;
    }
    Ok(group_id)
}

/// Removes a group, clearing it from every member's `groupIds`. Nested
/// groups keep their other memberships (only the named id is stripped).
pub fn ungroup_elements(doc: &mut Document, group_id: &ElementId) -> EngineResult<()> {
    let members: Vec<ElementId> = doc
        .get_all()
        .iter()
        .filter(|element| element.base().group_ids.contains(group_id))
        .map(|element| (*element).id().clone())
        .collect();
    for id in members {
        if let Some(element) = doc.get(id.as_str()) {
            let mut next = element.clone();
            next.base_mut()
                .group_ids
                .retain(|member| member != group_id);
            doc.upsert(next)?;
        }
    }
    Ok(())
}

/// Returns the ids sharing the element's outermost group. Ungrouped or
/// unknown elements yield just the queried id (TS parity — including the
/// unknown-id quirk, documented here instead of silently "fixed").
pub fn group_members(doc: &Document, element_id: &str) -> Vec<ElementId> {
    let Some(element) = doc.get(element_id) else {
        return vec![ElementId::of(element_id)];
    };
    let Some(outermost) = element.base().group_ids.last() else {
        return vec![ElementId::of(element_id)];
    };
    doc.get_all()
        .iter()
        .filter(|member| member.base().group_ids.contains(outermost))
        .map(|member| (*member).id().clone())
        .collect()
}

/// Returns the outermost group id, or `None` when ungrouped/unknown.
pub fn outermost_group_id(doc: &Document, element_id: &str) -> Option<ElementId> {
    doc.get(element_id)?.base().group_ids.last().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn group_tags_members_innermost_first() {
        let (mut doc, _) = document_with(&["a", "b", "c"]);
        let group = group_elements(&mut doc, &[ElementId::of("a"), ElementId::of("b")]).unwrap();
        assert_eq!(group_members(&doc, "a").len(), 2);
        assert_eq!(outermost_group_id(&doc, "a"), Some(group.clone()));
        assert_eq!(outermost_group_id(&doc, "c"), None);
        // Nested group stacks outermost-last.
        let outer = group_elements(&mut doc, &[ElementId::of("a"), ElementId::of("c")]).unwrap();
        assert_eq!(doc.get("a").unwrap().base().group_ids.len(), 2);
        assert_eq!(outermost_group_id(&doc, "a"), Some(outer));
    }

    #[test]
    fn ungroup_strips_only_the_named_group() {
        let (mut doc, _) = document_with(&["a", "b"]);
        let group = group_elements(&mut doc, &[ElementId::of("a"), ElementId::of("b")]).unwrap();
        let outer = group_elements(&mut doc, &[ElementId::of("a"), ElementId::of("b")]).unwrap();
        ungroup_elements(&mut doc, &outer).unwrap();
        assert_eq!(doc.get("a").unwrap().base().group_ids, vec![group.clone()]);
        ungroup_elements(&mut doc, &group).unwrap();
        assert!(doc.get("a").unwrap().base().group_ids.is_empty());
        assert!(doc.get("b").unwrap().base().group_ids.is_empty());
    }

    #[test]
    fn group_skips_deleted_and_unknown() {
        let (mut doc, _) = document_with(&["a", "b"]);
        doc.soft_delete("b").unwrap();
        let group = group_elements(
            &mut doc,
            &[
                ElementId::of("a"),
                ElementId::of("b"),
                ElementId::of("ghost"),
            ],
        )
        .unwrap();
        assert!(doc.get("a").unwrap().base().group_ids.contains(&group));
        // Deleted member untouched.
        assert!(doc.get("b").unwrap().base().group_ids.is_empty());
        assert_eq!(group_members(&doc, "ghost"), vec![ElementId::of("ghost")]);
    }
}
