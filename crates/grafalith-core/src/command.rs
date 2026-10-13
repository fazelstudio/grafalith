//! Command abstraction over explicit mutation contexts.
//!
//! TS sources: `packages/core/src/history/history-manager.ts` (entry shape,
//! batch collapse, order snapshots, redo-clear, limit 100, `destroy`,
//! `recordEntry`), `packages/core/src/scene/scene.ts` (`MutationDelta`
//! shape), `packages/core/src/editor/editor.ts` (`moveElements` guards,
//! `setStyle` batching, `resizeElement`/`rotateElement` guards), and
//! `packages/core/src/scene/style-actions.ts` (bulk setters, opacity clamp).
//!
//! Design: commands are intentional domain mutations executed against an
//! explicit [`CommandContext`]. The context accumulates before/after deltas while the
//! command runs, so a multi-step command collapses into one history entry
//! and a failing command rolls back to `before == after`. Inversion lives in
//! the recorded [`HistoryEntry`] (exact snapshots, version-preserving), not
//! in command re-execution — re-running `upsert` would bump versions and
//! break the version discipline below.
//!
//! Version/nonce discipline (single owner is [`Document`]): forward
//! mutations go through [`CommandContext::upsert`] /
//! [`CommandContext::soft_delete`] / [`CommandContext::set_order`], which
//! delegate to [`Document`] — the authoritative version bumper; inverse
//! application (undo, redo, rollback) uses exact snapshot writes that
//! preserve `version`/`version_nonce` verbatim (TS `applyEntry` fix-up
//! parity), so undo/redo cycles never drift versions.

use std::collections::HashMap;

use crate::document::{Document, ElementLabel, GroupRecord};
use crate::element::{
    Element, ElementId, FillStyle, StrokeAlign, StrokeCap, StrokeJoin, StrokeStyle, TextElement,
};
use crate::geometry::point::Point;
use crate::geometry::rect::Bounds;
use crate::geometry::rotation::rotate_delta;
use crate::geometry::transform::{
    resize_no_rotation, resize_with_rotation, scale_font_size, scale_points, HandleType,
};
use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/// What a command reports after a successful run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CommandOutcome {
    /// Ids the command created, updated, or deleted, in command order.
    pub affected: Vec<ElementId>,
    /// `true` when the command stored anything (`false` = no-op success,
    /// which records no history entry).
    pub changed: bool,
}

// ---------------------------------------------------------------------------
// History entries (recorded inversion)
// ---------------------------------------------------------------------------

/// Which side of a [`HistoryEntry`] to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistorySide {
    /// Pre-command state (used by undo and rollback).
    Before,
    /// Post-command state (used by redo).
    After,
}

/// Before/after snapshots for one element within a [`HistoryEntry`].
///
/// `None` means the element did not exist on that side: `before == None`
/// marks a creation, `after == None` a hard removal.
#[derive(Debug, Clone, PartialEq)]
pub struct SlotDelta {
    /// Element state before the command, or `None` when created by it.
    pub before: Option<Element>,
    /// Element state after the command, or `None` when removed by it.
    pub after: Option<Element>,
}

/// One user-visible history step: element deltas plus an optional z-order
/// snapshot pair (TS `HistoryEntry` parity: `orderBefore`/`orderAfter` are
/// `None` when the command did not touch z-order).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HistoryEntry {
    /// Per-element before/after snapshots keyed by stable id.
    pub element_updates: HashMap<ElementId, SlotDelta>,
    /// Z-order before the command (`None` = unchanged).
    pub order_before: Option<Vec<ElementId>>,
    /// Z-order after the command (`None` = unchanged).
    pub order_after: Option<Vec<ElementId>>,
    /// Group metadata before the command, when groups changed.
    pub groups_before: Option<Vec<GroupRecord>>,
    /// Group metadata after the command, when groups changed.
    pub groups_after: Option<Vec<GroupRecord>>,
    /// Explicit element labels before the command, when labels changed.
    pub labels_before: Option<Vec<ElementLabel>>,
    /// Explicit element labels after the command, when labels changed.
    pub labels_after: Option<Vec<ElementLabel>>,
}

impl HistoryEntry {
    /// Returns `true` when the entry records nothing (no element deltas and
    /// no order change). Empty entries are never pushed by command
    /// execution or transaction commit.
    pub fn is_empty(&self) -> bool {
        self.element_updates.is_empty()
            && self.order_before.is_none()
            && self.order_after.is_none()
            && self.groups_before.is_none()
            && self.groups_after.is_none()
            && self.labels_before.is_none()
            && self.labels_after.is_none()
    }

    /// Snapshots recorded on the requested side.
    fn side_snapshots(&self, side: HistorySide) -> Vec<&Element> {
        let mut snapshots = Vec::new();
        for delta in self.element_updates.values() {
            let snapshot = match side {
                HistorySide::Before => &delta.before,
                HistorySide::After => &delta.after,
            };
            if let Some(element) = snapshot {
                snapshots.push(element);
            }
        }
        snapshots
    }

    /// Order snapshot for the requested side.
    fn side_order(&self, side: HistorySide) -> Option<&Vec<ElementId>> {
        match side {
            HistorySide::Before => self.order_before.as_ref(),
            HistorySide::After => self.order_after.as_ref(),
        }
    }

    fn side_groups(&self, side: HistorySide) -> Option<&Vec<GroupRecord>> {
        match side {
            HistorySide::Before => self.groups_before.as_ref(),
            HistorySide::After => self.groups_after.as_ref(),
        }
    }

    fn side_labels(&self, side: HistorySide) -> Option<&Vec<ElementLabel>> {
        match side {
            HistorySide::Before => self.labels_before.as_ref(),
            HistorySide::After => self.labels_after.as_ref(),
        }
    }

    /// Applies one side of the entry to the document with exact-restore
    /// semantics (TS `applyEntry` parity): a `None` side removes the element
    /// entirely (undo of a creation); a `Some` side writes the snapshot back
    /// verbatim — version and nonce preserved, never bumped; the order
    /// snapshot (when present) is restored exactly, so undo of
    /// create/delete/reorder never appends at the end.
    ///
    /// Validated before anything is written for atomicity: every snapshot on
    /// the applied side is validated, and the resulting id set is checked
    /// against the order snapshot. Validation failure leaves the document
    /// untouched.
    pub(crate) fn apply(&self, doc: &mut Document, side: HistorySide) -> EngineResult<()> {
        for snapshot in self.side_snapshots(side) {
            snapshot.validate()?;
        }
        if let Some(order) = self.side_order(side) {
            // Simulate the post-apply id set: creations add, hard removals
            // drop, everything else stays.
            let mut ids: std::collections::HashSet<&str> = doc
                .get_all_including_deleted()
                .iter()
                .map(|element| element.id().as_str())
                .collect();
            for (id, delta) in &self.element_updates {
                let snapshot = match side {
                    HistorySide::Before => &delta.before,
                    HistorySide::After => &delta.after,
                };
                if snapshot.is_some() {
                    ids.insert(id.as_str());
                } else {
                    ids.remove(id.as_str());
                }
            }
            for id in order {
                if !ids.contains(id.as_str()) {
                    return Err(EngineError::InvariantViolation(format!(
                        "history apply references unknown element '{}'",
                        id.as_str()
                    )));
                }
            }
        }

        for (id, delta) in &self.element_updates {
            let snapshot = match side {
                HistorySide::Before => &delta.before,
                HistorySide::After => &delta.after,
            };
            match snapshot {
                None => doc.hard_delete(id.as_str())?,
                Some(element) => doc.restore_exact(element.clone())?,
            }
        }
        if let Some(order) = self.side_order(side) {
            doc.set_order(order.clone())?;
        }
        if let Some(groups) = self.side_groups(side) {
            doc.set_groups(groups.clone())?;
        }
        if let Some(labels) = self.side_labels(side) {
            doc.set_labels(labels.clone())?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Command context (mutation accumulator)
// ---------------------------------------------------------------------------

/// Mutation accumulator handed to commands.
///
/// Every persistent mutation inside a command goes through this context so
/// that each touched id keeps its *earliest* `before` and its *latest*
/// `after` (batch collapse: one drag = one entry, create + updates = one
/// entry — TS `HistoryManager` parity). No-op stores (ghost or
/// already-deleted soft-deletes) record nothing.
pub struct CommandContext<'a> {
    doc: &'a mut Document,
    updates: HashMap<ElementId, SlotDelta>,
    order_before: Vec<ElementId>,
    groups_before: Vec<GroupRecord>,
    labels_before: Vec<ElementLabel>,
}

impl<'a> CommandContext<'a> {
    /// Creates a fresh context capturing the document's current z-order.
    pub(crate) fn fresh(doc: &'a mut Document) -> Self {
        let order_before = doc.order();
        let groups_before = doc.groups();
        let labels_before = doc.labels();
        Self {
            doc,
            updates: HashMap::new(),
            order_before,
            groups_before,
            labels_before,
        }
    }

    /// Borrows the document for read-only validation (commands inspect
    /// state here before storing anything).
    pub fn doc(&self) -> &Document {
        self.doc
    }

    /// Mints a fresh element id from the document's id source (collision
    /// handling stays the caller's job — see the clipboard codec for the
    /// loop pattern). Extension commands need this because they only ever see
    /// the context, never the document.
    pub fn fresh_element_id(&mut self) -> ElementId {
        self.doc.fresh_element_id()
    }

    /// Mints a fresh version nonce from the document's id source.
    pub fn fresh_nonce(&mut self) -> u32 {
        self.doc.fresh_nonce()
    }

    /// Mints a fresh render seed from the document's id source.
    pub fn fresh_seed(&mut self) -> u32 {
        self.doc.fresh_seed()
    }

    /// Inserts or updates an element (delegates versioning to [`Document`]).
    pub fn upsert(&mut self, element: Element) -> EngineResult<()> {
        let id = element.id().clone();
        let before = self.earliest_before(&id);
        self.doc.upsert(element)?;
        let after = self.doc.get(id.as_str()).cloned();
        self.merge(id, before, after);
        Ok(())
    }

    /// Soft-deletes an element. Ghost ids and already-deleted elements are
    /// silent no-ops that record nothing (TS `Scene.deleteElement` parity).
    pub fn soft_delete(&mut self, id: &str) -> EngineResult<()> {
        let key = ElementId::of(id);
        let had_entry = self.updates.contains_key(&key);
        let before = self.earliest_before(&key);
        self.doc.soft_delete(id)?;
        let after = self.doc.get(id).cloned();
        if !had_entry && before == after {
            return Ok(());
        }
        self.merge(key, before, after);
        Ok(())
    }

    /// Hard-deletes an element (removes map entry and order slot).
    /// Unknown ids are silent no-ops that record nothing.
    pub fn hard_delete(&mut self, id: &str) -> EngineResult<()> {
        let key = ElementId::of(id);
        let had_entry = self.updates.contains_key(&key);
        let before = self.earliest_before(&key);
        self.doc.hard_delete(id)?;
        let after = self.doc.get(id).cloned();
        if !had_entry && before == after {
            return Ok(());
        }
        self.merge(key, before, after);
        Ok(())
    }

    /// Replaces the z-order vector (delegates validation to [`Document`];
    /// unknown ids reject the whole command before touching state).
    pub fn set_order(&mut self, order: Vec<ElementId>) -> EngineResult<()> {
        self.doc.set_order(order)?;
        Ok(())
    }

    /// Replaces persistent group metadata inside the current command.
    pub fn set_groups(&mut self, groups: Vec<GroupRecord>) -> EngineResult<()> {
        self.doc.set_groups(groups)
    }

    /// Replaces explicit element labels inside the current command.
    pub fn set_labels(&mut self, labels: Vec<ElementLabel>) -> EngineResult<()> {
        self.doc.set_labels(labels)
    }

    /// Mints a fresh group id from the document's id source.
    pub fn fresh_group_id(&mut self) -> ElementId {
        self.doc.fresh_group_id()
    }

    /// Earliest `before` for an id: the accumulator's when the command
    /// already touched it, else the currently stored snapshot (or `None`
    /// for a fresh id).
    fn earliest_before(&self, id: &ElementId) -> Option<Element> {
        if let Some(delta) = self.updates.get(id) {
            return delta.before.clone();
        }
        self.doc.get(id.as_str()).cloned()
    }

    /// Records a merged delta: keeps the earliest `before`, takes the
    /// latest `after`.
    fn merge(&mut self, id: ElementId, before: Option<Element>, after: Option<Element>) {
        self.updates.insert(id, SlotDelta { before, after });
    }

    /// Builds the history entry for this context, capturing the final
    /// z-order. The order pair is stored only when the order changed.
    pub(crate) fn into_entry(self) -> HistoryEntry {
        let order_after = self.doc.order();
        let order_changed = order_after != self.order_before;
        let groups_after = self.doc.groups();
        let groups_changed = groups_after != self.groups_before;
        let labels_after = self.doc.labels();
        let labels_changed = labels_after != self.labels_before;
        HistoryEntry {
            element_updates: self.updates,
            order_before: order_changed.then_some(self.order_before),
            order_after: order_changed.then_some(order_after),
            groups_before: groups_changed.then_some(self.groups_before),
            groups_after: groups_changed.then_some(groups_after),
            labels_before: labels_changed.then_some(self.labels_before),
            labels_after: labels_changed.then_some(labels_after),
        }
    }

    /// Rolls the document back to the context's `before` states plus its
    /// captured order (failed-command safety: `before == after` content).
    /// A context that stored nothing is a true no-op (nonce untouched).
    /// Scene-nonce movement from a failed attempt is otherwise not rewound —
    /// the nonce means "something changed", and content equality is what the
    /// atomicity contract covers.
    pub(crate) fn rollback(self) -> EngineResult<()> {
        let Self {
            doc,
            updates,
            order_before,
            groups_before,
            labels_before,
        } = self;
        for (id, delta) in updates {
            match delta.before {
                // Created by the failed command: remove entirely.
                None => doc.hard_delete(id.as_str())?,
                // Existed before: write the snapshot back verbatim.
                Some(element) => doc.restore_exact(element)?,
            }
        }
        if doc.order() != order_before {
            doc.set_order(order_before)?;
        }
        if doc.groups() != groups_before {
            doc.set_groups(groups_before)?;
        }
        if doc.labels() != labels_before {
            doc.set_labels(labels_before)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Command trait
// ---------------------------------------------------------------------------

/// An intentional domain mutation.
///
/// Implementations validate first (inspect via `CommandContext::doc`,
/// then store), so a failing command never leaves partial state —
/// `CommandContext::rollback` restores the remainder for commands whose
/// failure surfaces mid-application. Inversion is *not* part of this
/// trait: undo/redo apply the recorded [`HistoryEntry`] snapshots exactly.
pub trait Command {
    /// Short human-readable name for debugging and tests.
    fn label(&self) -> &str;
    /// Runs the mutation against the context, returning what changed.
    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome>;
}

// ---------------------------------------------------------------------------
// Concrete commands
// ---------------------------------------------------------------------------

/// Creates new elements.
///
/// Every element is validated and checked for id collisions *before* the
/// first store (atomicity): an invalid element or an id that already exists
/// rejects the whole command with the document untouched. Callers mint fresh
/// ids via [`Document::fresh_element_id`].
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CreateElements {
    /// Elements to insert. Must be non-empty and collision-free.
    pub elements: Vec<Element>,
}

impl CreateElements {
    /// Builds a creation command for the given elements.
    pub fn new(elements: Vec<Element>) -> Self {
        Self { elements }
    }
}

impl Command for CreateElements {
    fn label(&self) -> &str {
        "create"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        for element in &self.elements {
            element.validate()?;
            if ctx.doc().contains(element.id().as_str()) {
                return Err(EngineError::InvariantViolation(format!(
                    "create collides with existing element '{}'",
                    element.id().as_str()
                )));
            }
        }
        let mut seen = std::collections::HashSet::new();
        for element in &self.elements {
            if !seen.insert(element.id().as_str()) {
                return Err(EngineError::InvariantViolation(format!(
                    "create batch contains duplicate id '{}'",
                    element.id().as_str()
                )));
            }
        }
        let mut affected = Vec::with_capacity(self.elements.len());
        for element in self.elements.clone() {
            let id = element.id().clone();
            ctx.upsert(element)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Soft-deletes elements (`isDeleted = true`, tombstones kept).
///
/// Unknown and already-deleted ids are skipped (TS ghost no-op parity), so
/// deleting an empty list is a no-op success. Lock/hidden guards live one
/// layer up: the editor filters locked elements before building this command
/// (TS `SelectionManager.deleteSelected` parity); the command itself is the
/// mechanism, matching the unconditional TS `Scene.deleteElement`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeleteElements {
    /// Ids to soft-delete.
    pub ids: Vec<ElementId>,
}

impl DeleteElements {
    /// Builds a deletion command for the given ids.
    pub fn new(ids: Vec<ElementId>) -> Self {
        Self { ids }
    }
}

impl Command for DeleteElements {
    fn label(&self) -> &str {
        "delete"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        // Effective-lock policy: descendants of a locked container cannot be
        // deleted without an explicit unlock, while a locally locked leaf
        // still needs the same explicit unlock. Skipped ids never fail the
        // batch so stale selections degrade gracefully.
        let mut affected = Vec::new();
        let mut pending: Vec<ElementId> = Vec::new();
        for id in self.ids.clone() {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if element.base().is_deleted {
                continue;
            }
            if ctx.doc().effective_locked(id.as_str()) {
                continue;
            }
            pending.push(id);
        }
        // Source-group normalization runs after the deletes so singleton
        // containers dissolve inside the same history entry.
        for id in pending {
            ctx.soft_delete(id.as_str())?;
            affected.push(id);
        }
        if !affected.is_empty() {
            crate::hierarchy::apply_normalization(ctx)?;
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Moves elements by a scene-space delta (one entry for any count —
/// multi-selection drag parity).
///
/// Guards (TS `Editor.moveElements` parity): the delta must be finite
/// (rejected pre-touch), and unknown, deleted, or locked elements are
/// skipped. Only `x`/`y` translate; bound arrows follow through separate
/// binding logic.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MoveElements {
    /// Ids to translate.
    pub ids: Vec<ElementId>,
    /// Scene-space delta x.
    pub dx: f64,
    /// Scene-space delta y.
    pub dy: f64,
}

impl MoveElements {
    /// Builds a move command for the given ids and delta.
    pub fn new(ids: Vec<ElementId>, dx: f64, dy: f64) -> Self {
        Self { ids, dx, dy }
    }
}

impl Command for MoveElements {
    fn label(&self) -> &str {
        "move"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if !self.dx.is_finite() || !self.dy.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "move delta must be finite, got ({}, {})",
                self.dx, self.dy
            )));
        }
        // Direct canvas motion needs an effectively unlocked node. A locally
        // locked child still travels when its whole direct parent moves as
        // one unit, since that motion is inherited through the unlocked
        // container rather than applied to the child directly.
        let moving: std::collections::HashSet<ElementId> = self.ids.iter().cloned().collect();
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            let base = element.base();
            if base.is_deleted {
                continue;
            }
            if ctx.doc().effective_locked(id.as_str()) {
                let carries = element.base().group_ids.first().is_some_and(|parent| {
                    !ctx.doc().group_effective_locked(parent.as_str()) && {
                        let siblings = ctx.doc().group_direct_elements(parent.as_str());
                        !siblings.is_empty()
                            && siblings.iter().all(|sibling| moving.contains(sibling))
                    }
                });
                if !(base.locked && carries) {
                    continue;
                }
            }
            let mut next = element.clone();
            next.base_mut().x += self.dx;
            next.base_mut().y += self.dy;
            next.validate()?;
            pending.push((id.clone(), next));
        }
        // Store the validated states.
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Style patch: every `Some` field is applied, `None` fields are untouched.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StylePatch {
    /// New stroke color.
    pub stroke_color: Option<String>,
    /// New background fill.
    pub background: Option<FillStyle>,
    /// New text box outline color. Applies to text elements only; other
    /// kinds ignore it. An empty or `"transparent"` value clears the
    /// outline instead of storing a no-op color.
    pub border_color: Option<String>,
    /// New stroke width.
    pub stroke_width: Option<f64>,
    /// New stroke dash pattern.
    pub stroke_style: Option<StrokeStyle>,
    /// New stroke cap.
    pub stroke_cap: Option<StrokeCap>,
    /// New stroke join.
    pub stroke_join: Option<StrokeJoin>,
    /// New stroke alignment.
    pub stroke_align: Option<StrokeAlign>,
    /// New opacity (clamped to 0–100 in the operation, TS
    /// `style-actions.ts` parity).
    pub opacity: Option<f64>,
}

impl StylePatch {
    /// Returns `true` when the patch carries no changes.
    pub fn is_empty(&self) -> bool {
        self.stroke_color.is_none()
            && self.background.is_none()
            && self.border_color.is_none()
            && self.stroke_width.is_none()
            && self.stroke_style.is_none()
            && self.stroke_cap.is_none()
            && self.stroke_join.is_none()
            && self.stroke_align.is_none()
            && self.opacity.is_none()
    }
}

/// Applies a style patch to many elements as one history entry (TS
/// `Editor.setStyle` batching parity: one drag of a color picker = one
/// undo step).
///
/// Unknown ids are skipped; deleted elements *are* styled when explicitly
/// addressed (TS `style-actions.ts` parity). Lock is not consulted — style
/// applies to locked elements in TS as well.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SetStyle {
    /// Ids to style.
    pub ids: Vec<ElementId>,
    /// Patch to apply.
    pub patch: StylePatch,
}

impl SetStyle {
    /// Builds a style command for the given ids and patch.
    pub fn new(ids: Vec<ElementId>, patch: StylePatch) -> Self {
        Self { ids, patch }
    }
}

impl Command for SetStyle {
    fn label(&self) -> &str {
        "style"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if self.patch.is_empty() {
            return Ok(CommandOutcome::default());
        }
        // Build and validate every next state before storing any.
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            let mut next = element.clone();
            if let Element::Text(text) = &mut next {
                if let Some(color) = &self.patch.border_color {
                    let trimmed = color.trim();
                    text.border_color =
                        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("transparent") {
                            None
                        } else {
                            Some(color.clone())
                        };
                }
            }
            let base = next.base_mut();
            if let Some(color) = &self.patch.stroke_color {
                base.stroke_color = color.clone();
            }
            if let Some(fill) = &self.patch.background {
                base.background_color = fill.clone();
            }
            if let Some(width) = self.patch.stroke_width {
                base.stroke_width = width;
            }
            if let Some(style) = self.patch.stroke_style {
                base.stroke_style = style;
            }
            if let Some(cap) = self.patch.stroke_cap {
                base.stroke_cap = cap;
            }
            if let Some(join) = self.patch.stroke_join {
                base.stroke_join = join;
            }
            if let Some(align) = self.patch.stroke_align {
                base.stroke_align = align;
            }
            if let Some(opacity) = self.patch.opacity {
                base.opacity = opacity.clamp(0.0, 100.0);
            }
            next.validate()?;
            pending.push((id.clone(), next));
        }
        // Store the validated states.
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Sets the lock flag on elements as one undoable step (TS
/// `lock-actions.ts` parity: unknown and deleted ids are skipped; already
/// correct flags are left alone so a fully-redundant call records nothing).
///
/// Locked is a mutation guard, not a UI hint: [`MoveElements`] and the
/// editor's delete-selected path skip locked elements.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SetLocked {
    /// Ids to update.
    pub ids: Vec<ElementId>,
    /// Flag value to write.
    pub locked: bool,
}

impl SetLocked {
    /// Builds a lock-flag command for the given ids and value.
    pub fn new(ids: Vec<ElementId>, locked: bool) -> Self {
        Self { ids, locked }
    }
}

impl Command for SetLocked {
    fn label(&self) -> &str {
        if self.locked {
            "lock"
        } else {
            "unlock"
        }
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        // Build and validate every next state before storing any.
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if element.base().is_deleted || element.base().locked == self.locked {
                continue;
            }
            let mut next = element.clone();
            next.base_mut().locked = self.locked;
            next.validate()?;
            pending.push((id.clone(), next));
        }
        // Store the validated states.
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Replaces the z-order vector as one undoable step (TS `setElementOrder`
/// → order-delta history parity). Unknown ids reject the command before
/// touching state ([`Document::set_order`] validation).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Reorder {
    /// New z-order, back-to-front.
    pub order: Vec<ElementId>,
}

impl Reorder {
    /// Builds a reorder command for the given order.
    pub fn new(order: Vec<ElementId>) -> Self {
        Self { order }
    }
}

impl Command for Reorder {
    fn label(&self) -> &str {
        "reorder"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if ctx.doc().order() == self.order {
            return Ok(CommandOutcome::default());
        }
        ctx.set_order(self.order.clone())?;
        Ok(CommandOutcome {
            affected: self.order.clone(),
            changed: true,
        })
    }
}

// ---------------------------------------------------------------------------
// Resize / rotate commands.
// ---------------------------------------------------------------------------

/// Directly replaces an element's bounds (TS `Editor.resizeElement` parity:
/// unknown, deleted, and locked elements are skipped; dimensions below the
/// `>= 1` minimum are refused).
///
/// Non-finite inputs are a typed error (hardening consistent with
/// [`MoveElements`]: TS silently returns, which would hide corrupt state
/// behind a void return).
#[derive(Debug, Clone, PartialEq)]
pub struct SetBounds {
    /// Element to resize.
    pub id: ElementId,
    /// New top-left x in scene coordinates.
    pub x: f64,
    /// New top-left y in scene coordinates.
    pub y: f64,
    /// New width in scene units (`>= 1`).
    pub width: f64,
    /// New height in scene units (`>= 1`).
    pub height: f64,
}

impl SetBounds {
    /// Builds a direct-set resize for the given bounds.
    pub fn new(id: ElementId, x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            id,
            x,
            y,
            width,
            height,
        }
    }
}

impl Command for SetBounds {
    fn label(&self) -> &str {
        "resize"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if !self.x.is_finite() || !self.y.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "resize origin must be finite, got ({}, {})",
                self.x, self.y
            )));
        }
        if !self.width.is_finite() || !self.height.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "resize size must be finite, got ({}, {})",
                self.width, self.height
            )));
        }
        if self.width < 1.0 || self.height < 1.0 {
            return Ok(CommandOutcome::default());
        }
        let Some(element) = ctx.doc().get(self.id.as_str()) else {
            return Ok(CommandOutcome::default());
        };
        if element.base().is_deleted || ctx.doc().effective_locked(self.id.as_str()) {
            return Ok(CommandOutcome::default());
        }
        let mut next = element.clone();
        let base_mut = next.base_mut();
        base_mut.x = self.x;
        base_mut.y = self.y;
        base_mut.width = self.width;
        base_mut.height = self.height;
        next.validate()?;
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.id.clone()],
            changed: true,
        })
    }
}

/// Handle-drag resize through the rotation-aware geometry math.
///
/// Ports the `TransformHandler` resize commit: single-selection only at the
/// editor layer (TS checks resize handles only for one selected element);
/// the pointer arrives in scene coordinates, Shift (`lock_aspect`) holds the
/// original ratio for all shapes (Figma/TLDraw convention), the minimum
/// `>= 1` clamp applies, rotation is preserved, and line/arrow/freedraw
/// points, path segments, and text size scale with the box (TS
/// `applyProportionalContentScaling` parity).
#[derive(Debug, Clone, PartialEq)]
pub struct ResizeElements {
    /// Element to resize (single-selection; the editor layer enforces this).
    pub id: ElementId,
    /// Dragged handle (opposite corner/edge stays anchored).
    pub handle: HandleType,
    /// Pointer position in scene coordinates.
    pub point: Point,
    /// Aspect-lock flag (Shift held).
    pub lock_aspect: bool,
}

impl ResizeElements {
    /// Builds a handle-drag resize command.
    pub fn new(id: ElementId, handle: HandleType, point: Point, lock_aspect: bool) -> Self {
        Self {
            id,
            handle,
            point,
            lock_aspect,
        }
    }
}

/// Resized box output of a handle drag (scene units).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResizedBox {
    /// New top-left x in scene coordinates.
    pub x: f64,
    /// New top-left y in scene coordinates.
    pub y: f64,
    /// New width in scene units.
    pub width: f64,
    /// New height in scene units.
    pub height: f64,
    /// Preview font size for text corner drags (`None` for every other
    /// kind and for width-only text drags, where the font is unchanged).
    /// Hosts paint live text content with this; the commit path derives
    /// the same value from the same helper.
    pub font_size: Option<f64>,
}

/// Text box sizing for a resize drag: corner handles scale the font by the
/// width ratio (uniform scale; the height follows the content at the new
/// size), edge handles keep the font and only reflow the width. Floors at
/// 8px like the proportional scaler. Returns `(font_size, auto_height)`.
fn scaled_text_box(
    text: &TextElement,
    handle: HandleType,
    new_width: f64,
    orig_width: f64,
) -> (f64, f64) {
    let corner = matches!(
        handle,
        HandleType::TopLeft
            | HandleType::TopRight
            | HandleType::BottomLeft
            | HandleType::BottomRight
    );
    let font_size = if corner && orig_width > 0.0 {
        (text.font_size * new_width / orig_width).round().max(8.0)
    } else {
        text.font_size
    };
    let line_height = font_size * crate::element::TEXT_LINE_HEIGHT_MULTIPLIER;
    let lines = text.text.split('\n').count().max(1) as f64;
    (font_size, (lines * line_height).max(line_height))
}

/// Read-only half of [`ResizeElements`]: guards plus box math, no mutation.
///
/// Returns `None` for unknown/deleted/locked targets (the commit path
/// reports those as unchanged no-ops). Shared by the commit path and the
/// host live-preview query so preview and commit cannot disagree.
///
/// Text elements keep their top edge and auto height (`lines × line
/// height`). Corner drags additionally scale the font by the width ratio so
/// the text itself grows with its box; edge drags only change the wrap
/// width and keep the font.
pub(crate) fn preview_resize_box(
    doc: &Document,
    id: &ElementId,
    handle: HandleType,
    point: Point,
    lock_aspect: bool,
) -> EngineResult<Option<ResizedBox>> {
    if !crate::geometry::point_is_finite(&point) {
        return Err(EngineError::InvalidInput(format!(
            "resize point must be finite, got ({}, {})",
            point[0], point[1]
        )));
    }
    let Some(element) = doc.get(id.as_str()) else {
        return Ok(None);
    };
    if element.base().is_deleted || doc.effective_locked(id.as_str()) {
        return Ok(None);
    }
    let base = element.base();
    let (orig_x, orig_y, orig_w, orig_h, rotation) =
        (base.x, base.y, base.width, base.height, base.rotation);
    let output = if rotation != 0.0 {
        resize_with_rotation(
            &Bounds::from_xywh(orig_x, orig_y, orig_w, orig_h),
            rotation,
            handle,
            &point,
            lock_aspect,
        )
    } else {
        resize_no_rotation(orig_x, orig_y, orig_w, orig_h, handle, &point, lock_aspect)
    };
    if let Element::Text(text) = element {
        let (font_size, auto_h) = scaled_text_box(text, handle, output.width, orig_w);
        return Ok(Some(ResizedBox {
            x: output.x,
            y: orig_y,
            width: output.width,
            height: auto_h,
            font_size: Some(font_size),
        }));
    }
    Ok(Some(ResizedBox {
        x: output.x,
        y: output.y,
        width: output.width,
        height: output.height,
        font_size: None,
    }))
}

impl Command for ResizeElements {
    fn label(&self) -> &str {
        "resize"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let Some(output) = preview_resize_box(
            ctx.doc(),
            &self.id,
            self.handle,
            self.point,
            self.lock_aspect,
        )?
        else {
            return Ok(CommandOutcome::default());
        };
        let Some(element) = ctx.doc().get(self.id.as_str()) else {
            return Ok(CommandOutcome::default());
        };
        let (orig_w, orig_h) = (element.base().width, element.base().height);
        let is_text = matches!(element, Element::Text(_));
        let mut next = element.clone();
        {
            let base_mut = next.base_mut();
            base_mut.x = output.x;
            base_mut.y = output.y;
            base_mut.width = output.width;
            base_mut.height = output.height;
        }
        // Text corner drags scale the font by the width ratio so the text
        // itself follows its box (the preview box above already used the
        // same scaled height); edge drags only change the width.
        // (Multi-select block scaling in `ResizeSelection` still scales
        // text proportionally — that path is unchanged.)
        if is_text {
            if let Element::Text(text) = &mut next {
                let (font_size, _) = scaled_text_box(text, self.handle, output.width, orig_w);
                text.font_size = font_size;
            }
        } else {
            apply_content_scaling(&mut next, orig_w, orig_h, output.width, output.height);
        }
        next.validate()?;
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.id.clone()],
            changed: true,
        })
    }
}

/// Proportional multi-select resize: scales every valid target with the
/// combined-bounds transform (TS `transform.ts` multi-select parity).
///
/// Each element keeps its relative offset inside `original` while the box
/// maps to `next`: position scales with the box origin, size scales with
/// the box extents (floor 1 per axis), and text/points/path content scales
/// via [`apply_content_scaling`]. Unknown/deleted/locked targets are
/// skipped; degenerate boxes (zero/negative/non-finite spans) are rejected
/// before anything is stored.
#[derive(Debug, Clone, PartialEq)]
pub struct ResizeSelection {
    /// Elements to scale.
    pub ids: Vec<ElementId>,
    /// Combined bounds before the drag.
    pub original: Bounds,
    /// Combined bounds after the drag.
    pub next: Bounds,
}

impl ResizeSelection {
    /// Builds a multi-select resize for the given bounds pair.
    pub fn new(ids: Vec<ElementId>, original: Bounds, next: Bounds) -> Self {
        Self {
            ids,
            original,
            next,
        }
    }
}

impl Command for ResizeSelection {
    fn label(&self) -> &str {
        "resize-selection"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let orig_w = self.original.max_x - self.original.min_x;
        let orig_h = self.original.max_y - self.original.min_y;
        let next_w = self.next.max_x - self.next.min_x;
        let next_h = self.next.max_y - self.next.min_y;
        for value in [orig_w, orig_h, next_w, next_h] {
            if !value.is_finite() {
                return Err(EngineError::InvalidInput(
                    "resize-selection bounds must be finite".to_string(),
                ));
            }
        }
        if orig_w <= 0.0 || orig_h <= 0.0 || next_w < 1.0 || next_h < 1.0 {
            return Ok(CommandOutcome::default());
        }
        let scale_x = next_w / orig_w;
        let scale_y = next_h / orig_h;
        let mut pending: Vec<Element> = Vec::new();
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()).cloned() else {
                continue;
            };
            if element.base().is_deleted || ctx.doc().effective_locked(id.as_str()) {
                continue;
            }
            let base = element.base();
            let rel_x = (base.x - self.original.min_x) / orig_w;
            let rel_y = (base.y - self.original.min_y) / orig_h;
            let mut next_el = element.clone();
            let (orig_ew, orig_eh) = (base.width, base.height);
            let (new_ew, new_eh);
            {
                let target = next_el.base_mut();
                target.x = self.next.min_x + rel_x * next_w;
                target.y = self.next.min_y + rel_y * next_h;
                target.width = (orig_ew * scale_x).max(1.0);
                target.height = (orig_eh * scale_y).max(1.0);
                new_ew = target.width;
                new_eh = target.height;
            }
            apply_content_scaling(&mut next_el, orig_ew, orig_eh, new_ew, new_eh);
            next_el.validate()?;
            pending.push(next_el);
        }
        if pending.is_empty() {
            return Ok(CommandOutcome::default());
        }
        let mut affected = Vec::with_capacity(pending.len());
        for next_el in pending {
            affected.push(next_el.id().clone());
            ctx.upsert(next_el)?;
        }
        Ok(CommandOutcome {
            affected,
            changed: true,
        })
    }
}

/// Directly sets an element's rotation (TS `Editor.rotateElement` parity:
/// unknown, deleted, and locked elements are skipped).
///
/// Non-finite angles are a typed error (hardening: TS silently returns).
#[derive(Debug, Clone, PartialEq)]
pub struct SetRotation {
    /// Element to rotate.
    pub id: ElementId,
    /// New rotation in radians.
    pub rotation: f64,
}

impl SetRotation {
    /// Builds a direct-set rotation command.
    pub fn new(id: ElementId, rotation: f64) -> Self {
        Self { id, rotation }
    }
}

impl Command for SetRotation {
    fn label(&self) -> &str {
        "rotate"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if !self.rotation.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "rotation must be finite, got {}",
                self.rotation
            )));
        }
        let Some(element) = ctx.doc().get(self.id.as_str()) else {
            return Ok(CommandOutcome::default());
        };
        if element.base().is_deleted || ctx.doc().effective_locked(self.id.as_str()) {
            return Ok(CommandOutcome::default());
        }
        let mut next = element.clone();
        next.base_mut().rotation = self.rotation;
        next.validate()?;
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.id.clone()],
            changed: true,
        })
    }
}

/// Drag rotation through the pointer-angle math.
///
/// Ports `TransformHandler.updateRotate`: the pointer-angle delta about the
/// element-bounds center is added to the start rotation; with Shift the
/// result snaps to 15° (`PI/12`) before the `[-PI, PI]` wrap (all pinned by
/// `transform.test.ts` via [`rotate_delta`]).
#[derive(Debug, Clone, PartialEq)]
pub struct RotateElements {
    /// Element to rotate (single-selection; the editor layer enforces this).
    pub id: ElementId,
    /// Pointer position at gesture start, in scene coordinates.
    pub anchor: Point,
    /// Current pointer position, in scene coordinates.
    pub current: Point,
    /// Snap flag (Shift held → 15° increments).
    pub snap: bool,
}

impl RotateElements {
    /// Builds a drag-rotation command.
    pub fn new(id: ElementId, anchor: Point, current: Point, snap: bool) -> Self {
        Self {
            id,
            anchor,
            current,
            snap,
        }
    }
}

/// Read-only half of [`RotateElements`]: guards plus angle math, no mutation.
///
/// Returns `None` for unknown/deleted/locked targets (the commit path
/// reports those as unchanged no-ops). Shared by the commit path and the
/// host live-preview query so preview and commit cannot disagree.
pub(crate) fn preview_rotation(
    doc: &Document,
    id: &ElementId,
    anchor: Point,
    current: Point,
    snap: bool,
) -> EngineResult<Option<f64>> {
    if !crate::geometry::point_is_finite(&anchor) || !crate::geometry::point_is_finite(&current) {
        return Err(EngineError::InvalidInput(
            "rotate anchor and pointer must be finite".to_string(),
        ));
    }
    let Some(element) = doc.get(id.as_str()) else {
        return Ok(None);
    };
    if element.base().is_deleted || doc.effective_locked(id.as_str()) {
        return Ok(None);
    }
    let center = element.bounds().center();
    Ok(Some(rotate_delta(
        element.base().rotation,
        &anchor,
        &current,
        &[center[0], center[1]],
        snap,
    )))
}

impl Command for RotateElements {
    fn label(&self) -> &str {
        "rotate"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let Some(next_rotation) =
            preview_rotation(ctx.doc(), &self.id, self.anchor, self.current, self.snap)?
        else {
            return Ok(CommandOutcome::default());
        };
        let Some(element) = ctx.doc().get(self.id.as_str()) else {
            return Ok(CommandOutcome::default());
        };
        let mut next = element.clone();
        next.base_mut().rotation = next_rotation;
        next.validate()?;
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.id.clone()],
            changed: true,
        })
    }
}

/// Replaces a text element's content and box (TS `finishEditing` commit
/// parity: the caller already trimmed + measured; unknown and deleted
/// elements are skipped; locked elements are *not* skipped — TS upserts
/// through the canonical path without a lock check, matching [`SetStyle`]).
#[derive(Debug, Clone, PartialEq)]
pub struct SetText {
    /// Text element to update.
    pub id: ElementId,
    /// Trimmed committed text (non-empty by construction).
    pub text: String,
    /// Re-measured box width.
    pub width: f64,
    /// Re-measured box height.
    pub height: f64,
}

impl SetText {
    /// Builds a text-commit command.
    pub fn new(id: ElementId, text: String, width: f64, height: f64) -> Self {
        Self {
            id,
            text,
            width,
            height,
        }
    }
}

impl Command for SetText {
    fn label(&self) -> &str {
        "text"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if !self.width.is_finite() || !self.height.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "text box must be finite, got ({}, {})",
                self.width, self.height
            )));
        }
        let Some(element) = ctx.doc().get(self.id.as_str()) else {
            return Ok(CommandOutcome::default());
        };
        if element.base().is_deleted {
            return Ok(CommandOutcome::default());
        }
        let crate::element::Element::Text(_) = element else {
            return Err(EngineError::InvalidInput(format!(
                "SetText targets text elements, '{}' is {}",
                self.id.as_str(),
                element.element_type_name()
            )));
        };
        let mut next = element.clone();
        if let crate::element::Element::Text(text) = &mut next {
            text.text = self.text.clone();
            text.base.width = self.width;
            text.base.height = self.height;
        }
        next.validate()?;
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.id.clone()],
            changed: true,
        })
    }
}

/// Tags elements with a group id as one undoable step.
///
/// Grouping needs at least two distinct live nodes. Duplicate ids in the
/// input reject the whole command while unknown ids are skipped for stale
/// UI tolerance. An effectively locked member rejects the whole command
/// before anything is stored. Members keep their ids, local locks, and
/// scene-space geometry; only membership paths change. The new container
/// clusters its members into one contiguous z-order block at the former
/// topmost member position so stacking stays predictable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupElements {
    /// Elements to tag.
    pub ids: Vec<ElementId>,
    /// Group id to append (minted by the caller, even when nothing is
    /// tagged — TS parity).
    pub group_id: ElementId,
}

impl GroupElements {
    /// Builds a grouping command.
    pub fn new(ids: Vec<ElementId>, group_id: ElementId) -> Self {
        Self { ids, group_id }
    }
}

impl Command for GroupElements {
    fn label(&self) -> &str {
        "group"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if self.group_id.as_str().is_empty() {
            return Err(EngineError::InvalidInput(
                "group id must not be empty".to_string(),
            ));
        }
        let mut seen_input = std::collections::HashSet::new();
        for id in &self.ids {
            if !seen_input.insert(id.clone()) {
                return Err(EngineError::InvalidInput(format!(
                    "group input contains duplicate id '{}'",
                    id.as_str()
                )));
            }
        }
        // Ancestor plus descendant selections collapse so shared nodes are
        // never tagged twice.
        let normalized = crate::hierarchy::normalize_group_input(ctx.doc(), &self.ids)?;
        if normalized.len() < 2 {
            return Err(EngineError::InvalidInput(
                "group needs at least two nodes".to_string(),
            ));
        }
        for id in &normalized {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if ctx.doc().effective_locked(id.as_str()) {
                return Err(EngineError::InvalidInput(format!(
                    "cannot group locked element '{}'",
                    id.as_str()
                )));
            }
            let _ = element;
        }
        // Nest each distinct direct source group under the new container so
        // element paths and the group parent chain describe the same tree.
        let mut groups = ctx.doc().groups();
        let mut source_parents: Vec<ElementId> = Vec::new();
        for id in &normalized {
            if let Some(parent) = ctx.doc().direct_parent(id.as_str()) {
                if !source_parents.contains(&parent) {
                    source_parents.push(parent);
                }
            }
        }
        if !groups.iter().any(|group| group.id == self.group_id) {
            groups.push(GroupRecord {
                id: self.group_id.clone(),
                name: format!("Group-{}", groups.len() + 1),
                parent_id: None,
                locked: false,
            });
        }
        // Source groups that lose all but grouped members stay nested; the
        // normalization pass after tagging dissolves the rest.
        for parent in &source_parents {
            if parent != &self.group_id {
                if let Some(record) = groups.iter_mut().find(|g| g.id == *parent) {
                    // Keep existing parents: the new group becomes an ancestor
                    // through element paths below, not by stealing parents here.
                    let _ = record;
                }
            }
        }
        // Tag members innermost-first relative to the new container: the new
        // group becomes the direct parent while outer ancestors above the
        // previous direct parent are preserved.
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for id in &normalized {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if element.base().is_deleted {
                continue;
            }
            let mut next = element.clone();
            // Replace the direct link with the new group, keeping outer
            // ancestors above the old direct parent intact.
            let mut path = next.base_mut().group_ids.clone();
            if path.is_empty() {
                path = vec![self.group_id.clone()];
            } else {
                path[0] = self.group_id.clone();
            }
            // Ensure the outer chain matches the group tree: the new group
            // is a root, so no outer entries survive the move.
            next.base_mut().group_ids = vec![self.group_id.clone()];
            next.validate()?;
            pending.push((id.clone(), next));
        }
        if pending.is_empty() {
            return Ok(CommandOutcome::default());
        }
        // Source direct groups that are left with fewer than two children
        // dissolve in the same entry through the shared normalizer.
        ctx.set_groups(groups)?;
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        // Cluster members contiguously at the former topmost position.
        let order = ctx.doc().order();
        let mut rank: HashMap<ElementId, usize> = HashMap::new();
        for (index, id) in order.iter().enumerate() {
            rank.insert(id.clone(), index);
        }
        let mut members = affected.clone();
        members.sort_by_key(|id| rank.get(id).copied().unwrap_or(usize::MAX));
        let top = members
            .iter()
            .filter_map(|id| rank.get(id).copied())
            .max()
            .unwrap_or(order.len().saturating_sub(1));
        let moving: std::collections::HashSet<ElementId> = members.iter().cloned().collect();
        let mut rest: Vec<ElementId> = order
            .into_iter()
            .filter(|id| !moving.contains(id))
            .collect();
        let insert_at = top.min(rest.len());
        for (offset, id) in members.iter().enumerate() {
            rest.insert(insert_at + offset, id.clone());
        }
        ctx.set_order(rest)?;
        crate::hierarchy::apply_normalization(ctx)?;
        // The new group itself is part of the outcome for host selection.
        affected.push(self.group_id.clone());
        Ok(CommandOutcome {
            affected,
            changed: true,
        })
    }
}

/// Strips a group id from every member as one undoable step.
///
/// Children promote to the dissolved parent (or the root when the group
/// was a root), keeping relative order, scene-space geometry, ids, and
/// local locks. Locked containers and containers below a locked ancestor
/// reject the whole command atomically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UngroupElements {
    /// Group id to strip.
    pub group_id: ElementId,
}

impl UngroupElements {
    /// Builds an ungrouping command.
    pub fn new(group_id: ElementId) -> Self {
        Self { group_id }
    }
}

impl Command for UngroupElements {
    fn label(&self) -> &str {
        "ungroup"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let Some(record) = ctx.doc().group(self.group_id.as_str()).cloned() else {
            return Err(EngineError::NotFound(format!(
                "group '{}'",
                self.group_id.as_str()
            )));
        };
        if ctx.doc().group_effective_locked(self.group_id.as_str()) {
            return Err(EngineError::InvalidInput(format!(
                "cannot ungroup locked group '{}'",
                self.group_id.as_str()
            )));
        }
        let parent = record.parent_id.clone();
        // Promote child subgroups to the dissolved parent before touching
        // element paths so both sides stay consistent.
        let groups: Vec<GroupRecord> = ctx
            .doc()
            .groups()
            .into_iter()
            .filter(|group| group.id != self.group_id)
            .map(|mut group| {
                if group.parent_id.as_ref() == Some(&self.group_id) {
                    group.parent_id = parent.clone();
                }
                group
            })
            .collect();
        // Promote member elements: drop the dissolved link, graft the new
        // parent chain for direct children, strip only the link elsewhere.
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for element in ctx.doc().get_all() {
            if !element.base().group_ids.contains(&self.group_id) {
                continue;
            }
            let mut next = element.clone();
            let path = next.base_mut().group_ids.clone();
            if path.first() == Some(&self.group_id) {
                let mut rebuilt = Vec::new();
                if let Some(parent_id) = &parent {
                    rebuilt.push(parent_id.clone());
                    rebuilt.extend(ctx.doc().group_ancestors(parent_id.as_str()));
                }
                // Preserve deeper outer ancestors above the dissolved group
                // when the path carried them (nested dissolve keeps the rest
                // of the chain intact).
                for outer in path.iter().skip(1) {
                    if outer != &self.group_id && !rebuilt.contains(outer) {
                        // Outer entries above a root dissolve are already
                        // represented by the grafted chain; keep only links
                        // that still name stored groups outside that chain.
                        let _ = outer;
                    }
                }
                next.base_mut().group_ids = rebuilt;
            } else {
                next.base_mut()
                    .group_ids
                    .retain(|member| member != &self.group_id);
            }
            next.validate()?;
            pending.push((next.id().clone(), next));
        }
        if pending.is_empty() && groups.len() == ctx.doc().groups().len() {
            return Ok(CommandOutcome::default());
        }
        // Order survivors into the dissolved slot: keep their relative
        // order, anchored at the former lowest rank of the group block.
        let slot = ctx.doc().group_order_slot(self.group_id.as_str());
        ctx.set_groups(groups)?;
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        if let Some(at) = slot {
            let order = ctx.doc().order();
            let moving: std::collections::HashSet<ElementId> = affected.iter().cloned().collect();
            let mut survivors: Vec<ElementId> = affected.clone();
            survivors.sort_by_key(|id| {
                order
                    .iter()
                    .position(|candidate| candidate == id)
                    .unwrap_or(usize::MAX)
            });
            let mut rest: Vec<ElementId> = order
                .into_iter()
                .filter(|id| !moving.contains(id))
                .collect();
            let insert_at = at.min(rest.len());
            for (offset, id) in survivors.iter().enumerate() {
                rest.insert(insert_at + offset, id.clone());
            }
            ctx.set_order(rest)?;
        }
        crate::hierarchy::apply_normalization(ctx)?;
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Renames one persistent group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameGroup {
    /// Group id.
    pub group_id: ElementId,
    /// New non-empty name.
    pub name: String,
}

impl Command for RenameGroup {
    fn label(&self) -> &str {
        "rename-group"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let mut groups = ctx.doc().groups();
        let Some(group) = groups.iter_mut().find(|group| group.id == self.group_id) else {
            return Err(EngineError::NotFound(format!(
                "group '{}'",
                self.group_id.as_str()
            )));
        };
        if self.name.trim().is_empty() {
            return Err(EngineError::InvalidInput(
                "group name must not be empty".to_string(),
            ));
        }
        if group.name == self.name {
            return Ok(CommandOutcome::default());
        }
        group.name = self.name.trim().to_string();
        ctx.set_groups(groups)?;
        Ok(CommandOutcome {
            affected: vec![self.group_id.clone()],
            changed: true,
        })
    }
}

/// Reparents one persistent group, rejecting cycles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReparentGroup {
    /// Group id.
    pub group_id: ElementId,
    /// New parent group, or `None` for root.
    pub parent_id: Option<ElementId>,
}

/// Moves elements into a group or back to the root.
///
/// A locally locked leaf may travel through this structural path with its
/// flag preserved, but escaping a locked ancestor is rejected. The
/// insertion index counts direct children of the destination and is clamped
/// so out-of-range UI values append instead of failing. Moved nodes keep
/// relative order and scene-space geometry; source containers normalize in
/// the same history entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoveElementsToGroup {
    /// Elements to move.
    pub ids: Vec<ElementId>,
    /// Destination group, or `None` for root.
    pub group_id: Option<ElementId>,
    /// Parent-relative insertion index. `None` appends at the end.
    pub index: Option<usize>,
}

impl MoveElementsToGroup {
    /// Builds a move with an explicit insertion index.
    pub fn with_index(
        ids: Vec<ElementId>,
        group_id: Option<ElementId>,
        index: Option<usize>,
    ) -> Self {
        Self {
            ids,
            group_id,
            index,
        }
    }
}

impl Command for MoveElementsToGroup {
    fn label(&self) -> &str {
        "move-to-group"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if self.ids.is_empty() {
            return Ok(CommandOutcome::default());
        }
        let mut seen = std::collections::HashSet::new();
        for id in &self.ids {
            if !seen.insert(id.clone()) {
                return Err(EngineError::InvalidInput(format!(
                    "move input contains duplicate id '{}'",
                    id.as_str()
                )));
            }
        }
        if self
            .group_id
            .as_ref()
            .is_some_and(|id| ctx.doc().group(id.as_str()).is_none())
        {
            return Err(EngineError::NotFound("destination group".to_string()));
        }
        if let Some(dest) = &self.group_id {
            if !crate::hierarchy::can_restructure_children(ctx.doc(), dest.as_str()) {
                return Err(EngineError::InvalidInput(format!(
                    "destination group '{}' is locked",
                    dest.as_str()
                )));
            }
            for id in &self.ids {
                if id == dest {
                    return Err(EngineError::InvalidInput(
                        "cannot move a group into itself".to_string(),
                    ));
                }
            }
        }
        // Local locks travel; ancestor locks block the escape.
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if element.base().is_deleted {
                continue;
            }
            let local = element.base().locked;
            let effective = ctx.doc().effective_locked(id.as_str());
            if effective && !local {
                return Err(EngineError::InvalidInput(format!(
                    "cannot move '{}' out of a locked ancestor",
                    id.as_str()
                )));
            }
            // Source containers must be unlocked for the removal side.
            if let Some(parent) = ctx.doc().direct_parent(id.as_str()) {
                if !crate::hierarchy::can_restructure_children(ctx.doc(), parent.as_str()) {
                    // Moving within the same locked parent still restructures
                    // locked contents, so it stays rejected. The only escape
                    // hatch is an explicit unlock first.
                    let stays = self.group_id.as_ref() == Some(&parent);
                    if !stays || effective {
                        return Err(EngineError::InvalidInput(format!(
                            "source group '{}' is locked",
                            parent.as_str()
                        )));
                    }
                }
            }
        }
        let target_path: Vec<ElementId> = match &self.group_id {
            None => Vec::new(),
            Some(dest) => {
                let mut path = vec![dest.clone()];
                path.extend(ctx.doc().group_ancestors(dest.as_str()));
                path
            }
        };
        let mut pending = Vec::new();
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if element.base().is_deleted {
                continue;
            }
            if element.base().group_ids == target_path {
                continue;
            }
            let mut next = element.clone();
            next.base_mut().group_ids = target_path.clone();
            next.validate()?;
            pending.push(next);
        }
        if pending.is_empty() {
            return Ok(CommandOutcome::default());
        }
        let affected: Vec<ElementId> = pending.iter().map(|element| element.id().clone()).collect();
        for element in pending {
            ctx.upsert(element)?;
        }
        // Global order: relocate the moved block to the parent-relative
        // insertion slot while preserving the relative order of movers.
        let order = ctx.doc().order();
        let mut rank: HashMap<ElementId, usize> = HashMap::new();
        for (index, id) in order.iter().enumerate() {
            rank.insert(id.clone(), index);
        }
        let mut movers = affected.clone();
        movers.sort_by_key(|id| rank.get(id).copied().unwrap_or(usize::MAX));
        let moving: std::collections::HashSet<ElementId> = movers.iter().cloned().collect();
        let rest: Vec<ElementId> = order
            .into_iter()
            .filter(|id| !moving.contains(id))
            .collect();
        let parent = crate::hierarchy::ParentRef::from_optional(self.group_id.clone());
        let slot = crate::hierarchy::global_slot_for_parent_index(
            ctx.doc(),
            &rest,
            &parent,
            self.index.unwrap_or(usize::MAX),
        );
        let mut next_order = rest;
        for (offset, id) in movers.iter().enumerate() {
            next_order.insert(slot.min(next_order.len()) + offset, id.clone());
        }
        ctx.set_order(next_order)?;
        crate::hierarchy::apply_normalization(ctx)?;
        Ok(CommandOutcome {
            changed: !affected.is_empty(),
            affected,
        })
    }
}

impl Command for ReparentGroup {
    fn label(&self) -> &str {
        "reparent-group"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if self.parent_id.as_ref() == Some(&self.group_id) {
            return Err(EngineError::InvalidInput(
                "group cannot parent itself".to_string(),
            ));
        }
        let mut groups = ctx.doc().groups();
        if !groups.iter().any(|group| group.id == self.group_id) {
            return Err(EngineError::NotFound(format!(
                "group '{}'",
                self.group_id.as_str()
            )));
        }
        if ctx.doc().group_effective_locked(self.group_id.as_str()) {
            return Err(EngineError::InvalidInput(format!(
                "cannot reparent locked group '{}'",
                self.group_id.as_str()
            )));
        }
        if let Some(parent) = &self.parent_id {
            if !groups.iter().any(|group| group.id == *parent) {
                return Err(EngineError::NotFound(format!(
                    "group '{}'",
                    parent.as_str()
                )));
            }
            if !crate::hierarchy::can_restructure_children(ctx.doc(), parent.as_str()) {
                return Err(EngineError::InvalidInput(format!(
                    "destination group '{}' is locked",
                    parent.as_str()
                )));
            }
            let mut current = Some(parent.clone());
            while let Some(id) = current {
                if id == self.group_id {
                    return Err(EngineError::InvalidInput(
                        "group reparent would create a cycle".to_string(),
                    ));
                }
                current = groups
                    .iter()
                    .find(|group| group.id == id)
                    .and_then(|group| group.parent_id.clone());
            }
            // A locked ancestor may never be escaped through reparenting.
            for ancestor in ctx.doc().group_ancestors(self.group_id.as_str()) {
                if ctx.doc().group_effective_locked(ancestor.as_str()) {
                    let stays_inside = {
                        let mut current = self.parent_id.clone();
                        let mut found = false;
                        while let Some(id) = current {
                            if id == ancestor {
                                found = true;
                                break;
                            }
                            current = groups
                                .iter()
                                .find(|group| group.id == id)
                                .and_then(|group| group.parent_id.clone());
                        }
                        found
                    };
                    if !stays_inside {
                        return Err(EngineError::InvalidInput(format!(
                            "cannot move group '{}' out of locked ancestor '{}'",
                            self.group_id.as_str(),
                            ancestor.as_str()
                        )));
                    }
                }
            }
        } else {
            // Moving to the root escapes any locked ancestor above.
            for ancestor in ctx.doc().group_ancestors(self.group_id.as_str()) {
                if ctx.doc().group_effective_locked(ancestor.as_str()) {
                    return Err(EngineError::InvalidInput(format!(
                        "cannot move group '{}' out of locked ancestor '{}'",
                        self.group_id.as_str(),
                        ancestor.as_str()
                    )));
                }
            }
        }
        // Source parent must allow the removal side.
        if let Some(source_parent) = ctx
            .doc()
            .group(self.group_id.as_str())
            .and_then(|group| group.parent_id.clone())
        {
            if !crate::hierarchy::can_restructure_children(ctx.doc(), source_parent.as_str())
                && Some(source_parent) != self.parent_id
            {
                return Err(EngineError::InvalidInput(
                    "source group is locked".to_string(),
                ));
            }
        }
        let group = groups
            .iter_mut()
            .find(|group| group.id == self.group_id)
            .expect("checked above");
        if group.parent_id == self.parent_id {
            return Ok(CommandOutcome::default());
        }
        group.parent_id = self.parent_id.clone();
        // Rewrite descendant element paths so the materialized membership
        // matches the new parent chain instead of diverging from it.
        let rewritten = crate::hierarchy::rewrite_paths_for_group_move(
            ctx.doc(),
            &self.group_id,
            self.parent_id.as_ref(),
        );
        ctx.set_groups(groups)?;
        let mut affected = vec![self.group_id.clone()];
        for (id, path) in rewritten {
            if let Some(element) = ctx.doc().get(id.as_str()) {
                let mut next = element.clone();
                next.base_mut().group_ids = path;
                next.validate()?;
                ctx.upsert(next)?;
                affected.push(id);
            }
        }
        crate::hierarchy::apply_normalization(ctx)?;
        Ok(CommandOutcome {
            affected,
            changed: true,
        })
    }
}

/// Sets the local lock flag on group containers as one undoable step.
///
/// Locking a container makes every descendant effectively locked without
/// touching stored child flags. Unlocking restores each descendant to its
/// own stored flag, so children locked before the parent stay locked after
/// the parent opens. Descendants cannot be individually unlocked while an
/// ancestor stays locked; that attempt reports success without changing the
/// observed state, and the effective query still returns locked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetGroupLocked {
    /// Groups to update.
    pub ids: Vec<ElementId>,
    /// Flag value to write.
    pub locked: bool,
}

impl SetGroupLocked {
    /// Builds a group lock-flag command.
    pub fn new(ids: Vec<ElementId>, locked: bool) -> Self {
        Self { ids, locked }
    }
}

impl Command for SetGroupLocked {
    fn label(&self) -> &str {
        if self.locked {
            "lock-group"
        } else {
            "unlock-group"
        }
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if self.ids.is_empty() {
            return Ok(CommandOutcome::default());
        }
        let mut seen = std::collections::HashSet::new();
        for id in &self.ids {
            if !seen.insert(id.clone()) {
                return Err(EngineError::InvalidInput(format!(
                    "group lock input contains duplicate id '{}'",
                    id.as_str()
                )));
            }
        }
        let mut groups = ctx.doc().groups();
        let mut affected = Vec::new();
        for id in &self.ids {
            let Some(record) = groups.iter_mut().find(|group| group.id == *id) else {
                return Err(EngineError::NotFound(format!("group '{}'", id.as_str())));
            };
            if record.locked == self.locked {
                continue;
            }
            record.locked = self.locked;
            affected.push(id.clone());
        }
        if affected.is_empty() {
            return Ok(CommandOutcome::default());
        }
        ctx.set_groups(groups)?;
        Ok(CommandOutcome {
            affected,
            changed: true,
        })
    }
}

/// Renames any node: groups, frames, or labeled elements.
///
/// Group names and frame titles update their own stores while other element
/// kinds update the explicit label map. Names are trimmed, empty names are
/// rejected, and duplicates are allowed because names are never identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenameNode {
    /// Node id (group id or element id).
    pub id: ElementId,
    /// New display name.
    pub name: String,
}

impl RenameNode {
    /// Builds a node rename command.
    pub fn new(id: ElementId, name: String) -> Self {
        Self { id, name }
    }
}

impl Command for RenameNode {
    fn label(&self) -> &str {
        "rename-node"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let trimmed = crate::hierarchy::validate_node_name(&self.name)?;
        if ctx.doc().group(self.id.as_str()).is_some() {
            let mut groups = ctx.doc().groups();
            let Some(record) = groups.iter_mut().find(|group| group.id == self.id) else {
                return Err(EngineError::NotFound(format!(
                    "group '{}'",
                    self.id.as_str()
                )));
            };
            if record.name == trimmed {
                return Ok(CommandOutcome::default());
            }
            record.name = trimmed;
            ctx.set_groups(groups)?;
            return Ok(CommandOutcome {
                affected: vec![self.id.clone()],
                changed: true,
            });
        }
        let Some(element) = ctx.doc().get(self.id.as_str()).cloned() else {
            return Err(EngineError::NotFound(format!(
                "node '{}'",
                self.id.as_str()
            )));
        };
        if element.base().is_deleted {
            return Err(EngineError::InvalidInput(format!(
                "node '{}' is deleted",
                self.id.as_str()
            )));
        }
        if let Element::Frame(_) = element {
            let mut next = element.clone();
            if let Element::Frame(frame) = &mut next {
                if frame.name == trimmed {
                    return Ok(CommandOutcome::default());
                }
                frame.name = trimmed;
            }
            next.validate()?;
            ctx.upsert(next)?;
            return Ok(CommandOutcome {
                affected: vec![self.id.clone()],
                changed: true,
            });
        }
        let planned =
            crate::hierarchy::plan_rename_labels(ctx.doc(), &[(self.id.clone(), trimmed)])?;
        ctx.set_labels(planned)?;
        Ok(CommandOutcome {
            affected: vec![self.id.clone()],
            changed: true,
        })
    }
}

/// Moves whole nodes (elements and groups) to a new parent at an insertion
/// index, preserving subtree structure, relative order, geometry, and local
/// locks in one atomic history entry.
///
/// Mixed selections normalize so descendants of a moved ancestor travel
/// exactly once with their ancestor. Escaping a locked ancestor, touching
/// locked destinations, or creating group cycles rejects the whole command
/// before anything is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReparentNodes {
    /// Nodes to move (element ids and group ids).
    pub ids: Vec<ElementId>,
    /// Destination parent (`None` for the root).
    pub parent: Option<ElementId>,
    /// Parent-relative insertion index (`None` appends).
    pub index: Option<usize>,
}

impl ReparentNodes {
    /// Builds a reparent command.
    pub fn new(ids: Vec<ElementId>, parent: Option<ElementId>, index: Option<usize>) -> Self {
        Self { ids, parent, index }
    }
}

impl Command for ReparentNodes {
    fn label(&self) -> &str {
        "reparent-nodes"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if self.ids.is_empty() {
            return Ok(CommandOutcome::default());
        }
        let mut seen = std::collections::HashSet::new();
        for id in &self.ids {
            if !seen.insert(id.clone()) {
                return Err(EngineError::InvalidInput(format!(
                    "reparent input contains duplicate id '{}'",
                    id.as_str()
                )));
            }
        }
        if self
            .parent
            .as_ref()
            .is_some_and(|id| ctx.doc().group(id.as_str()).is_none())
        {
            return Err(EngineError::NotFound("destination group".to_string()));
        }
        if let Some(dest) = &self.parent {
            for id in &self.ids {
                if id == dest {
                    return Err(EngineError::InvalidInput(
                        "cannot move a node into itself".to_string(),
                    ));
                }
                if ctx.doc().group(id.as_str()).is_some()
                    && crate::hierarchy::group_is_descendant(ctx.doc(), dest.as_str(), id.as_str())
                {
                    return Err(EngineError::InvalidInput(
                        "reparent would create a cycle".to_string(),
                    ));
                }
            }
            if !crate::hierarchy::can_restructure_children(ctx.doc(), dest.as_str()) {
                return Err(EngineError::InvalidInput(format!(
                    "destination group '{}' is locked",
                    dest.as_str()
                )));
            }
        }
        let normalized = crate::hierarchy::normalize_move_selection(ctx.doc(), &self.ids);
        if normalized.is_empty() {
            return Ok(CommandOutcome::default());
        }
        // Lock gate per moved root: groups need an unlocked effective flag
        // while elements may carry a local flag but never an ancestor flag
        // that the move would escape.
        for node in &normalized {
            match node {
                crate::hierarchy::NodeRef::Group(id) => {
                    if ctx.doc().group_effective_locked(id.as_str()) {
                        return Err(EngineError::InvalidInput(format!(
                            "cannot move locked group '{}'",
                            id.as_str()
                        )));
                    }
                }
                crate::hierarchy::NodeRef::Element(id) => {
                    let local = ctx.doc().local_locked(id.as_str());
                    let effective = ctx.doc().effective_locked(id.as_str());
                    if effective && !local {
                        return Err(EngineError::InvalidInput(format!(
                            "cannot move '{}' out of a locked ancestor",
                            id.as_str()
                        )));
                    }
                }
            }
        }
        // Element moves delegate to the element path; group moves delegate
        // to the group path. Mixed batches run both sides in one entry.
        let mut affected: Vec<ElementId> = Vec::new();
        let element_ids: Vec<ElementId> = normalized
            .iter()
            .filter_map(|node| match node {
                crate::hierarchy::NodeRef::Element(id) => Some(id.clone()),
                _ => None,
            })
            .collect();
        let group_ids: Vec<ElementId> = normalized
            .iter()
            .filter_map(|node| match node {
                crate::hierarchy::NodeRef::Group(id) => Some(id.clone()),
                _ => None,
            })
            .collect();
        if !element_ids.is_empty() {
            let mut mover =
                MoveElementsToGroup::with_index(element_ids, self.parent.clone(), self.index);
            let outcome = mover.execute(ctx)?;
            affected.extend(outcome.affected);
        }
        for group_id in group_ids {
            let mut mover = ReparentGroup {
                group_id: group_id.clone(),
                parent_id: self.parent.clone(),
            };
            let outcome = mover.execute(ctx)?;
            affected.extend(outcome.affected.into_iter().filter(|id| id != &group_id));
            affected.push(group_id);
        }
        // Deduplicate while preserving first-seen order.
        let mut seen_out = std::collections::HashSet::new();
        affected.retain(|id| seen_out.insert(id.clone()));
        if affected.is_empty() {
            return Ok(CommandOutcome::default());
        }
        Ok(CommandOutcome {
            affected,
            changed: true,
        })
    }
}

/// Duplicates a hierarchy selection with fresh stable ids.
///
/// Every duplicated element and group mints a fresh id while parent links,
/// relative order, scene-space geometry, and local locks are preserved
/// verbatim. The copies cluster directly after the topmost source element
/// so stacking stays adjacent to the original. Failures validate before
/// storing anything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateNodes {
    /// Nodes to duplicate (element ids and group ids).
    pub ids: Vec<ElementId>,
}

impl DuplicateNodes {
    /// Builds a duplication command.
    pub fn new(ids: Vec<ElementId>) -> Self {
        Self { ids }
    }
}

impl Command for DuplicateNodes {
    fn label(&self) -> &str {
        "duplicate-nodes"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        if self.ids.is_empty() {
            return Ok(CommandOutcome::default());
        }
        let normalized = crate::hierarchy::normalize_move_selection(ctx.doc(), &self.ids);
        if normalized.is_empty() {
            return Ok(CommandOutcome::default());
        }
        // Collect the full closure: moved groups expand to members plus
        // nested groups, moved elements travel alone.
        let mut element_set: std::collections::HashSet<ElementId> =
            std::collections::HashSet::new();
        let mut group_set: std::collections::HashSet<ElementId> = std::collections::HashSet::new();
        for node in &normalized {
            match node {
                crate::hierarchy::NodeRef::Element(id) => {
                    element_set.insert(id.clone());
                }
                crate::hierarchy::NodeRef::Group(id) => {
                    group_set.insert(id.clone());
                    for descendant in crate::hierarchy::descendant_groups(ctx.doc(), id.as_str()) {
                        group_set.insert(descendant);
                    }
                    for member in crate::hierarchy::subtree_elements(ctx.doc(), id.as_str()) {
                        element_set.insert(member);
                    }
                }
            }
        }
        let mut elements: Vec<ElementId> = element_set.into_iter().collect();
        elements.sort_by_key(|id| {
            ctx.doc()
                .order()
                .iter()
                .position(|candidate| candidate == id)
                .unwrap_or(usize::MAX)
        });
        if elements.is_empty() {
            return Ok(CommandOutcome::default());
        }
        for id in &elements {
            if ctx.doc().effective_locked(id.as_str()) {
                return Err(EngineError::InvalidInput(format!(
                    "cannot duplicate locked node '{}'",
                    id.as_str()
                )));
            }
        }
        for id in &group_set {
            if ctx.doc().group_effective_locked(id.as_str()) {
                return Err(EngineError::InvalidInput(format!(
                    "cannot duplicate locked group '{}'",
                    id.as_str()
                )));
            }
        }
        // Fresh ids for every copied node.
        let mut element_fresh: HashMap<ElementId, ElementId> = HashMap::new();
        for id in &elements {
            let mut fresh = ctx.fresh_element_id();
            while ctx.doc().contains(fresh.as_str())
                || element_fresh.values().any(|candidate| candidate == &fresh)
            {
                fresh = ctx.fresh_element_id();
            }
            element_fresh.insert(id.clone(), fresh);
        }
        let mut group_fresh: HashMap<ElementId, ElementId> = HashMap::new();
        let mut sorted_groups: Vec<ElementId> = group_set.into_iter().collect();
        sorted_groups.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        for id in &sorted_groups {
            let mut fresh = ctx.fresh_group_id();
            while ctx.doc().group(fresh.as_str()).is_some()
                || group_fresh.values().any(|candidate| candidate == &fresh)
            {
                fresh = ctx.fresh_group_id();
            }
            group_fresh.insert(id.clone(), fresh);
        }
        // Fresh group records preserve names, parents (remapped), and local
        // locks verbatim.
        let mut groups = ctx.doc().groups();
        for (old, fresh) in &group_fresh {
            if let Some(record) = ctx.doc().group(old.as_str()) {
                let parent = record.parent_id.clone().and_then(|parent| {
                    group_fresh.get(&parent).cloned().or_else(|| {
                        // Parents outside the duplicated closure stay linked
                        // when they still exist; otherwise the copy roots.
                        if ctx.doc().group(parent.as_str()).is_some() {
                            Some(parent)
                        } else {
                            None
                        }
                    })
                });
                groups.push(GroupRecord {
                    id: fresh.clone(),
                    name: record.name.clone(),
                    parent_id: parent,
                    locked: record.locked,
                });
            }
        }
        ctx.set_groups(groups)?;
        // Fresh elements preserve geometry, style, locks, and remapped
        // membership paths plus label copies.
        let mut labels = ctx.doc().labels();
        let mut copies: Vec<Element> = Vec::new();
        for id in &elements {
            let Some(element) = ctx.doc().get(id.as_str()).cloned() else {
                continue;
            };
            let mut next = element.clone();
            let fresh = element_fresh.get(id).cloned().expect("mapped above");
            next.base_mut().id = fresh.clone();
            next.base_mut().version = 0;
            next.base_mut().version_nonce = ctx.fresh_nonce();
            let remapped: Vec<ElementId> = next
                .base()
                .group_ids
                .iter()
                .map(|group| {
                    group_fresh
                        .get(group)
                        .cloned()
                        .unwrap_or_else(|| group.clone())
                })
                .collect();
            next.base_mut().group_ids = remapped;
            next.validate()?;
            if let Some(name) = ctx.doc().labels().iter().find(|label| label.id == *id) {
                labels.push(ElementLabel {
                    id: fresh.clone(),
                    name: name.name.clone(),
                });
            }
            copies.push(next);
        }
        ctx.set_labels(labels)?;
        for element in &copies {
            ctx.upsert(element.clone())?;
        }
        // Cluster copies directly after the topmost source.
        let order = ctx.doc().order();
        let top = elements
            .iter()
            .filter_map(|id| order.iter().position(|candidate| candidate == id))
            .max()
            .unwrap_or(order.len().saturating_sub(1));
        let copy_ids: Vec<ElementId> = copies.iter().map(|element| element.id().clone()).collect();
        let copy_set: std::collections::HashSet<ElementId> = copy_ids.iter().cloned().collect();
        let mut rest: Vec<ElementId> = order
            .into_iter()
            .filter(|id| !copy_set.contains(id))
            .collect();
        // Recompute the anchor after copies were appended at the end.
        let anchor = rest
            .iter()
            .position(|id| Some(id) == elements.last())
            .map(|pos| pos + 1)
            .unwrap_or(top.min(rest.len()));
        let _ = anchor;
        // Simpler deterministic anchor: directly after the topmost source
        // rank in the pre-copy order, which `top` already captures against
        // the old vector. Re-derive against `rest` by counting sources at
        // or below the anchor.
        let mut insert_at = 0usize;
        let mut seen_sources = 0usize;
        let source_set: std::collections::HashSet<ElementId> = elements.iter().cloned().collect();
        for (pos, id) in rest.iter().enumerate() {
            if source_set.contains(id) {
                seen_sources += 1;
                if seen_sources > top {
                    insert_at = pos + 1;
                    break;
                }
                insert_at = pos + 1;
            }
        }
        // Fallback when ranks shifted: clamp the recorded top.
        if insert_at == 0 {
            insert_at = top.min(rest.len());
        }
        for (offset, id) in copy_ids.iter().enumerate() {
            rest.insert(insert_at.min(rest.len()) + offset, id.clone());
        }
        ctx.set_order(rest)?;
        Ok(CommandOutcome {
            affected: copy_ids,
            changed: true,
        })
    }
}

/// Scales element content to follow a resized box (TS
/// `applyProportionalContentScaling` parity): line/arrow/freedraw points,
/// path anchors + handles, and text size; images/frames keep box-only
/// resize here.
fn apply_content_scaling(element: &mut Element, orig_w: f64, orig_h: f64, new_w: f64, new_h: f64) {
    let scale_x = if orig_w > 0.0 { new_w / orig_w } else { 1.0 };
    let scale_y = if orig_h > 0.0 { new_h / orig_h } else { 1.0 };
    match element {
        Element::Text(el) => {
            el.font_size = scale_font_size(el.font_size, orig_w, orig_h, new_w, new_h);
        }
        Element::Line(el) => {
            el.points = scale_points(&el.points, scale_x, scale_y);
        }
        Element::Arrow(el) => {
            el.points = scale_points(&el.points, scale_x, scale_y);
        }
        Element::Freedraw(el) => {
            el.points = scale_points(&el.points, scale_x, scale_y);
        }
        Element::Path(el) => {
            for segment in &mut el.segments {
                segment.point = [segment.point[0] * scale_x, segment.point[1] * scale_y];
                if let Some(handle) = segment.handle_in.as_mut() {
                    handle[0] *= scale_x;
                    handle[1] *= scale_y;
                }
                if let Some(handle) = segment.handle_out.as_mut() {
                    handle[0] *= scale_x;
                    handle[1] *= scale_y;
                }
            }
        }
        Element::Rectangle(_)
        | Element::Ellipse(_)
        | Element::Frame(_)
        | Element::Image(_)
        | Element::Instance(_)
        | Element::Custom(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator};

    fn rectangle(id: &str, gen: &mut CounterIdGenerator) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        Element::Rectangle(rect)
    }

    fn doc_with(ids: &[&str]) -> (Document, CounterIdGenerator) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        for id in ids {
            doc.upsert(rectangle(id, &mut gen)).unwrap();
        }
        (doc, gen)
    }

    #[test]
    fn create_validates_everything_before_storing_anything() {
        let (mut doc, mut gen) = doc_with(&["a"]);
        let mut bad = create_rectangle(&mut gen);
        bad.base.id = ElementId::of("bad");
        bad.base.width = f64::NAN;
        let nonce_before = doc.scene_nonce();
        let mut ctx = CommandContext::fresh(&mut doc);
        let mut cmd = CreateElements::new(vec![rectangle("b", &mut gen), Element::Rectangle(bad)]);
        assert!(cmd.execute(&mut ctx).is_err());
        // Roll the failed attempt back; content must equal the start, and
        // because validation rejected pre-touch, even the nonce is stable.
        ctx.rollback().unwrap();
        assert_eq!(doc.element_count(), 1);
        assert!(doc.get("b").is_none());
        assert!(!doc.contains("bad"));
        assert_eq!(doc.scene_nonce(), nonce_before);
    }

    #[test]
    fn move_skips_locked_deleted_and_unknown() {
        let (mut doc, _) = doc_with(&["a", "b", "c"]);
        let mut locked = doc.get("b").unwrap().clone();
        locked.base_mut().locked = true;
        doc.upsert(locked).unwrap();
        doc.soft_delete("c").unwrap();

        let mut ctx = CommandContext::fresh(&mut doc);
        let mut cmd = MoveElements::new(
            vec![
                ElementId::of("a"),
                ElementId::of("b"),
                ElementId::of("c"),
                ElementId::of("ghost"),
            ],
            10.0,
            5.0,
        );
        let outcome = cmd.execute(&mut ctx).unwrap();
        assert_eq!(outcome.affected, vec![ElementId::of("a")]);
        assert!(outcome.changed);
        let entry = ctx.into_entry();
        assert_eq!(entry.element_updates.len(), 1);
        assert!(entry.order_before.is_none());
    }

    #[test]
    fn group_rejects_locked_members_atomically() {
        let (mut doc, _) = doc_with(&["a", "b"]);
        let mut locked = doc.get("b").unwrap().clone();
        locked.base_mut().locked = true;
        doc.upsert(locked).unwrap();
        let group_id = ElementId::of("group-1");
        let nonce_before = doc.scene_nonce();
        let mut ctx = CommandContext::fresh(&mut doc);
        let mut command = GroupElements::new(
            vec![ElementId::of("a"), ElementId::of("b")],
            group_id.clone(),
        );
        let error = command.execute(&mut ctx).unwrap_err();
        assert!(error.to_string().contains("cannot group locked element"));
        assert_eq!(doc.scene_nonce(), nonce_before);
        assert!(doc.get("a").unwrap().base().group_ids.is_empty());
        assert!(doc.get("b").unwrap().base().group_ids.is_empty());
    }

    #[test]
    fn move_rejects_non_finite_delta_pre_touch() {
        let (mut doc, _) = doc_with(&["a"]);
        let nonce_before = doc.scene_nonce();
        let mut ctx = CommandContext::fresh(&mut doc);
        let mut cmd = MoveElements::new(vec![ElementId::of("a")], f64::NAN, 0.0);
        assert!(cmd.execute(&mut ctx).is_err());
        let entry = ctx.into_entry();
        assert!(entry.is_empty());
        assert_eq!(doc.scene_nonce(), nonce_before);
    }

    #[test]
    fn style_clamps_opacity_and_skips_unknown() {
        let (mut doc, _) = doc_with(&["a"]);
        let mut ctx = CommandContext::fresh(&mut doc);
        let mut cmd = SetStyle::new(
            vec![ElementId::of("a"), ElementId::of("ghost")],
            StylePatch {
                opacity: Some(150.0),
                stroke_color: Some("#ff0000".to_string()),
                ..StylePatch::default()
            },
        );
        let outcome = cmd.execute(&mut ctx).unwrap();
        assert!(outcome.changed);
        assert_eq!(outcome.affected, vec![ElementId::of("a")]);
        let entry = ctx.into_entry();
        assert_eq!(entry.element_updates.len(), 1);
    }

    #[test]
    fn empty_style_patch_is_a_noop() {
        let (mut doc, _) = doc_with(&["a"]);
        let mut ctx = CommandContext::fresh(&mut doc);
        let mut cmd = SetStyle::new(vec![ElementId::of("a")], StylePatch::default());
        let outcome = cmd.execute(&mut ctx).unwrap();
        assert!(!outcome.changed);
        assert!(ctx.into_entry().is_empty());
    }

    #[test]
    fn text_border_sets_clears_and_ignores_other_kinds() {
        use crate::element::create_text;
        let (mut doc, mut gen) = doc_with(&["a"]);
        let mut text = create_text(&mut gen);
        text.base.id = ElementId::of("t");
        doc.upsert(Element::Text(text)).unwrap();

        // Setting a border color stores it on the text only.
        let mut ctx = CommandContext::fresh(&mut doc);
        let mut cmd = SetStyle::new(
            vec![ElementId::of("t"), ElementId::of("a")],
            StylePatch {
                border_color: Some("#00ff00".to_string()),
                ..StylePatch::default()
            },
        );
        assert!(cmd.execute(&mut ctx).unwrap().changed);
        let _entry = ctx.into_entry();
        let stored = doc.get("t").unwrap();
        let Element::Text(stored) = stored else {
            panic!("expected a text element");
        };
        assert_eq!(stored.border_color, Some("#00ff00".to_string()));
        // Rectangles have no box border of their own: untouched.
        assert!(matches!(doc.get("a").unwrap(), Element::Rectangle(_)));

        // Clearing accepts the transparent sentinel as well as blanks.
        for clear in ["transparent", "TRANSPARENT", "   "] {
            // Re-set first so clearing always has something to remove.
            let mut current = match doc.get("t").unwrap().clone() {
                Element::Text(current) => current,
                _ => panic!("expected a text element"),
            };
            current.border_color = Some("#00ff00".to_string());
            doc.upsert(Element::Text(current)).unwrap();
            let mut ctx = CommandContext::fresh(&mut doc);
            let mut cmd = SetStyle::new(
                vec![ElementId::of("t")],
                StylePatch {
                    border_color: Some(clear.to_string()),
                    ..StylePatch::default()
                },
            );
            assert!(cmd.execute(&mut ctx).unwrap().changed);
            let _entry = ctx.into_entry();
            let Element::Text(cleared) = doc.get("t").unwrap() else {
                panic!("expected a text element");
            };
            assert_eq!(cleared.border_color, None, "clearing {clear:?}");
        }
    }

    #[test]
    fn reorder_noop_records_nothing() {
        let (mut doc, _) = doc_with(&["a", "b"]);
        let order = doc.order();
        let mut ctx = CommandContext::fresh(&mut doc);
        let mut cmd = Reorder::new(order);
        let outcome = cmd.execute(&mut ctx).unwrap();
        assert!(!outcome.changed);
        assert!(ctx.into_entry().is_empty());
    }
}
