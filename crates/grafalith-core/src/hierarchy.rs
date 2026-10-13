//! Object hierarchy: single source of truth over groups and membership.
//!
//! The document owns one element map, one explicit z-order vector, and one
//! group tree. Element `group_ids` paths plus `GroupRecord` parent links
//! describe the same tree from opposite sides, and this module keeps both
//! sides consistent after every structural command. Groups are pure
//! organizational containers without transform, clip, or paint of their
//! own, so grouping never rewrites scene-space geometry.
//!
//! Locking distinguishes the flag stored on a node from the state observed
//! through its ancestors. Unlocking a group restores each descendant to its
//! own stored flag instead of clearing the whole subtree.

use std::collections::{HashMap, HashSet};

use crate::document::{Document, ElementLabel, GroupRecord};
use crate::element::{Element, ElementId};
use crate::{EngineError, EngineResult};

/// How a node is addressed by hierarchy commands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeRef {
    /// Stored element.
    Element(ElementId),
    /// Persistent group container.
    Group(ElementId),
}

impl NodeRef {
    /// Borrows the stable id.
    pub fn id(&self) -> &ElementId {
        match self {
            Self::Element(id) | Self::Group(id) => id,
        }
    }

    /// Returns `true` for group containers.
    pub fn is_group(&self) -> bool {
        matches!(self, Self::Group(_))
    }
}

/// Planned destination for reparented nodes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParentRef {
    /// Root level.
    Root,
    /// Inside a group container.
    Group(ElementId),
}

impl ParentRef {
    /// Converts an optional group id from command payloads.
    pub fn from_optional(group: Option<ElementId>) -> Self {
        match group {
            None => Self::Root,
            Some(id) => Self::Group(id),
        }
    }
}

/// Returns `true` when the element can be directly transformed on canvas.
///
/// Direct geometry edits need an effectively unlocked node. Moving a whole
/// unlocked group still carries locally locked descendants because that
/// motion is inherited through the parent rather than applied to each
/// child directly.
pub fn can_transform_direct(doc: &Document, id: &str) -> bool {
    doc.get(id)
        .is_some_and(|element| !element.base().is_deleted && !doc.effective_locked(id))
}

/// Returns `true` when the contents of a group may be restructured.
///
/// Any membership, order, or member-deletion change inside an effectively
/// locked container is rejected. Moving the container itself as a sibling
/// is a separate decision owned by the caller.
pub fn can_restructure_children(doc: &Document, group_id: &str) -> bool {
    doc.group(group_id).is_some() && !doc.group_effective_locked(group_id)
}

/// Collects live member elements of a group subtree in global z-order.
pub fn subtree_elements(doc: &Document, group_id: &str) -> Vec<ElementId> {
    let key = ElementId::of(group_id);
    doc.order()
        .into_iter()
        .filter(|id| {
            doc.get(id.as_str()).is_some_and(|element| {
                !element.base().is_deleted && element.base().group_ids.contains(&key)
            })
        })
        .collect()
}

/// Collects every subgroup transitively below a group, nearest first.
pub fn descendant_groups(doc: &Document, group_id: &str) -> Vec<ElementId> {
    let mut out = Vec::new();
    let mut stack: Vec<ElementId> = doc.group_direct_subgroups(group_id);
    let mut seen = HashSet::new();
    while let Some(next) = stack.pop() {
        if !seen.insert(next.clone()) {
            continue;
        }
        out.push(next.clone());
        stack.extend(doc.group_direct_subgroups(next.as_str()));
    }
    out
}

/// Returns `true` when `candidate` sits inside `ancestor`.
pub fn group_is_descendant(doc: &Document, candidate: &str, ancestor: &str) -> bool {
    doc.group_ancestors(candidate)
        .iter()
        .any(|id| id.as_str() == ancestor)
}

/// Returns `true` when an element sits inside a group subtree.
pub fn element_in_group(doc: &Document, element_id: &str, group_id: &str) -> bool {
    let key = ElementId::of(group_id);
    doc.get(element_id)
        .is_some_and(|element| element.base().group_ids.contains(&key))
}

/// Normalizes a mixed element and group selection for subtree operations.
///
/// Descendants of a selected ancestor are dropped so each node is processed
/// exactly once. Unknown ids are skipped while deleted nodes are reported
/// through the returned valid set only when live, keeping stale UI
/// selections from failing whole commands.
pub fn normalize_move_selection(doc: &Document, ids: &[ElementId]) -> Vec<NodeRef> {
    let mut groups: HashSet<ElementId> = HashSet::new();
    let mut elements: HashSet<ElementId> = HashSet::new();
    for id in ids {
        if doc.group(id.as_str()).is_some() {
            groups.insert(id.clone());
        } else if let Some(element) = doc.get(id.as_str()) {
            if !element.base().is_deleted {
                elements.insert(id.clone());
            }
        }
    }
    let mut dropped_elements: HashSet<ElementId> = HashSet::new();
    for element_id in &elements {
        if let Some(element) = doc.get(element_id.as_str()) {
            for group_id in &element.base().group_ids {
                if groups.contains(group_id) {
                    dropped_elements.insert(element_id.clone());
                    break;
                }
            }
        }
    }
    for dropped in &dropped_elements {
        elements.remove(dropped);
    }
    let mut dropped_groups: HashSet<ElementId> = HashSet::new();
    for group_id in &groups {
        for ancestor in doc.group_ancestors(group_id.as_str()) {
            if groups.contains(&ancestor) {
                dropped_groups.insert(group_id.clone());
                break;
            }
        }
    }
    for dropped in &dropped_groups {
        groups.remove(dropped);
    }
    let mut out: Vec<NodeRef> = Vec::new();
    let mut group_list: Vec<ElementId> = groups.into_iter().collect();
    group_list.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    let mut element_list: Vec<ElementId> = elements.into_iter().collect();
    element_list.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    for id in group_list {
        out.push(NodeRef::Group(id));
    }
    for id in element_list {
        out.push(NodeRef::Element(id));
    }
    out
}

/// Normalizes grouping input: deduplicated live elements with ancestor
/// filtering.
///
/// Selecting an ancestor group together with one of its descendants must
/// not double-count the descendant. Group ids in the input expand to their
/// live members first so the rule applies uniformly to mixed selections.
pub fn normalize_group_input(doc: &Document, ids: &[ElementId]) -> EngineResult<Vec<ElementId>> {
    let mut expanded: Vec<ElementId> = Vec::new();
    for id in ids {
        if doc.group(id.as_str()).is_some() {
            expanded.extend(subtree_elements(doc, id.as_str()));
        } else if let Some(element) = doc.get(id.as_str()) {
            if !element.base().is_deleted {
                expanded.push(id.clone());
            }
        }
    }
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for id in expanded {
        if seen.insert(id.clone()) {
            deduped.push(id);
        }
    }
    Ok(deduped)
}

/// Validates a rename payload shared by groups, frames, and labels.
pub fn validate_node_name(name: &str) -> EngineResult<String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err(EngineError::InvalidInput(
            "name must not be empty".to_string(),
        ));
    }
    Ok(trimmed)
}

/// Reads the display name of any node.
pub fn display_name(doc: &Document, id: &str) -> String {
    doc.node_name(id)
}

/// Plans label writes for a rename without touching document state.
pub fn plan_rename_labels(
    doc: &Document,
    renames: &[(ElementId, String)],
) -> EngineResult<Vec<ElementLabel>> {
    let mut labels: HashMap<ElementId, String> = doc
        .labels()
        .into_iter()
        .map(|label| (label.id, label.name))
        .collect();
    for (id, name) in renames {
        let trimmed = validate_node_name(name)?;
        let Some(element) = doc.get(id.as_str()) else {
            return Err(EngineError::NotFound(format!("element '{}'", id.as_str())));
        };
        if element.base().is_deleted {
            return Err(EngineError::InvalidInput(format!(
                "element '{}' is deleted",
                id.as_str()
            )));
        }
        if matches!(element, Element::Frame(_)) {
            return Err(EngineError::InvalidInput(format!(
                "element '{}' is a frame; rename the frame itself",
                id.as_str()
            )));
        }
        labels.insert(id.clone(), trimmed);
    }
    let mut out: Vec<ElementLabel> = labels
        .into_iter()
        .map(|(id, name)| ElementLabel { id, name })
        .collect();
    out.sort_by(|a, b| a.id.as_str().cmp(b.id.as_str()));
    Ok(out)
}

/// Rebuilds a contiguous global order after structural edits.
///
/// Members of each group are clustered into one block at the former
/// topmost position of that group while every block keeps its internal
/// relative order. Root-level nodes keep their relative order otherwise.
/// The result preserves stacking intent without sorting by name or kind.
pub fn compact_order(doc: &Document) -> Vec<ElementId> {
    let order = doc.order();
    let mut rank: HashMap<ElementId, usize> = HashMap::new();
    for (index, id) in order.iter().enumerate() {
        rank.insert(id.clone(), index);
    }
    let mut root_groups: Vec<ElementId> = doc
        .groups()
        .into_iter()
        .filter(|group| group.parent_id.is_none())
        .map(|group| group.id)
        .collect();
    root_groups.sort_by(|a, b| {
        let ra = doc.group_order_slot(a.as_str()).unwrap_or(usize::MAX);
        let rb = doc.group_order_slot(b.as_str()).unwrap_or(usize::MAX);
        ra.cmp(&rb)
    });
    let mut placed: HashSet<ElementId> = HashSet::new();
    let mut out: Vec<ElementId> = Vec::new();
    // Walk the current order; when the first member of an unplaced root
    // group appears, emit the whole subtree block at that slot.
    let mut emitted_groups: HashSet<ElementId> = HashSet::new();
    for id in &order {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        let outermost = element.base().group_ids.last().cloned();
        match outermost {
            None => {
                if placed.insert(id.clone()) {
                    out.push(id.clone());
                }
            }
            Some(root_group) => {
                if emitted_groups.insert(root_group.clone()) {
                    for member in ordered_subtree_block(doc, &root_group, &rank) {
                        if placed.insert(member.clone()) {
                            out.push(member);
                        }
                    }
                }
            }
        }
    }
    // Groups without live members contribute no order entries.
    let _ = root_groups;
    out
}

/// Applies singleton normalization inside a command transaction.
///
/// Empty containers vanish while lone survivors promote to the dissolved
/// parent slot with ids, locks, geometry, and relative order preserved.
/// Reports `true` when anything changed so callers can fold the work into
/// their own history entry instead of opening a second one.
pub fn apply_normalization(ctx: &mut crate::command::CommandContext) -> EngineResult<bool> {
    let (removed, path_updates, groups) = plan_normalization(ctx.doc());
    if removed.is_empty() {
        let mut dirty = false;
        for (id, path) in path_updates {
            if let Some(element) = ctx.doc().get(id.as_str()) {
                if element.base().group_ids != path {
                    let mut next = element.clone();
                    next.base_mut().group_ids = path;
                    next.validate()?;
                    ctx.upsert(next)?;
                    dirty = true;
                }
            }
        }
        return Ok(dirty);
    }
    ctx.set_groups(groups)?;
    for (id, path) in path_updates {
        if let Some(element) = ctx.doc().get(id.as_str()) {
            if element.base().group_ids != path {
                let mut next = element.clone();
                next.base_mut().group_ids = path;
                next.validate()?;
                ctx.upsert(next)?;
            }
        }
    }
    let compacted = compact_order(ctx.doc());
    if compacted != ctx.doc().order() {
        ctx.set_order(compacted)?;
    }
    Ok(true)
}

/// Orders one root group's subtree as a contiguous block by rank.
fn ordered_subtree_block(
    doc: &Document,
    root_group: &ElementId,
    rank: &HashMap<ElementId, usize>,
) -> Vec<ElementId> {
    let mut members = subtree_elements(doc, root_group.as_str());
    members.sort_by_key(|id| rank.get(id).copied().unwrap_or(usize::MAX));
    members
}

/// Computes the global insertion slot for a parent-relative index.
///
/// The index counts direct children of the destination (elements plus
/// subgroups for groups, root blocks for the root) and is clamped into
/// range so out-of-range UI values append instead of failing.
pub fn global_slot_for_parent_index(
    doc: &Document,
    order: &[ElementId],
    parent: &ParentRef,
    index: usize,
) -> usize {
    match parent {
        ParentRef::Root => {
            let blocks = root_child_blocks(doc, order);
            if index >= blocks.len() {
                return order.len();
            }
            blocks[index].0
        }
        ParentRef::Group(group_id) => {
            let children = direct_child_slots(doc, order, group_id.as_str());
            if children.is_empty() {
                return doc
                    .group_order_slot(group_id.as_str())
                    .map(|slot| slot + subtree_elements(doc, group_id.as_str()).len())
                    .unwrap_or(order.len());
            }
            if index >= children.len() {
                let (start, len) = children[children.len() - 1];
                return start + len;
            }
            children[index].0
        }
    }
}

/// Start offsets of root-level blocks in global order.
fn root_child_blocks(doc: &Document, order: &[ElementId]) -> Vec<(usize, usize)> {
    let mut blocks = Vec::new();
    let mut index = 0usize;
    while index < order.len() {
        let id = &order[index];
        let outermost = doc
            .get(id.as_str())
            .and_then(|element| element.base().group_ids.last().cloned());
        match outermost {
            None => {
                blocks.push((index, 1));
                index += 1;
            }
            Some(root_group) => {
                let members: HashSet<ElementId> = subtree_elements(doc, root_group.as_str())
                    .into_iter()
                    .collect();
                let mut len = 0usize;
                while index + len < order.len() && members.contains(&order[index + len]) {
                    len += 1;
                }
                if len == 0 {
                    len = 1;
                }
                blocks.push((index, len));
                index += len;
            }
        }
    }
    blocks
}

/// Start offsets of one group's direct children in global order.
fn direct_child_slots(doc: &Document, order: &[ElementId], group_id: &str) -> Vec<(usize, usize)> {
    let direct_elements = doc.group_direct_elements(group_id);
    let element_set: HashSet<ElementId> = direct_elements.into_iter().collect();
    let subgroups = doc.group_direct_subgroups(group_id);
    let mut subgroup_spans: Vec<(usize, usize)> = Vec::new();
    for subgroup in &subgroups {
        let members: HashSet<ElementId> = subtree_elements(doc, subgroup.as_str())
            .into_iter()
            .collect();
        let positions: Vec<usize> = order
            .iter()
            .enumerate()
            .filter(|(_, id)| members.contains(*id))
            .map(|(pos, _)| pos)
            .collect();
        if let (Some(first), Some(last)) = (positions.first(), positions.last()) {
            subgroup_spans.push((*first, last - first + 1));
        }
    }
    let mut element_slots: Vec<(usize, usize)> = order
        .iter()
        .enumerate()
        .filter(|(_, id)| element_set.contains(*id))
        .map(|(pos, _)| (pos, 1))
        .collect();
    element_slots.extend(subgroup_spans);
    element_slots.sort_by_key(|(start, _)| *start);
    element_slots
}

/// Outcome of singleton normalization: removed containers, element path
/// rewrites, and the surviving group tree.
pub type NormalizationPlan = (
    Vec<ElementId>,
    Vec<(ElementId, Vec<ElementId>)>,
    Vec<GroupRecord>,
);

/// Removes empty groups and promotes lone children, bottom-up.
///
/// A container with zero direct children disappears. A container with one
/// direct child dissolves and the survivor takes the container's parent
/// slot, preserving ids, local locks, and relative order. Ancestors are
/// rechecked until the chain holds two or more children.
pub fn plan_normalization(doc: &Document) -> NormalizationPlan {
    let mut groups = doc.groups();
    let mut element_paths: HashMap<ElementId, Vec<ElementId>> = HashMap::new();
    for element in doc.get_all() {
        element_paths.insert(element.id().clone(), element.base().group_ids.clone());
    }
    let mut removed: Vec<ElementId> = Vec::new();
    loop {
        let mut progressed = false;
        // Deepest groups first so children dissolve before parents.
        let mut ordered = groups.clone();
        ordered.sort_by_key(|group| -(doc.group_ancestors(group.id.as_str()).len() as i64));
        for group in ordered {
            let direct_elements: Vec<ElementId> = element_paths
                .iter()
                .filter(|(_, path)| path.first() == Some(&group.id))
                .map(|(id, _)| id.clone())
                .collect();
            let direct_subgroups: Vec<ElementId> = groups
                .iter()
                .filter(|candidate| candidate.parent_id.as_ref() == Some(&group.id))
                .map(|candidate| candidate.id.clone())
                .collect();
            let total = direct_elements.len() + direct_subgroups.len();
            if total >= 2 {
                continue;
            }
            if total == 0 {
                groups.retain(|candidate| candidate.id != group.id);
                removed.push(group.id.clone());
                progressed = true;
                break;
            }
            // Singleton: promote the survivor into the dissolved slot.
            let parent = group.parent_id.clone();
            if direct_elements.len() == 1 {
                let survivor = direct_elements[0].clone();
                if let Some(path) = element_paths.get_mut(&survivor) {
                    let mut next = Vec::new();
                    if let Some(parent_id) = &parent {
                        next.push(parent_id.clone());
                        next.extend(doc.group_ancestors(parent_id.as_str()));
                    }
                    // Preserve outer ancestors above the dissolved group
                    // when the path carried more than the direct link.
                    // The dissolved group sat at the head, so dropping it
                    // and grafting the new parent chain is exact.
                    let _ = path;
                    *path = next;
                }
            } else {
                let survivor = direct_subgroups[0].clone();
                if let Some(record) = groups.iter_mut().find(|c| c.id == survivor) {
                    record.parent_id = parent.clone();
                }
                // Descendant element paths below the survivor keep their
                // head; only the dissolved link above the survivor changes.
                for path in element_paths.values_mut() {
                    if let Some(pos) = path.iter().position(|id| id == &group.id) {
                        path.remove(pos);
                    }
                }
                // Repair survivor-headed paths whose outer chain skipped the
                // dissolved group: rebuild from the survivor upward.
                for (element_id, path) in element_paths.clone() {
                    if path.first() == Some(&survivor) {
                        let mut rebuilt = vec![survivor.clone()];
                        let mut current = groups
                            .iter()
                            .find(|c| c.id == survivor)
                            .and_then(|c| c.parent_id.clone());
                        while let Some(parent_id) = current {
                            rebuilt.push(parent_id.clone());
                            current = groups
                                .iter()
                                .find(|c| c.id == parent_id)
                                .and_then(|c| c.parent_id.clone());
                        }
                        element_paths.insert(element_id, rebuilt);
                    }
                }
            }
            // Drop the dissolved group from every remaining path.
            for path in element_paths.values_mut() {
                path.retain(|id| id != &group.id);
            }
            groups.retain(|candidate| candidate.id != group.id);
            removed.push(group.id.clone());
            progressed = true;
            break;
        }
        if !progressed {
            break;
        }
    }
    let path_updates: Vec<(ElementId, Vec<ElementId>)> = element_paths.into_iter().collect();
    (removed, path_updates, groups)
}

/// Rewrites descendant element paths after a group parent change.
pub fn rewrite_paths_for_group_move(
    doc: &Document,
    moving_group: &ElementId,
    new_parent: Option<&ElementId>,
) -> HashMap<ElementId, Vec<ElementId>> {
    let mut new_ancestors = Vec::new();
    if let Some(parent) = new_parent {
        new_ancestors.push(parent.clone());
        new_ancestors.extend(doc.group_ancestors(parent.as_str()));
    }
    let mut out = HashMap::new();
    let affected: HashSet<ElementId> = subtree_elements(doc, moving_group.as_str())
        .into_iter()
        .collect();
    for element_id in affected {
        if let Some(element) = doc.get(element_id.as_str()) {
            let path = &element.base().group_ids;
            if let Some(pos) = path.iter().position(|id| id == moving_group) {
                let mut head: Vec<ElementId> = path[..=pos].to_vec();
                head.extend(new_ancestors.clone());
                out.insert(element_id, head);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator};

    fn doc_with(ids: &[&str]) -> (Document, CounterIdGenerator) {
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
    fn move_selection_drops_covered_descendants() {
        let (mut doc, _) = doc_with(&["a", "b"]);
        let group = doc.fresh_group_id();
        doc.set_groups(vec![GroupRecord {
            id: group.clone(),
            name: "G".to_string(),
            parent_id: None,
            locked: false,
        }])
        .unwrap();
        for id in ["a", "b"] {
            let mut next = doc.get(id).unwrap().clone();
            next.base_mut().group_ids = vec![group.clone()];
            doc.upsert(next).unwrap();
        }
        let normalized = normalize_move_selection(
            &doc,
            &[group.clone(), ElementId::of("a"), ElementId::of("b")],
        );
        assert_eq!(normalized, vec![NodeRef::Group(group)]);
    }
}
