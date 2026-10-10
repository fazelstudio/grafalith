//! Document store: id map + explicit z-order + version/nonce authority.
//!
//! TS source: `packages/core/src/scene/scene.ts` (`Map<id, Element>` +
//! `elementOrder: string[]` + `sceneNonce`; `upsertElement` as the single
//! authoritative mutation path with clone-isolation; soft-delete;
//! `onMutation` / `onAfterUpsert` fan-out; owned `SpatialGrid`).
//!
//! [`Document`] owns the element map, the explicit z-order vector, and the
//! single version/nonce authority (exactly one owner, no competing
//! counters). Mutation goes through controlled APIs only; getters hand out
//! shared references or owned clones, never mutable access to internal
//! storage.
//!
//! Mutation observers (`onMutation` / `onAfterUpsert`) are intentionally
//! absent: the only subscribers are history and arrow-binding follow logic,
//! which call in directly — fan-out without a consumer would be dead
//! scaffolding. The owned [`SpatialGrid`] derived cache indexes non-deleted
//! elements at their rotation-aware bounds (tombstones evicted; `set_order`
//! untouched since z-order moves no bounds). JSON string encoding lives in
//! the io layer; [`DocumentSnapshot`] is the serialize-ready shape (mirrors
//! TS `SerializedScene`).

use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

use crate::element::{CounterIdGenerator, Element, ElementId, IdGenerator};
use crate::geometry::spatial::SpatialGrid;
use crate::geometry::Bounds;
use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Snapshot (serialize-ready envelope)
// ---------------------------------------------------------------------------

/// Envelope schema version, mirroring TS `schemaVersion: 1` (with the
/// legacy `version: 1` alias kept alongside, as in `io/export-json.ts`).
pub const SCHEMA_VERSION: u32 = 1;

/// Legacy alias of [`SCHEMA_VERSION`], always 1, kept for old readers
/// (mirrors the TS envelope).
pub const LEGACY_VERSION: u32 = 1;

/// Serialize-ready document snapshot.
///
/// Mirrors TS `SerializedScene`: non-deleted elements in z-order plus the
/// full order vector (which still names tombstones, exactly as
/// `Scene.getElementOrder` does). Transient state — selection, hover, tool,
/// drag, caret — is excluded by construction: it never lives in the
/// document (see [`crate::selection`]). The io layer derives `serde`
/// string encoding on this shape.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentSnapshot {
    /// Envelope schema version.
    pub schema_version: u32,
    /// Legacy alias, always 1.
    pub legacy_version: u32,
    /// Non-deleted elements in z-order.
    pub elements: Vec<Element>,
    /// Full z-order, including tombstone ids (TS export parity).
    pub element_order: Vec<ElementId>,
}

/// Counts returned by [`Document::apply_snapshot`], mirroring TS
/// `ImportResult` (surfaced instead of silently dropping data).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportSummary {
    /// Elements admitted to the document.
    pub imported: usize,
    /// Elements skipped as invalid.
    pub skipped: usize,
}

/// Validated, repaired import plan: the pure middle of the staged import
/// pipeline (parse, validate, repair/migrate, construct candidate, validate
/// candidate, commit).
///
/// [`Document::apply_snapshot`] commits a plan directly; history-tracked
/// importers (the io layer) commit the same plan through a
/// [`crate::history::HistoryManager`] transaction so the import is one
/// undoable, atomic step. Both paths share this preparation, so their
/// validation/repair semantics cannot drift.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportPlan {
    /// Admitted elements with dangling references repaired to `None`.
    pub elements: Vec<Element>,
    /// Restored z-order (filtered to admitted ids, missing ids appended),
    /// or `None` when the snapshot carries no order to restore.
    pub order: Option<Vec<ElementId>>,
    /// Elements admitted to the document.
    pub imported: usize,
    /// Elements skipped as invalid.
    pub skipped: usize,
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/// The persistent document: element map + explicit z-order.
///
/// Single source of truth for scene state (ARCHITECTURE §1). Lookup by id
/// is O(1) through the map; render/hit-test order comes from the separate
/// order vector so layer operations stay simple array moves (ARCHITECTURE
/// §2.4).
///
/// The document also owns a [`SpatialGrid`] cell-hash over the bounds of
/// every *non-deleted* element (TS `Scene.spatialGrid` parity,
/// `cellSize = 200`). The grid is a derived cache, never the source of
/// truth: every mutation path syncs it (deleted elements are evicted so
/// they stay out of culling/hit-test candidates), and
/// [`Document::rebuild_spatial`] restores it from scratch for recovery.
///
/// (`Document` intentionally has no `Clone`/`Debug`: the boxed id source
/// is neither. [`SpatialGrid`] itself is `Clone + Debug`.)
pub struct Document {
    /// Elements by stable id (includes soft-deleted tombstones).
    elements: HashMap<ElementId, Element>,
    /// Z-order, back-to-front (index 0 renders first / hits last).
    order: Vec<ElementId>,
    /// Bumped on every stored mutation; cache/event root (ARCHITECTURE
    /// §3.4). Monotonic via saturating addition.
    scene_nonce: u64,
    /// Sole source of version nonces and generated group ids.
    id_gen: Box<dyn IdGenerator + Send + Sync>,
    /// Derived bounds index (non-deleted elements only).
    spatial: SpatialGrid,
    /// Order version: bumped exactly when `order` changes shape, so the
    /// lazily-built rank cache below can tell freshness cheaply.
    order_version: u64,
    /// Lazily-built id → z-order rank map (`RwLock` because queries borrow
    /// `&self` while staying `Send + Sync` for hosts; rebuilt on first
    /// query after an order change, then reused — the hit-test fast path.
    /// Never a source of truth: `order` is).
    order_ranks: RwLock<Option<(u64, HashMap<ElementId, usize>)>>,
}

impl Document {
    /// Creates an empty document with a deterministic counter id source.
    pub fn new() -> Self {
        Self::with_id_generator(Box::new(CounterIdGenerator::new()))
    }

    /// Creates an empty document with a host-supplied id source.
    pub fn with_id_generator(id_gen: Box<dyn IdGenerator + Send + Sync>) -> Self {
        Self {
            elements: HashMap::new(),
            order: Vec::new(),
            scene_nonce: 0,
            id_gen,
            spatial: SpatialGrid::with_default_cell_size(),
            order_version: 0,
            order_ranks: RwLock::new(None),
        }
    }

    /// Current scene nonce (cache-invalidation root).
    pub fn scene_nonce(&self) -> u64 {
        self.scene_nonce
    }

    /// Borrows an element by id, or `None` when unknown.
    pub fn get(&self, id: &str) -> Option<&Element> {
        self.elements.get(id)
    }

    /// Returns `true` when the id names a stored element (deleted or not).
    pub fn contains(&self, id: &str) -> bool {
        self.elements.contains_key(id)
    }

    /// Visible (non-deleted) elements in z-order.
    pub fn get_all(&self) -> Vec<&Element> {
        let mut result = Vec::new();
        for id in &self.order {
            if let Some(element) = self.elements.get(id) {
                if !element.base().is_deleted {
                    result.push(element);
                }
            }
        }
        result
    }

    /// All stored elements in z-order, including tombstones (history and
    /// snapshot tooling use this; UI code wants [`Document::get_all`]).
    pub fn get_all_including_deleted(&self) -> Vec<&Element> {
        let mut result = Vec::new();
        for id in &self.order {
            if let Some(element) = self.elements.get(id) {
                result.push(element);
            }
        }
        result
    }

    /// Number of visible (non-deleted) elements.
    pub fn element_count(&self) -> usize {
        self.get_all().len()
    }

    /// Copies the z-order vector (back-to-front).
    pub fn order(&self) -> Vec<ElementId> {
        self.order.clone()
    }

    /// Inserts or updates an element — the single authoritative mutation
    /// path (TS `upsertElement` discipline): the element is validated
    /// *before* touching state, so rejection leaves the document unchanged;
    /// a new id keeps its provided version and is appended to the order; an
    /// existing id gets `version = previous + 1` with a fresh nonce (any
    /// caller-supplied version on an update is overwritten — callers must
    /// not pre-bump); the scene nonce bumps on every stored change.
    ///
    /// Cross-element references are intentionally NOT checked here (paste
    /// and import build them incrementally); call [`Document::validate`]
    /// for the whole-document pass.
    ///
    /// The spatial index follows TS `upsertElement`: a stored deleted
    /// element is evicted from the grid, a visible one is (re-)indexed at
    /// its rotation-aware bounds.
    pub fn upsert(&mut self, element: Element) -> EngineResult<()> {
        element.validate()?;
        let id = element.id().clone();
        if let Some(existing) = self.elements.get(&id) {
            let mut next = element;
            next.base_mut().version = existing.base().version.saturating_add(1);
            next.base_mut().version_nonce = self.id_gen.new_nonce();
            let bounds = next.bounds();
            let is_deleted = next.base().is_deleted;
            self.elements.insert(id.clone(), next);
            self.sync_grid_entry(id.as_str(), is_deleted, &bounds);
        } else {
            let bounds = element.bounds();
            let is_deleted = element.base().is_deleted;
            self.order.push(id.clone());
            self.bump_order_version();
            self.elements.insert(id.clone(), element);
            self.sync_grid_entry(id.as_str(), is_deleted, &bounds);
        }
        self.bump_nonce();
        Ok(())
    }

    /// Soft-deletes an element (`isDeleted = true`, kept in the map).
    ///
    /// Ghost (unknown id) and already-deleted targets are silent no-ops
    /// that leave the nonce untouched (pinned by `scene.test.ts`).
    /// A real delete evicts the id from the spatial index — tombstones are
    /// never culling/hit-test candidates (TS `deleteElement` parity).
    pub fn soft_delete(&mut self, id: &str) -> EngineResult<()> {
        let Some(existing) = self.elements.get(id) else {
            return Ok(());
        };
        if existing.base().is_deleted {
            return Ok(());
        }
        let mut next = existing.clone();
        next.base_mut().is_deleted = true;
        next.base_mut().version = next.base().version.saturating_add(1);
        next.base_mut().version_nonce = self.id_gen.new_nonce();
        self.elements.insert(next.id().clone(), next);
        self.spatial.remove(id);
        self.bump_nonce();
        Ok(())
    }

    /// Hard-deletes an element: removed from the map and the order.
    ///
    /// History-support primitive (TS `hardDelete` exists so undoing a
    /// creation removes the slot); applied during
    /// undo/redo. Unlike TS — which bumps unconditionally — the nonce only
    /// moves when something was actually removed. The spatial index drops
    /// the id alongside (unknown ids are silent no-ops there too).
    pub fn hard_delete(&mut self, id: &str) -> EngineResult<()> {
        if self.elements.remove(id).is_some() {
            self.order.retain(|order_id| order_id.as_str() != id);
            self.bump_order_version();
            self.spatial.remove(id);
            self.bump_nonce();
        }
        Ok(())
    }

    /// Replaces the z-order vector.
    ///
    /// Every id must name a stored element (`InvariantViolation` /
    /// `InvalidInput` otherwise — ordering references must stay valid; TS
    /// replaces blindly, which can strand the order).
    /// Reordering moves no bounds, so the spatial index is left alone.
    pub fn set_order(&mut self, order: Vec<ElementId>) -> EngineResult<()> {
        for id in &order {
            if !self.elements.contains_key(id) {
                return Err(EngineError::InvalidInput(format!(
                    "element order references unknown element '{}'",
                    id.as_str()
                )));
            }
        }
        self.order = order;
        self.bump_order_version();
        self.bump_nonce();
        Ok(())
    }

    /// Mints a fresh element id from the document's id source.
    ///
    /// Single authority for fresh identity: create, paste, and import paths
    /// all mint here so ids stay unique within the instance without a
    /// process global.
    pub fn fresh_element_id(&mut self) -> ElementId {
        self.id_gen.new_element_id()
    }

    /// Mints a fresh group id from the document's id source
    /// (crate-internal; group operations consume it).
    pub(crate) fn next_group_id(&mut self) -> ElementId {
        self.id_gen.new_group_id()
    }

    /// Mints a fresh version nonce from the document's id source.
    ///
    /// Single authority for fresh nonces: paste and import paths mint here
    /// so pasted elements never share a nonce with their source (which
    /// would defeat nonce-based change detection).
    pub fn fresh_nonce(&mut self) -> u32 {
        self.id_gen.new_nonce()
    }

    /// Mints a fresh render seed from the document's id source.
    ///
    /// Paste mints a fresh seed per element (TS `clipboard.ts` parity —
    /// pasted copies re-roll their hand-drawn styling).
    pub fn fresh_seed(&mut self) -> u32 {
        self.id_gen.new_seed()
    }

    /// Restores an exact element snapshot without version bookkeeping.
    ///
    /// History/rollback primitive (TS `HistoryManager.applyEntry` fix-up
    /// parity): undo, redo, and transaction rollback write previously-valid
    /// snapshots back verbatim — `version` and `version_nonce` are preserved,
    /// never bumped, so repeated undo/redo cycles never drift versions.
    /// New ids are appended to the order (callers restore the exact order
    /// separately via [`Document::set_order`]); existing ids keep their
    /// order slot. The scene nonce still bumps — content was replaced, so
    /// caches must invalidate. Invalid snapshots are rejected before
    /// touching state. The spatial index is re-synced exactly like
    /// [`Document::upsert`]: restored tombstones are evicted, visible
    /// elements re-indexed at their snapshot bounds.
    pub(crate) fn restore_exact(&mut self, element: Element) -> EngineResult<()> {
        element.validate()?;
        let bounds = element.bounds();
        let is_deleted = element.base().is_deleted;
        let id = element.id().clone();
        if !self.elements.contains_key(&id) {
            self.order.push(id.clone());
        }
        self.elements.insert(id.clone(), element);
        self.sync_grid_entry(id.as_str(), is_deleted, &bounds);
        self.bump_nonce();
        Ok(())
    }

    /// Bumps the scene nonce (single authority).
    fn bump_nonce(&mut self) {
        self.scene_nonce = self.scene_nonce.saturating_add(1);
    }

    /// Marks the z-order as reshaped (append/remove/replace): the lazily
    /// built rank cache rebuilds on the next ranked query. Only order
    /// shape bumps this — content edits bump the nonce, not the version.
    fn bump_order_version(&mut self) {
        self.order_version = self.order_version.saturating_add(1);
    }

    /// Whole-document invariant check: every order entry names a stored
    /// element; every stored element is intrinsically valid; `frame_id`,
    /// arrow bindings, and text `container_id` name stored elements
    /// (dangling references are rejected here — import/snapshot application
    /// repairs them to `None` before commit, mirroring TS).
    ///
    /// Group ids reference groups, not elements, so only non-emptiness is
    /// enforced (covered by element validation).
    pub fn validate(&self) -> EngineResult<()> {
        for id in &self.order {
            if !self.elements.contains_key(id) {
                return Err(EngineError::InvariantViolation(format!(
                    "element order references unknown element '{}'",
                    id.as_str()
                )));
            }
        }
        for element in self.elements.values() {
            element.validate()?;
        }
        for element in self.elements.values() {
            let base = element.base();
            if let Some(frame_id) = &base.frame_id {
                if !self.elements.contains_key(frame_id) {
                    return Err(EngineError::InvariantViolation(format!(
                        "element '{}' references unknown frame '{}'",
                        element.id().as_str(),
                        frame_id.as_str()
                    )));
                }
            }
            match element {
                Element::Arrow(arrow) => {
                    for binding in [&arrow.start_binding, &arrow.end_binding]
                        .into_iter()
                        .flatten()
                    {
                        if !self.elements.contains_key(&binding.element_id) {
                            return Err(EngineError::InvariantViolation(format!(
                                "arrow '{}' binds unknown element '{}'",
                                element.id().as_str(),
                                binding.element_id.as_str()
                            )));
                        }
                    }
                }
                Element::Text(text) => {
                    if let Some(container_id) = &text.container_id {
                        if !self.elements.contains_key(container_id) {
                            return Err(EngineError::InvariantViolation(format!(
                                "text '{}' references unknown container '{}'",
                                element.id().as_str(),
                                container_id.as_str()
                            )));
                        }
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Exports the serialize-ready snapshot (TS `exportSceneToJSON`
    /// shape without the string layer): non-deleted elements in z-order
    /// plus the full order vector.
    pub fn to_snapshot(&self) -> DocumentSnapshot {
        DocumentSnapshot {
            schema_version: SCHEMA_VERSION,
            legacy_version: LEGACY_VERSION,
            elements: self.get_all().into_iter().cloned().collect(),
            element_order: self.order.clone(),
        }
    }

    /// Validates a snapshot into an [`ImportPlan`] without touching document
    /// state: the envelope version must be the supported schema
    /// (lenient-version / strict-data: anything else is rejected); elements
    /// validate individually, with invalid ones skipped and counted (a
    /// non-empty snapshot with zero valid elements is rejected); dangling
    /// `frame_id`, arrow bindings, and text `container_id` are repaired to
    /// `None` against the admitted id set; the snapshot order is filtered to
    /// admitted ids with missing valid ids appended (forward-compat, TS
    /// parity).
    pub fn plan_snapshot(snapshot: &DocumentSnapshot) -> EngineResult<ImportPlan> {
        if snapshot.schema_version != SCHEMA_VERSION {
            return Err(EngineError::InvalidInput(format!(
                "unsupported scene version: {}",
                snapshot.schema_version
            )));
        }

        let mut valid: Vec<Element> = Vec::new();
        let mut skipped = 0;
        for element in &snapshot.elements {
            if element.validate().is_ok() {
                valid.push(element.clone());
            } else {
                skipped += 1;
            }
        }
        if valid.is_empty() && !snapshot.elements.is_empty() {
            return Err(EngineError::InvalidInput(
                "no valid elements found in scene data".to_string(),
            ));
        }

        // Referential repair against the admitted id set (TS parity).
        let admitted: HashSet<ElementId> =
            valid.iter().map(|element| element.id().clone()).collect();
        for element in &mut valid {
            let base = element.base_mut();
            if let Some(frame_id) = &base.frame_id {
                if !admitted.contains(frame_id) {
                    base.frame_id = None;
                }
            }
            match element {
                Element::Arrow(arrow) => {
                    for slot in [&mut arrow.start_binding, &mut arrow.end_binding] {
                        if let Some(binding) = slot {
                            if !admitted.contains(&binding.element_id) {
                                *slot = None;
                            }
                        }
                    }
                }
                Element::Text(text) => {
                    if let Some(container_id) = &text.container_id {
                        if !admitted.contains(container_id) {
                            text.container_id = None;
                        }
                    }
                }
                _ => {}
            }
        }

        let order = if snapshot.element_order.is_empty() {
            None
        } else {
            let admitted_ids: HashSet<&ElementId> = valid.iter().map(Element::id).collect();
            let mut restored: Vec<ElementId> = snapshot
                .element_order
                .iter()
                .filter(|id| admitted_ids.contains(*id))
                .cloned()
                .collect();
            // Linear membership (not `Vec::contains` per element, which is
            // quadratic on large imports — measured 26 s at 100k): append
            // admitted ids missing from the order, keeping `valid` order.
            let mut seen: HashSet<ElementId> = restored.iter().cloned().collect();
            for element in &valid {
                if seen.insert(element.id().clone()) {
                    restored.push(element.id().clone());
                }
            }
            Some(restored)
        };

        Ok(ImportPlan {
            imported: valid.len(),
            skipped,
            elements: valid,
            order,
        })
    }

    /// Atomically replaces document content from a snapshot (TS
    /// `importSceneFromJSON` semantics without the JSON string layer).
    ///
    /// The plan phase ([`Document::plan_snapshot`]) rejects version and
    /// zero-valid failures *before* touching state; the commit then
    /// soft-deletes currently visible elements, upserts the valid ones,
    /// and restores the planned order. Committed elements were validated
    /// during planning, so the commit itself cannot fail partway. The
    /// commit syncs the grid incrementally through those same paths and
    /// then rebuilds it from scratch, so a snapshot import never leaves a
    /// stale cell behind even if an incremental path evolves.
    pub fn apply_snapshot(&mut self, snapshot: &DocumentSnapshot) -> EngineResult<ImportSummary> {
        let plan = Self::plan_snapshot(snapshot)?;

        // Commit: clear visible, upsert valid, restore order.
        let visible_ids: Vec<ElementId> = self
            .get_all()
            .iter()
            .map(|element| (*element).id().clone())
            .collect();
        for id in visible_ids {
            self.soft_delete(id.as_str())?;
        }
        for element in plan.elements {
            self.upsert(element)?;
        }
        if let Some(restored) = plan.order {
            self.set_order(restored)?;
        }
        self.rebuild_spatial();

        Ok(ImportSummary {
            imported: plan.imported,
            skipped: plan.skipped,
        })
    }

    /// Syncs one stored entry into the spatial index (TS `upsertElement`
    /// parity): tombstones are evicted, visible elements re-indexed.
    /// Infallible — grid ops never fail a valid mutation.
    fn sync_grid_entry(&mut self, id: &str, is_deleted: bool, bounds: &Bounds) {
        if is_deleted {
            self.spatial.remove(id);
        } else {
            self.spatial.update(id, bounds);
        }
    }

    /// Number of elements currently indexed (TS `getSize`).
    ///
    /// Equals the visible element count while the invariant holds
    /// (every non-deleted element indexed exactly once, no tombstones).
    pub fn spatial_len(&self) -> usize {
        self.spatial.len()
    }

    /// Rebuilds the spatial index from scratch: clears it and re-indexes
    /// every non-deleted element at its current bounds.
    ///
    /// Recovery/validation path (and the commit tail of
    /// [`Document::apply_snapshot`]); steady-state mutations sync
    /// incrementally instead. Infallible.
    pub fn rebuild_spatial(&mut self) {
        self.spatial.clear();
        for element in self.elements.values() {
            if !element.base().is_deleted {
                let bounds = element.bounds();
                self.spatial.update(element.id().as_str(), &bounds);
            }
        }
    }

    /// Candidate ids whose indexed cells overlap `bounds`: a culling /
    /// hit-test pre-filter, not an exact answer. False positives are
    /// possible (cell neighbours); false negatives never happen — callers
    /// follow with an exact bounds/hit check.
    ///
    /// Tombstones and unknown ids are filtered defensively, so a stale
    /// cell can never surface a deleted element. Result order is
    /// unspecified (cell-hash order); use [`Document::order`] when z-order
    /// matters.
    pub fn query_spatial(&self, bounds: &Bounds) -> Vec<ElementId> {
        self.spatial
            .query_bounds_vec(bounds)
            .into_iter()
            .filter_map(|id| {
                let stored = self.elements.get(id.as_str())?;
                if stored.base().is_deleted {
                    None
                } else {
                    Some(ElementId::of(id))
                }
            })
            .collect()
    }

    /// Spatial candidates sorted back-to-front (top-first) by z-order rank.
    ///
    /// The rank map builds lazily on the first query after an order change
    /// and is then reused, so repeated hit-tests cost `O(candidates log
    /// candidates)` instead of an O(n) order walk per query. Tombstone and
    /// unknown ids are filtered exactly like [`Document::query_spatial`].
    pub fn ranked_candidates(&self, bounds: &Bounds) -> Vec<ElementId> {
        // Poison-tolerant: a poisoned lock means another thread panicked
        // mid-rebuild; the map rebuilds from `order` (source of truth) and
        // stays correct, so carry on instead of panicking library code.
        fn poison_ok<T>(error: std::sync::PoisonError<T>) -> T {
            error.into_inner()
        }
        let version = self.order_version;
        let fresh = self
            .order_ranks
            .read()
            .map(|guard| guard.as_ref().is_some_and(|(cached, _)| *cached == version))
            .unwrap_or(false);
        if !fresh {
            let mut map = HashMap::with_capacity(self.order.len());
            for (rank, id) in self.order.iter().enumerate() {
                map.insert(id.clone(), rank);
            }
            *self.order_ranks.write().unwrap_or_else(poison_ok) = Some((version, map));
        }
        let guard = self.order_ranks.read().unwrap_or_else(poison_ok);
        let map = &guard.as_ref().expect("rank cache built above").1;
        let mut ranked: Vec<(usize, ElementId)> = self
            .query_spatial(bounds)
            .into_iter()
            .filter_map(|id| map.get(&id).map(|&rank| (rank, id)))
            .collect();
        ranked.sort_by_key(|(rank, _)| std::cmp::Reverse(*rank));
        ranked.into_iter().map(|(_, id)| id).collect()
    }

    /// Unrotated `x/y/width/height` box of an element, or `None` when the
    /// id is unknown.
    ///
    /// Padanan `getElementRawBounds`: unlike [`Element::bounds`] (which is
    /// rotation-aware and expands for rotated elements) this never accounts
    /// for rotation — layout/frame math uses this, paint/hit extents use
    /// `bounds()`.
    pub fn raw_bounds(&self, id: &str) -> Option<Bounds> {
        let base = self.elements.get(id)?.base();
        Some(Bounds::from_xywh(base.x, base.y, base.width, base.height))
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_ellipse, create_rectangle};

    fn rectangle(id: &str, gen: &mut CounterIdGenerator) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        Element::Rectangle(rect)
    }

    fn rectangle_at(id: &str, gen: &mut CounterIdGenerator, x: f64, y: f64) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        rect.base.x = x;
        rect.base.y = y;
        Element::Rectangle(rect)
    }

    fn id_set(ids: Vec<ElementId>) -> std::collections::HashSet<String> {
        ids.into_iter().map(|id| id.into_string()).collect()
    }

    #[test]
    fn starts_empty_with_zero_nonce() {
        let doc = Document::new();
        assert_eq!(doc.element_count(), 0);
        assert_eq!(doc.scene_nonce(), 0);
    }

    #[test]
    fn upsert_adds_element_and_bumps_nonce() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle("rect-1", &mut gen)).unwrap();
        assert_eq!(doc.element_count(), 1);
        assert_eq!(doc.scene_nonce(), 1);
        let stored = doc.get("rect-1").unwrap();
        assert_eq!(stored.element_type_name(), "rectangle");
    }

    #[test]
    fn upsert_updates_without_duplicating_and_bumps_version() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle("rect-1", &mut gen)).unwrap();
        let before = doc.get("rect-1").unwrap().clone();

        let mut moved = before.clone();
        moved.base_mut().x = 50.0;
        // A caller-supplied version bump is overwritten authoritatively.
        moved.base_mut().version = 99;
        doc.upsert(moved).unwrap();

        assert_eq!(doc.element_count(), 1);
        assert_eq!(doc.scene_nonce(), 2);
        let stored = doc.get("rect-1").unwrap();
        assert_eq!(stored.base().x, 50.0);
        assert_eq!(stored.base().version, before.base().version + 1);
        assert_ne!(
            stored.base().version_nonce,
            before.base().version_nonce,
            "every stored change mints a fresh nonce"
        );
    }

    #[test]
    fn soft_delete_sets_flag_and_hides() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle("rect-1", &mut gen)).unwrap();
        doc.soft_delete("rect-1").unwrap();
        assert_eq!(doc.scene_nonce(), 2);
        let stored = doc.get("rect-1").unwrap();
        assert!(stored.base().is_deleted);
        assert_eq!(doc.element_count(), 0);
        assert_eq!(doc.get_all_including_deleted().len(), 1);
    }

    #[test]
    fn ghost_delete_is_a_no_op() {
        let mut doc = Document::new();
        doc.soft_delete("ghost").unwrap();
        assert_eq!(doc.scene_nonce(), 0);
        assert!(doc.get("non-existent").is_none());
    }

    #[test]
    fn z_order_follows_insertion() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        for id in ["a", "b", "c"] {
            doc.upsert(rectangle(id, &mut gen)).unwrap();
        }
        let ids: Vec<&str> = doc
            .get_all()
            .iter()
            .map(|element| element.id().as_str())
            .collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
    }

    #[test]
    fn nonce_tracks_every_mutation() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle("rect-1", &mut gen)).unwrap();
        let nonce1 = doc.scene_nonce();
        let mut moved = doc.get("rect-1").unwrap().clone();
        moved.base_mut().x = 20.0;
        doc.upsert(moved).unwrap();
        let nonce2 = doc.scene_nonce();
        doc.soft_delete("rect-1").unwrap();
        let nonce3 = doc.scene_nonce();
        assert!(nonce2 > nonce1);
        assert!(nonce3 > nonce2);
    }

    #[test]
    fn upsert_rejects_invalid_elements_atomically() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle("rect-1", &mut gen)).unwrap();

        let mut bad = create_rectangle(&mut gen);
        bad.base.id = ElementId::of("bad");
        bad.base.width = f64::NAN;
        let nonce_before = doc.scene_nonce();
        assert!(doc.upsert(Element::Rectangle(bad)).is_err());
        assert_eq!(doc.scene_nonce(), nonce_before, "rejection stores nothing");
        assert_eq!(doc.element_count(), 1);
        assert!(!doc.contains("bad"));
    }

    #[test]
    fn set_order_rejects_unknown_ids() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle("a", &mut gen)).unwrap();
        let nonce_before = doc.scene_nonce();
        let err = doc
            .set_order(vec![ElementId::of("a"), ElementId::of("ghost")])
            .unwrap_err();
        assert!(matches!(err, EngineError::InvalidInput(_)));
        assert_eq!(doc.scene_nonce(), nonce_before);
        assert_eq!(
            doc.order(),
            vec![ElementId::of("a")],
            "failed reorder keeps the old order"
        );
    }

    #[test]
    fn ellipse_round_trips_through_document() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut ellipse = create_ellipse(&mut gen);
        ellipse.base.id = ElementId::of("ellipse-1");
        doc.upsert(Element::Ellipse(ellipse)).unwrap();
        assert_eq!(doc.element_count(), 1);
        doc.soft_delete("ellipse-1").unwrap();
        assert_eq!(doc.element_count(), 0);
        assert_eq!(doc.get_all_including_deleted().len(), 1);
    }

    #[test]
    fn upsert_indexes_element_for_spatial_query() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle_at("rect-1", &mut gen, 10.0, 10.0))
            .unwrap();
        assert_eq!(doc.spatial_len(), 1);
        let found = id_set(doc.query_spatial(&Bounds::new(0.0, 0.0, 200.0, 200.0)));
        assert!(found.contains("rect-1"));
        let far = doc.query_spatial(&Bounds::new(1000.0, 1000.0, 1200.0, 1200.0));
        assert!(far.is_empty(), "distant window must miss");
    }

    #[test]
    fn move_updates_spatial_index_without_stale_cells() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle_at("rect-1", &mut gen, 10.0, 10.0))
            .unwrap();
        let mut moved = doc.get("rect-1").unwrap().clone();
        moved.base_mut().x = 1000.0;
        moved.base_mut().y = 1000.0;
        doc.upsert(moved).unwrap();

        assert_eq!(doc.spatial_len(), 1, "move must not duplicate the entry");
        let old = doc.query_spatial(&Bounds::new(0.0, 0.0, 200.0, 200.0));
        assert!(old.is_empty(), "old area must stop reporting the id");
        let found = id_set(doc.query_spatial(&Bounds::new(900.0, 900.0, 1200.0, 1200.0)));
        assert!(found.contains("rect-1"));
    }

    #[test]
    fn upserting_deleted_element_is_not_indexed() {
        // TS `upsertElement` parity: a stored deleted element is removed
        // from the grid, never inserted.
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of("ghost");
        rect.base.is_deleted = true;
        doc.upsert(Element::Rectangle(rect)).unwrap();
        assert_eq!(doc.spatial_len(), 0);
        assert!(doc
            .query_spatial(&Bounds::new(-1000.0, -1000.0, 1000.0, 1000.0))
            .is_empty());
    }

    #[test]
    fn soft_and_hard_delete_evict_from_spatial_index() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle_at("a", &mut gen, 10.0, 10.0)).unwrap();
        doc.upsert(rectangle_at("b", &mut gen, 60.0, 60.0)).unwrap();
        assert_eq!(doc.spatial_len(), 2);

        doc.soft_delete("a").unwrap();
        assert_eq!(doc.spatial_len(), 1);
        let found = id_set(doc.query_spatial(&Bounds::new(0.0, 0.0, 200.0, 200.0)));
        assert!(!found.contains("a") && found.contains("b"));

        doc.hard_delete("b").unwrap();
        assert_eq!(doc.spatial_len(), 0);
        assert!(doc
            .query_spatial(&Bounds::new(0.0, 0.0, 200.0, 200.0))
            .is_empty());
    }

    #[test]
    fn rebuild_spatial_indexes_visible_only() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(rectangle_at("a", &mut gen, 10.0, 10.0)).unwrap();
        doc.upsert(rectangle_at("b", &mut gen, 500.0, 500.0))
            .unwrap();
        doc.soft_delete("b").unwrap();

        doc.rebuild_spatial();
        assert_eq!(doc.spatial_len(), 1);
        let found = id_set(doc.query_spatial(&Bounds::new(0.0, 0.0, 200.0, 200.0)));
        assert!(found.contains("a"));
        assert!(doc
            .query_spatial(&Bounds::new(400.0, 400.0, 700.0, 700.0))
            .is_empty());
    }

    #[test]
    fn raw_bounds_ignores_rotation() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of("rect-1");
        rect.base.x = 10.0;
        rect.base.y = 20.0;
        rect.base.width = 100.0;
        rect.base.height = 80.0;
        rect.base.rotation = std::f64::consts::FRAC_PI_4;
        doc.upsert(Element::Rectangle(rect)).unwrap();

        assert_eq!(
            doc.raw_bounds("rect-1"),
            Some(Bounds::new(10.0, 20.0, 110.0, 100.0))
        );
        let rotated = doc.get("rect-1").unwrap().bounds();
        assert!(
            rotated.min_x < 10.0 && rotated.min_y < 20.0,
            "rotation-aware bounds expand beyond the raw box: {rotated:?}"
        );
        assert!(doc.raw_bounds("unknown").is_none());
    }
}

#[cfg(test)]
mod rank_cache_tests {
    use super::*;
    use crate::element::{create_rectangle, Element};

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn document_stays_send_and_sync_for_hosts() {
        // The rank cache must not cost hosts thread-sharability.
        assert_send_sync::<Document>();
    }

    fn probe_all() -> Bounds {
        // Tight probe: a huge box would span millions of grid cells.
        Bounds::new(-10.0, -10.0, 100.0, 100.0)
    }

    fn ranked_ids(doc: &Document) -> Vec<String> {
        doc.ranked_candidates(&probe_all())
            .iter()
            .map(|id| id.as_str().to_string())
            .collect()
    }

    #[test]
    fn ranked_candidates_follow_order_mutations() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        for (id, x) in [("a", 0.0), ("b", 20.0), ("c", 40.0)] {
            let mut rect = create_rectangle(&mut gen);
            rect.base.id = ElementId::of(id);
            rect.base.x = x;
            rect.base.y = 0.0;
            rect.base.width = 10.0;
            rect.base.height = 10.0;
            doc.upsert(Element::Rectangle(rect)).unwrap();
        }
        // Top-first: last inserted wins.
        assert_eq!(ranked_ids(&doc), vec!["c", "b", "a"]);
        // Reorder invalidates the cache.
        doc.set_order(vec![
            ElementId::of("c"),
            ElementId::of("a"),
            ElementId::of("b"),
        ])
        .unwrap();
        assert_eq!(ranked_ids(&doc), vec!["b", "a", "c"]);
        // Hard delete drops the id from ranks.
        doc.hard_delete("a").unwrap();
        assert_eq!(ranked_ids(&doc), vec!["b", "c"]);
        // Content-only edits keep ranks without rebuilding.
        let mut moved = doc.get("b").unwrap().clone();
        moved.base_mut().x = 60.0;
        doc.upsert(moved).unwrap();
        assert_eq!(ranked_ids(&doc), vec!["b", "c"]);
    }
}
