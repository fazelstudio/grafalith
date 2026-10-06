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

use crate::document::Document;
use crate::element::{
    Element, ElementId, FillStyle, StrokeAlign, StrokeCap, StrokeJoin, StrokeStyle,
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
}

impl HistoryEntry {
    /// Returns `true` when the entry records nothing (no element deltas and
    /// no order change). Empty entries are never pushed by command
    /// execution or transaction commit.
    pub fn is_empty(&self) -> bool {
        self.element_updates.is_empty() && self.order_before.is_none() && self.order_after.is_none()
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
}

impl<'a> CommandContext<'a> {
    /// Creates a fresh context capturing the document's current z-order.
    pub(crate) fn fresh(doc: &'a mut Document) -> Self {
        let order_before = doc.order();
        Self {
            doc,
            updates: HashMap::new(),
            order_before,
        }
    }

    /// Borrows the document for read-only validation (commands inspect
    /// state here before storing anything).
    pub fn doc(&self) -> &Document {
        self.doc
    }

    /// Mints a fresh element id from the document's id source (collision
    /// handling stays the caller's job — see the clipboard codec for the
    /// loop pattern). Plugin commands need this because they only ever see
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
        HistoryEntry {
            element_updates: self.updates,
            order_before: order_changed.then_some(self.order_before),
            order_after: order_changed.then_some(order_after),
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
        let mut affected = Vec::new();
        for id in self.ids.clone() {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if element.base().is_deleted {
                continue;
            }
            ctx.soft_delete(id.as_str())?;
            affected.push(id);
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
        // Build and validate every next state before storing any.
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            let base = element.base();
            if base.is_deleted || base.locked {
                continue;
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
        let base = element.base();
        if base.is_deleted || base.locked {
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
}

/// Read-only half of [`ResizeElements`]: guards plus box math, no mutation.
///
/// Returns `None` for unknown/deleted/locked targets (the commit path
/// reports those as unchanged no-ops). Shared by the commit path and the
/// host live-preview query so preview and commit cannot disagree.
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
    let base = element.base();
    if base.is_deleted || base.locked {
        return Ok(None);
    }
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
    Ok(Some(ResizedBox {
        x: output.x,
        y: output.y,
        width: output.width,
        height: output.height,
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
        let mut next = element.clone();
        {
            let base_mut = next.base_mut();
            base_mut.x = output.x;
            base_mut.y = output.y;
            base_mut.width = output.width;
            base_mut.height = output.height;
        }
        apply_content_scaling(&mut next, orig_w, orig_h, output.width, output.height);
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
            if element.base().is_deleted || element.base().locked {
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
        if element.base().is_deleted || element.base().locked {
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
    if element.base().is_deleted || element.base().locked {
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

/// Tags elements with a group id as one undoable step (TS
/// `group-actions.ts` parity: unknown and deleted ids are skipped;
/// membership appends innermost-last).
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
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for id in &self.ids {
            let Some(element) = ctx.doc().get(id.as_str()) else {
                continue;
            };
            if element.base().is_deleted {
                continue;
            }
            let mut next = element.clone();
            next.base_mut().group_ids.push(self.group_id.clone());
            next.validate()?;
            pending.push((id.clone(), next));
        }
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Strips a group id from every member as one undoable step (TS `ungroup`
/// parity: nested memberships keep their other ids).
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
        let mut pending: Vec<(ElementId, Element)> = Vec::new();
        for element in ctx.doc().get_all() {
            if !element.base().group_ids.contains(&self.group_id) {
                continue;
            }
            let mut next = element.clone();
            next.base_mut()
                .group_ids
                .retain(|member| member != &self.group_id);
            next.validate()?;
            pending.push((next.id().clone(), next));
        }
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
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
