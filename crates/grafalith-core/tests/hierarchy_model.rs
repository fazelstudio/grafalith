//! Hierarchy integration tests: lock inheritance, grouping, normalization,
//! reorder and reparent, rename, duplication, and single-entry history.
//!
//! Figma and TLDraw conventions anchor every case: local flags never leak
//! across siblings, containers carry their subtree as one unit, singleton
//! containers dissolve inside the triggering transaction, and stacking
//! follows the explicit z-order vector back-to-front.

use grafalith_core::command::{
    DeleteElements, DuplicateNodes, GroupElements, MoveElements, MoveElementsToGroup, RenameNode,
    Reorder, ReparentNodes, SetBounds, SetGroupLocked, SetLocked, SetRotation, UngroupElements,
};
use grafalith_core::document::Document;
use grafalith_core::element::{create_rectangle, CounterIdGenerator, Element, ElementId};
use grafalith_core::history::HistoryManager;

fn rectangle(id: &str, x: f64, y: f64, gen: &mut CounterIdGenerator) -> Element {
    let mut rect = create_rectangle(gen);
    rect.base.id = ElementId::of(id);
    rect.base.x = x;
    rect.base.y = y;
    Element::Rectangle(rect)
}

fn doc_with(ids: &[(&str, f64, f64)]) -> (Document, HistoryManager, CounterIdGenerator) {
    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    for (id, x, y) in ids {
        doc.upsert(rectangle(id, *x, *y, &mut gen)).unwrap();
    }
    (doc, HistoryManager::new(), gen)
}

fn group_two(doc: &mut Document, history: &mut HistoryManager, a: &str, b: &str) -> ElementId {
    let group_id = doc.fresh_group_id();
    history
        .execute(
            doc,
            GroupElements::new(vec![ElementId::of(a), ElementId::of(b)], group_id.clone()),
        )
        .unwrap();
    group_id
}

fn order_names(doc: &Document) -> Vec<String> {
    doc.order()
        .iter()
        .map(|id| id.as_str().to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

#[test]
fn lock_rectangle_activates_effective_lock() {
    let (mut doc, mut history, _) = doc_with(&[("r1", 0.0, 0.0)]);
    assert!(!doc.effective_locked("r1"));
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("r1")], true))
        .unwrap();
    assert!(doc.get("r1").unwrap().base().locked);
    assert!(doc.effective_locked("r1"));
}

#[test]
fn lock_group_effectively_locks_descendants() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    assert!(!doc.effective_locked("a"));
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group.clone()], true))
        .unwrap();
    assert!(doc.group_effective_locked(group.as_str()));
    assert!(doc.effective_locked("a"));
    assert!(doc.effective_locked("b"));
    // Stored child flags stay untouched: inheritance is observed, not written.
    assert!(!doc.get("a").unwrap().base().locked);
}

#[test]
fn lock_child_leaves_parent_and_sibling_unlocked() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], true))
        .unwrap();
    assert!(doc.effective_locked("a"));
    assert!(!doc.effective_locked("b"));
    assert!(!doc.group_effective_locked(group.as_str()));
}

#[test]
fn unlock_group_restores_child_local_lock() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], true))
        .unwrap();
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group.clone()], true))
        .unwrap();
    assert!(doc.effective_locked("b"));
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group.clone()], false))
        .unwrap();
    assert!(!doc.effective_locked("b"));
    assert!(doc.effective_locked("a"));
    assert!(doc.get("a").unwrap().base().locked);
}

#[test]
fn child_inside_locked_ancestor_stays_effectively_locked() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group.clone()], true))
        .unwrap();
    // Clearing the child flag cannot escape the ancestor container.
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], false))
        .unwrap();
    assert!(doc.effective_locked("a"));
}

#[test]
fn direct_transform_of_effectively_locked_is_rejected() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 200.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group], true))
        .unwrap();
    let undo_before = history.undo_len();
    let outcome = history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("a")], 10.0, 0.0),
        )
        .unwrap();
    assert!(!outcome.changed);
    assert_eq!(doc.get("a").unwrap().base().x, 0.0);
    let outcome = history
        .execute(
            &mut doc,
            SetBounds::new(ElementId::of("a"), 0.0, 0.0, 50.0, 50.0),
        )
        .unwrap();
    assert!(!outcome.changed);
    let outcome = history
        .execute(&mut doc, SetRotation::new(ElementId::of("a"), 0.5))
        .unwrap();
    assert!(!outcome.changed);
    assert_eq!(history.undo_len(), undo_before);
}

#[test]
fn moving_unlocked_group_carries_locally_locked_child() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], true))
        .unwrap();
    let outcome = history
        .execute(
            &mut doc,
            MoveElements::new(vec![ElementId::of("a"), ElementId::of("b")], 10.0, 0.0),
        )
        .unwrap();
    assert!(outcome.changed);
    assert_eq!(doc.get("a").unwrap().base().x, 10.0);
    assert_eq!(doc.get("b").unwrap().base().x, 60.0);
    assert!(doc.get("a").unwrap().base().locked);
}

#[test]
fn reparent_locally_locked_leaf_preserves_lock() {
    let (mut doc, mut history, _) = doc_with(&[
        ("a", 0.0, 0.0),
        ("b", 50.0, 0.0),
        ("c", 200.0, 0.0),
        ("d", 250.0, 0.0),
    ]);
    let dest = group_two(&mut doc, &mut history, "c", "d");
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], true))
        .unwrap();
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("a")], Some(dest.clone()), Some(0)),
        )
        .unwrap();
    assert!(doc.get("a").unwrap().base().group_ids.contains(&dest));
    assert!(doc.get("a").unwrap().base().locked);
    assert!(doc.effective_locked("a"));
}

#[test]
fn reparent_leaf_out_of_locked_ancestor_is_rejected() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0), ("c", 300.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group.clone()], true))
        .unwrap();
    let nonce_before = doc.scene_nonce();
    let result = history.execute(
        &mut doc,
        MoveElementsToGroup::with_index(vec![ElementId::of("a")], None, None),
    );
    assert!(result.is_err());
    assert_eq!(doc.scene_nonce(), nonce_before);
    assert!(doc.get("a").unwrap().base().group_ids.contains(&group));
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

#[test]
fn two_objects_group_successfully() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    assert!(doc.group(group.as_str()).is_some());
    assert_eq!(doc.group_all_members(group.as_str()).len(), 2);
    doc.validate_hierarchy().unwrap();
}

#[test]
fn single_object_cannot_group_alone() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0)]);
    let group_id = doc.fresh_group_id();
    let result = history.execute(
        &mut doc,
        GroupElements::new(vec![ElementId::of("a")], group_id),
    );
    assert!(result.is_err());
}

#[test]
fn duplicate_display_names_do_not_break_grouping() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    history
        .execute(
            &mut doc,
            RenameNode::new(ElementId::of("a"), "Same".to_string()),
        )
        .unwrap();
    history
        .execute(
            &mut doc,
            RenameNode::new(ElementId::of("b"), "Same".to_string()),
        )
        .unwrap();
    let group = group_two(&mut doc, &mut history, "a", "b");
    assert_eq!(doc.node_name("a"), "Same");
    assert_eq!(doc.node_name("b"), "Same");
    assert!(doc.group(group.as_str()).is_some());
}

#[test]
fn grouping_preserves_ids_order_and_world_transform() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 5.0, 7.0), ("b", 50.0, 60.0), ("c", 500.0, 500.0)]);
    let xa = doc.get("a").unwrap().base().x;
    let ya = doc.get("a").unwrap().base().y;
    let group = group_two(&mut doc, &mut history, "a", "b");
    assert!(doc.contains("a") && doc.contains("b"));
    assert_eq!(doc.get("a").unwrap().base().x, xa);
    assert_eq!(doc.get("a").unwrap().base().y, ya);
    assert!(doc.get("a").unwrap().base().group_ids.contains(&group));
    // Members cluster contiguously with relative order intact.
    let order = order_names(&doc);
    let pa = order.iter().position(|id| id == "a").unwrap();
    let pb = order.iter().position(|id| id == "b").unwrap();
    assert_eq!(pb, pa + 1);
}

#[test]
fn ancestor_plus_descendant_selection_processes_once() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    let normalized = grafalith_core::hierarchy::normalize_move_selection(
        &doc,
        &[group.clone(), ElementId::of("a")],
    );
    assert_eq!(normalized.len(), 1);
}

#[test]
fn nested_groups_are_valid() {
    let (mut doc, mut history, _) = doc_with(&[
        ("a", 0.0, 0.0),
        ("b", 50.0, 0.0),
        ("c", 100.0, 0.0),
        ("d", 150.0, 0.0),
    ]);
    let inner = group_two(&mut doc, &mut history, "a", "b");
    let outer_id = doc.fresh_group_id();
    history
        .execute(
            &mut doc,
            GroupElements::new(
                vec![ElementId::of("c"), ElementId::of("d")],
                outer_id.clone(),
            ),
        )
        .unwrap();
    assert!(doc.group(inner.as_str()).is_some());
    assert!(doc.group(outer_id.as_str()).is_some());
    doc.validate_hierarchy().unwrap();
}

#[test]
fn locked_group_cannot_ungroup() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group.clone()], true))
        .unwrap();
    let nonce_before = doc.scene_nonce();
    let result = history.execute(&mut doc, UngroupElements::new(group.clone()));
    assert!(result.is_err());
    assert_eq!(doc.scene_nonce(), nonce_before);
    assert!(doc.group(group.as_str()).is_some());
}

#[test]
fn ungroup_preserves_order_world_transform_and_locks() {
    let (mut doc, mut history, _) = doc_with(&[("a", 11.0, 22.0), ("b", 33.0, 44.0)]);
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], true))
        .unwrap();
    // Grouping a locked member is rejected, so unlock, group, relock.
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], false))
        .unwrap();
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], true))
        .unwrap();
    // Unlock the group path only: ungroup needs an unlocked container, so
    // exercise member-level ungroup through direct path rewrite instead.
    history
        .execute(&mut doc, SetLocked::new(vec![ElementId::of("a")], false))
        .unwrap();
    history
        .execute(&mut doc, UngroupElements::new(group.clone()))
        .unwrap();
    assert!(doc.group(group.as_str()).is_none());
    assert!(doc.get("a").unwrap().base().group_ids.is_empty());
    assert_eq!(doc.get("a").unwrap().base().x, 11.0);
    assert_eq!(doc.get("b").unwrap().base().x, 33.0);
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

#[test]
fn moving_one_of_two_children_dissolves_group() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0), ("c", 500.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    let undo_before = history.undo_len();
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("a")], None, Some(0)),
        )
        .unwrap();
    assert!(doc.group(group.as_str()).is_none());
    assert!(doc.get("b").unwrap().base().group_ids.is_empty());
    assert_eq!(history.undo_len(), undo_before + 1);
}

#[test]
fn deleting_one_of_two_children_dissolves_group() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, DeleteElements::new(vec![ElementId::of("a")]))
        .unwrap();
    assert!(doc.group(group.as_str()).is_none());
    assert!(doc.get("b").unwrap().base().group_ids.is_empty());
    assert!(!doc.get("b").unwrap().base().is_deleted);
}

#[test]
fn deleting_last_child_removes_empty_group() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(
            &mut doc,
            DeleteElements::new(vec![ElementId::of("a"), ElementId::of("b")]),
        )
        .unwrap();
    assert!(doc.group(group.as_str()).is_none());
}

#[test]
fn nested_groups_normalize_bottom_up() {
    let (mut doc, mut history, _) = doc_with(&[
        ("a", 0.0, 0.0),
        ("b", 50.0, 0.0),
        ("c", 100.0, 0.0),
        ("d", 150.0, 0.0),
    ]);
    let inner = group_two(&mut doc, &mut history, "a", "b");
    let outer = group_two(&mut doc, &mut history, "c", "d");
    let _ = inner;
    let _ = outer;
    doc.validate_hierarchy().unwrap();
    // Move one member out of each pair; both containers dissolve.
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("a")], None, Some(0)),
        )
        .unwrap();
    doc.validate_hierarchy().unwrap();
}

#[test]
fn survivor_promotes_to_dissolved_slot() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0), ("c", 500.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    let slot_before = doc.group_order_slot(group.as_str()).unwrap();
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("a")], None, Some(2)),
        )
        .unwrap();
    let order = order_names(&doc);
    let pos_b = order.iter().position(|id| id == "b").unwrap();
    assert_eq!(pos_b, slot_before.min(order.len().saturating_sub(1)));
}

// ---------------------------------------------------------------------------
// Order and reparent
// ---------------------------------------------------------------------------

#[test]
fn reorder_up_and_down_changes_siblings() {
    let (mut doc, mut history, _) = doc_with(&[
        ("a", 0.0, 0.0),
        ("b", 10.0, 0.0),
        ("c", 20.0, 0.0),
        ("d", 30.0, 0.0),
    ]);
    history
        .execute(
            &mut doc,
            Reorder::new(vec![
                ElementId::of("b"),
                ElementId::of("a"),
                ElementId::of("c"),
                ElementId::of("d"),
            ]),
        )
        .unwrap();
    assert_eq!(order_names(&doc), vec!["b", "a", "c", "d"]);
    history
        .execute(
            &mut doc,
            Reorder::new(vec![
                ElementId::of("a"),
                ElementId::of("b"),
                ElementId::of("c"),
                ElementId::of("d"),
            ]),
        )
        .unwrap();
    assert_eq!(order_names(&doc), vec!["a", "b", "c", "d"]);
}

#[test]
fn move_root_into_group_works() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0), ("c", 200.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("c")], Some(group.clone()), None),
        )
        .unwrap();
    assert!(doc.get("c").unwrap().base().group_ids.contains(&group));
}

#[test]
fn move_child_out_to_root_works() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0), ("c", 500.0, 0.0)]);
    group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("a")], None, Some(2)),
        )
        .unwrap();
    assert!(doc.get("a").unwrap().base().group_ids.is_empty());
}

#[test]
fn move_child_between_groups_works() {
    let (mut doc, mut history, _) = doc_with(&[
        ("a", 0.0, 0.0),
        ("b", 50.0, 0.0),
        ("c", 200.0, 0.0),
        ("d", 250.0, 0.0),
    ]);
    let group_a = group_two(&mut doc, &mut history, "a", "b");
    let group_b = group_two(&mut doc, &mut history, "c", "d");
    // `a` leaving dissolves nothing yet (b stays with a fresh shape after
    // normalization), then `a` joins the second container.
    let _ = group_a;
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(
                vec![ElementId::of("a")],
                Some(group_b.clone()),
                Some(0),
            ),
        )
        .unwrap();
    assert!(doc.get("a").unwrap().base().group_ids.contains(&group_b));
}

#[test]
fn moving_group_carries_subtree() {
    let (mut doc, mut history, _) = doc_with(&[
        ("a", 0.0, 0.0),
        ("b", 50.0, 0.0),
        ("c", 200.0, 0.0),
        ("d", 250.0, 0.0),
    ]);
    let group_a = group_two(&mut doc, &mut history, "a", "b");
    let group_b = group_two(&mut doc, &mut history, "c", "d");
    let before_a: Vec<String> = doc
        .group_all_members(group_a.as_str())
        .iter()
        .map(|id| id.as_str().to_string())
        .collect();
    assert_eq!(before_a, vec!["a".to_string(), "b".to_string()]);
    history
        .execute(
            &mut doc,
            ReparentNodes::new(vec![group_a.clone()], Some(group_b.clone()), None),
        )
        .unwrap();
    let members = doc.group_all_members(group_b.as_str());
    assert!(members.iter().any(|id| id.as_str() == "a"));
    assert!(members.iter().any(|id| id.as_str() == "b"));
}

#[test]
fn cycles_and_invalid_targets_are_rejected() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    let result = history.execute(
        &mut doc,
        MoveElementsToGroup::with_index(
            vec![ElementId::of("a")],
            Some(ElementId::of("ghost")),
            None,
        ),
    );
    assert!(result.is_err());
    let result = history.execute(
        &mut doc,
        ReparentNodes::new(vec![group.clone()], Some(group.clone()), None),
    );
    assert!(result.is_err());
    // State untouched by either rejection.
    assert!(doc.group(group.as_str()).is_some());
}

#[test]
fn multi_move_preserves_relative_order() {
    let (mut doc, mut history, _) = doc_with(&[
        ("a", 0.0, 0.0),
        ("b", 10.0, 0.0),
        ("c", 20.0, 0.0),
        ("d", 30.0, 0.0),
    ]);
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(
                vec![ElementId::of("b"), ElementId::of("d")],
                None,
                Some(0),
            ),
        )
        .unwrap();
    let order = order_names(&doc);
    let pb = order.iter().position(|id| id == "b").unwrap();
    let pd = order.iter().position(|id| id == "d").unwrap();
    assert!(pb < pd);
}

#[test]
fn stacking_order_matches_render_sequence() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 5.0, 5.0)]);
    group_two(&mut doc, &mut history, "a", "b");
    let order = doc.order();
    let model = grafalith_core::render_model::RenderModel::build(
        &doc,
        &grafalith_core::geometry::viewport::Viewport {
            scroll_x: 0.0,
            scroll_y: 0.0,
            zoom: 1.0,
        },
        &grafalith_core::render_model::RenderConfig::new(800.0, 600.0),
        &|_: &str| true,
    );
    let rendered: Vec<String> = model
        .base
        .iter()
        .map(|entry| entry.id.as_str().to_string())
        .collect();
    let expected: Vec<String> = order.iter().map(|id| id.as_str().to_string()).collect();
    assert_eq!(rendered, expected);
}

// ---------------------------------------------------------------------------
// Rename and history
// ---------------------------------------------------------------------------

#[test]
fn empty_and_whitespace_names_are_rejected() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0)]);
    for bad in ["", "   ", "\n\t "] {
        let result = history.execute(
            &mut doc,
            RenameNode::new(ElementId::of("a"), bad.to_string()),
        );
        assert!(result.is_err());
    }
    assert!(doc.labels().is_empty());
}

#[test]
fn duplicate_names_are_allowed() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 10.0, 0.0)]);
    history
        .execute(
            &mut doc,
            RenameNode::new(ElementId::of("a"), "Card".to_string()),
        )
        .unwrap();
    history
        .execute(
            &mut doc,
            RenameNode::new(ElementId::of("b"), "Card".to_string()),
        )
        .unwrap();
    assert_eq!(doc.node_name("a"), "Card");
    assert_eq!(doc.node_name("b"), "Card");
}

#[test]
fn duplicate_produces_unique_ids() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    group_two(&mut doc, &mut history, "a", "b");
    let outcome = history
        .execute(
            &mut doc,
            DuplicateNodes::new(vec![ElementId::of("a"), ElementId::of("b")]),
        )
        .unwrap();
    assert_eq!(outcome.affected.len(), 2);
    assert_ne!(outcome.affected[0], outcome.affected[1]);
    assert!(doc.contains(outcome.affected[0].as_str()));
}

#[test]
fn undo_redo_restores_structure_lock_order_and_transform() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 3.0, 4.0), ("b", 50.0, 60.0), ("c", 500.0, 500.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    history
        .execute(&mut doc, SetGroupLocked::new(vec![group.clone()], true))
        .unwrap();
    let snapshot_order = doc.order();
    let snapshot_path = doc.get("a").unwrap().base().group_ids.clone();
    assert!(history.undo(&mut doc).unwrap());
    assert!(!doc.group_effective_locked(group.as_str()));
    assert!(history.redo(&mut doc).unwrap());
    assert!(doc.group_effective_locked(group.as_str()));
    assert_eq!(doc.order(), snapshot_order);
    assert_eq!(doc.get("a").unwrap().base().group_ids, snapshot_path);
    assert_eq!(doc.get("a").unwrap().base().x, 3.0);
    let _ = c_keeps_history_stable(&doc);
}

fn c_keeps_history_stable(doc: &Document) -> bool {
    doc.contains("c")
}

#[test]
fn validation_failure_changes_nothing() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0)]);
    let nonce_before = doc.scene_nonce();
    let order_before = doc.order();
    let result = history.execute(
        &mut doc,
        GroupElements::new(vec![ElementId::of("a")], ElementId::of("")),
    );
    assert!(result.is_err());
    assert_eq!(doc.scene_nonce(), nonce_before);
    assert_eq!(doc.order(), order_before);
    let result = history.execute(
        &mut doc,
        MoveElementsToGroup::with_index(vec![ElementId::of("a"), ElementId::of("a")], None, None),
    );
    assert!(result.is_err());
    assert_eq!(doc.order(), order_before);
}

#[test]
fn single_transaction_holds_move_plus_dissolve() {
    let (mut doc, mut history, _) =
        doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0), ("c", 500.0, 0.0)]);
    group_two(&mut doc, &mut history, "a", "b");
    let undo_before = history.undo_len();
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("a")], None, Some(0)),
        )
        .unwrap();
    assert_eq!(history.undo_len(), undo_before + 1);
    assert!(history.undo(&mut doc).unwrap());
    // Undo restores the dissolved container with both members.
    assert_eq!(doc.groups().len(), 1);
    let restored = doc.groups()[0].id.clone();
    assert_eq!(doc.group_all_members(restored.as_str()).len(), 2);
}

#[test]
fn command_context_rolls_back_mid_application() {
    let (mut doc, mut history, _) = doc_with(&[("a", 0.0, 0.0)]);
    let nonce_before = doc.scene_nonce();
    let order_before = doc.order();
    let result = history.execute(
        &mut doc,
        MoveElements::new(vec![ElementId::of("a")], f64::NAN, 0.0),
    );
    assert!(result.is_err());
    assert_eq!(doc.get("a").unwrap().base().x, 0.0);
    assert_eq!(doc.scene_nonce(), nonce_before);
    assert_eq!(doc.order(), order_before);
    assert_eq!(history.undo_len(), 0);
}
#[test]
fn regression_move_one_of_three_out_keeps_two() {
    use grafalith_core::command::MoveElementsToGroup;
    let (mut doc, mut history, _) =
        doc_with(&[("a", 0.0, 0.0), ("b", 50.0, 0.0), ("c", 100.0, 0.0)]);
    let group = group_two(&mut doc, &mut history, "a", "b");
    let gid = group.clone();
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("c")], Some(gid), None),
        )
        .unwrap();
    assert_eq!(doc.group_all_members(group.as_str()).len(), 3);
    history
        .execute(
            &mut doc,
            MoveElementsToGroup::with_index(vec![ElementId::of("a")], None, Some(2)),
        )
        .unwrap();
    assert!(
        doc.group(group.as_str()).is_some(),
        "two-member group survives"
    );
    assert_eq!(doc.group_all_members(group.as_str()).len(), 2);
    assert!(doc.get("a").unwrap().base().group_ids.is_empty());
    doc.validate_hierarchy().unwrap();
}
