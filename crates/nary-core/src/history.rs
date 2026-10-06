//! Undo/redo history over recorded command entries plus transactions.
//!
//! TS source: `packages/core/src/history/history-manager.ts`
//! (`maxStackSize = 100`; batch collapse so one gesture = one entry; order
//! snapshots; redo-clear on new mutation; mid-batch auto-commit on undo;
//! redo refused mid-batch; `destroy`; manual `recordEntry`).
//!
//! The recording model is explicit, not a `Scene.onMutation` observer:
//! [`HistoryManager::execute`] runs a [`Command`] against a
//! [`CommandContext`] and pushes the resulting [`HistoryEntry`]. Behavior
//! parity with the TS observer is preserved at the observable level —
//! stacks, batching, order snapshots, redo invalidation, limit, and destroy
//! all behave the same; see the unit tests ported from
//! `history-manager.test.ts`.

use std::collections::HashMap;

use crate::command::{
    Command, CommandContext, CommandOutcome, HistoryEntry, HistorySide, SlotDelta,
};
use crate::document::Document;
use crate::element::ElementId;
use crate::{EngineError, EngineResult};

/// Default undo-stack capacity (TS `DEFAULT_MAX_STACK_SIZE`).
pub const DEFAULT_MAX_STACK_SIZE: usize = 100;

/// Undo/redo availability snapshot (TS `historyChange` payload parity).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryStatus {
    /// `true` when [`HistoryManager::undo`] would apply an entry.
    pub can_undo: bool,
    /// `true` when [`HistoryManager::redo`] would apply an entry.
    pub can_redo: bool,
}

/// Accumulator for an open transaction (TS `currentBatch` parity).
#[derive(Debug, Default)]
struct OpenTransaction {
    /// Merged per-id deltas (first-`before` wins, latest-`after` wins).
    updates: HashMap<ElementId, SlotDelta>,
    /// Z-order when the transaction opened.
    order_before: Vec<ElementId>,
}

/// Manages undo/redo stacks over recorded command entries.
///
/// All mutations reach the document through [`HistoryManager::execute`] (or
/// the transaction API); undo/redo apply recorded snapshots exactly, so
/// versions never drift across cycles.
pub struct HistoryManager {
    undo_stack: Vec<HistoryEntry>,
    redo_stack: Vec<HistoryEntry>,
    max_stack_size: usize,
    current: Option<OpenTransaction>,
    detached: bool,
}

impl HistoryManager {
    /// Creates a manager with the default capacity (100 entries).
    pub fn new() -> Self {
        Self::with_max_stack_size(DEFAULT_MAX_STACK_SIZE)
    }

    /// Creates a manager with an explicit undo-stack capacity.
    pub fn with_max_stack_size(max_stack_size: usize) -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            max_stack_size,
            current: None,
            detached: false,
        }
    }

    /// Returns `true` when an undo entry is available.
    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    /// Returns `true` when a redo entry is available.
    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Returns the undo/redo availability snapshot.
    pub fn status(&self) -> HistoryStatus {
        HistoryStatus {
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
        }
    }

    /// Number of undo entries (TS `getUndoStackSize` parity).
    pub fn undo_len(&self) -> usize {
        self.undo_stack.len()
    }

    /// Number of redo entries (TS `getRedoStackSize` parity).
    pub fn redo_len(&self) -> usize {
        self.redo_stack.len()
    }

    /// Returns `true` when a transaction is open.
    pub fn in_transaction(&self) -> bool {
        self.current.is_some()
    }

    /// Detaches the manager: the document still mutates through
    /// [`HistoryManager::execute`], but nothing is recorded anymore (TS
    /// `destroy` parity — it unsubscribes the observer while the scene stays
    /// usable). Stacks are kept.
    pub fn destroy(&mut self) {
        self.detached = true;
    }

    /// Executes a command against the document.
    ///
    /// When detached, the command still mutates the document but nothing is
    /// recorded; inside an open transaction, the command's deltas merge into
    /// the transaction (no push, no redo-clear yet); otherwise a non-empty
    /// entry clears the redo stack and is pushed (trimmed to capacity),
    /// while empty (no-op) commands record nothing and preserve the redo
    /// stack.
    ///
    /// A failing command rolls the document back to its pre-command content
    /// and records nothing.
    pub fn execute<C: Command>(
        &mut self,
        doc: &mut Document,
        mut command: C,
    ) -> EngineResult<CommandOutcome> {
        if self.detached {
            let mut ctx = CommandContext::fresh(doc);
            let outcome = command.execute(&mut ctx)?;
            // Discard the deltas: mutations stay, history does not grow.
            let _ = ctx.into_entry();
            return Ok(outcome);
        }
        if self.current.is_some() {
            // Transaction mode: run against a command-scoped context (its
            // `before` states are command-start states, so a failing command
            // rolls back only itself), then merge the deltas into the open
            // transaction with first-`before`-wins per id.
            let mut ctx = CommandContext::fresh(doc);
            match command.execute(&mut ctx) {
                Ok(outcome) => {
                    let entry = ctx.into_entry();
                    self.merge_entry(entry);
                    Ok(outcome)
                }
                Err(err) => {
                    ctx.rollback()?;
                    Err(err)
                }
            }
        } else {
            let mut ctx = CommandContext::fresh(doc);
            let result = command.execute(&mut ctx);
            match result {
                Ok(outcome) => {
                    let entry = ctx.into_entry();
                    if !entry.is_empty() {
                        self.clear_redo();
                        self.push_undo(entry);
                    }
                    Ok(outcome)
                }
                Err(err) => {
                    ctx.rollback()?;
                    Err(err)
                }
            }
        }
    }

    /// Opens a transaction: subsequent [`HistoryManager::execute`] calls
    /// merge into one entry (TS `startBatch` parity — one drag = one undo).
    /// Opening while already open is a silent no-op (TS parity).
    pub fn begin_transaction(&mut self, doc: &Document) {
        if self.current.is_some() {
            return;
        }
        self.current = Some(OpenTransaction {
            updates: HashMap::new(),
            order_before: doc.order(),
        });
    }

    /// Commits the open transaction as one entry (TS `endBatch` parity):
    /// non-empty entries clear the redo stack and are pushed; empty ones
    /// push nothing and preserve redo. No open transaction is a no-op.
    pub fn commit_transaction(&mut self, doc: &Document) {
        let Some(tx) = self.current.take() else {
            return;
        };
        let order_after = doc.order();
        let order_changed = order_after != tx.order_before;
        let entry = HistoryEntry {
            element_updates: tx.updates,
            order_before: order_changed.then_some(tx.order_before),
            order_after: order_changed.then_some(order_after),
        };
        if entry.is_empty() {
            return;
        }
        self.clear_redo();
        self.push_undo(entry);
    }

    /// Cancels the open transaction, rolling the document back to its
    /// pre-transaction content (gesture-cancellation primitive: Escape,
    /// `pointercancel`, or tool-switch mid-gesture). History stacks are
    /// untouched and the redo stack is preserved. No open transaction is a
    /// no-op.
    pub fn cancel_transaction(&mut self, doc: &mut Document) -> EngineResult<()> {
        let Some(tx) = self.current.take() else {
            return Ok(());
        };
        for (id, delta) in tx.updates {
            match delta.before {
                None => doc.hard_delete(id.as_str())?,
                Some(element) => doc.restore_exact(element)?,
            }
        }
        if doc.order() != tx.order_before {
            doc.set_order(tx.order_before)?;
        }
        Ok(())
    }

    /// Runs a closure inside a transaction: commit on `Ok`, rollback on
    /// `Err` (atomic grouped operation — the paste/import/style-batch
    /// seam). Fails when a transaction is already open (explicit
    /// `begin`/`commit` spans multi-event gestures instead).
    pub fn transaction<T>(
        &mut self,
        doc: &mut Document,
        run: impl FnOnce(&mut CommandContext) -> EngineResult<T>,
    ) -> EngineResult<T> {
        if self.current.is_some() {
            return Err(EngineError::InvalidInput(
                "transaction() cannot nest inside an open transaction; use execute() for gesture steps".to_string(),
            ));
        }
        if self.detached {
            let mut ctx = CommandContext::fresh(doc);
            return run(&mut ctx);
        }
        let mut ctx = CommandContext::fresh(doc);
        match run(&mut ctx) {
            Ok(value) => {
                let entry = ctx.into_entry();
                if !entry.is_empty() {
                    self.clear_redo();
                    self.push_undo(entry);
                }
                Ok(value)
            }
            Err(err) => {
                ctx.rollback()?;
                Err(err)
            }
        }
    }

    /// Undoes the last entry (TS `undo` parity): an open transaction is
    /// auto-committed first, then the entry's `before` side is applied
    /// exactly and the entry moves to the redo stack (trimmed to capacity).
    /// Returns `false` when no entry was available.
    pub fn undo(&mut self, doc: &mut Document) -> EngineResult<bool> {
        if self.current.is_some() {
            self.commit_transaction(doc);
        }
        let Some(entry) = self.undo_stack.pop() else {
            return Ok(false);
        };
        entry.apply(doc, HistorySide::Before)?;
        self.redo_stack.push(entry);
        Self::trim_stack(&mut self.redo_stack, self.max_stack_size);
        Ok(true)
    }

    /// Redoes the last undone entry (TS `redo` parity). Refused (`false`)
    /// while a transaction is open. The `after` side is applied exactly and
    /// the entry moves back to the undo stack.
    pub fn redo(&mut self, doc: &mut Document) -> EngineResult<bool> {
        if self.current.is_some() {
            return Ok(false);
        }
        let Some(entry) = self.redo_stack.pop() else {
            return Ok(false);
        };
        entry.apply(doc, HistorySide::After)?;
        self.undo_stack.push(entry);
        Self::trim_stack(&mut self.undo_stack, self.max_stack_size);
        Ok(true)
    }

    /// Clears the redo stack (new action after undo invalidates redo).
    pub fn clear_redo(&mut self) {
        self.redo_stack.clear();
    }

    /// Manually pushes a pre-built entry, clearing redo first (TS
    /// `recordEntry` parity: pushed unconditionally, even when empty — the
    /// caller owns the entry's meaning).
    pub fn record_entry(&mut self, entry: HistoryEntry) {
        self.clear_redo();
        self.push_undo(entry);
    }

    /// Merges a finished command's entry into the open transaction:
    /// earliest `before` wins per id, latest `after` wins. The entry's
    /// command-scoped order pair is discarded — the transaction compares its
    /// own `order_before` against the document at commit time.
    fn merge_entry(&mut self, entry: HistoryEntry) {
        let Some(tx) = self.current.as_mut() else {
            return;
        };
        for (id, delta) in entry.element_updates {
            match tx.updates.get_mut(&id) {
                Some(existing) => {
                    existing.after = delta.after;
                }
                None => {
                    tx.updates.insert(id, delta);
                }
            }
        }
    }

    /// Pushes an undo entry, trimming the oldest when over capacity (TS
    /// `trimStack` parity: `shift()` drops the oldest).
    fn push_undo(&mut self, entry: HistoryEntry) {
        self.undo_stack.push(entry);
        Self::trim_stack(&mut self.undo_stack, self.max_stack_size);
    }

    /// Drops the oldest entries while over capacity.
    fn trim_stack(stack: &mut Vec<HistoryEntry>, max: usize) {
        while stack.len() > max {
            stack.remove(0);
        }
    }
}

impl Default for HistoryManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{
        CreateElements, DeleteElements, MoveElements, Reorder, SetStyle, StylePatch,
    };
    use crate::element::{create_rectangle, CounterIdGenerator, Element};

    fn rectangle(id: &str, gen: &mut CounterIdGenerator) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        Element::Rectangle(rect)
    }

    fn stocked_doc() -> (Document, HistoryManager, CounterIdGenerator) {
        let gen = CounterIdGenerator::new();
        (Document::new(), HistoryManager::new(), gen)
    }

    #[test]
    fn undo_redo_create_round_trip() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        assert!(doc.contains("r1"));
        assert!(history.undo(&mut doc).unwrap());
        assert!(!doc.contains("r1"));
        assert!(history.redo(&mut doc).unwrap());
        assert!(doc.contains("r1"));
        assert_eq!(doc.get("r1").unwrap().base().x, 0.0);
    }

    #[test]
    fn batch_collapses_many_moves_into_one_undo() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        history.begin_transaction(&doc);
        for _ in 0..5 {
            history
                .execute(
                    &mut doc,
                    MoveElements::new(vec![ElementId::of("r1")], 1.0, 0.0),
                )
                .unwrap();
        }
        history.commit_transaction(&doc);
        assert_eq!(history.undo_len(), 2);
        assert_eq!(doc.get("r1").unwrap().base().x, 5.0);
        assert!(history.undo(&mut doc).unwrap());
        assert_eq!(doc.get("r1").unwrap().base().x, 0.0);
        assert_eq!(history.undo_len(), 1);
    }

    #[test]
    fn empty_transaction_pushes_nothing_and_preserves_redo() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        assert!(history.undo(&mut doc).unwrap());
        assert!(history.can_redo());
        history.begin_transaction(&doc);
        history.commit_transaction(&doc);
        assert_eq!(history.undo_len(), 0);
        assert!(history.can_redo(), "empty commit preserves redo");
    }

    #[test]
    fn undo_auto_commits_open_transaction() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        history.begin_transaction(&doc);
        history
            .execute(
                &mut doc,
                MoveElements::new(vec![ElementId::of("r1")], 10.0, 0.0),
            )
            .unwrap();
        assert!(history.undo(&mut doc).unwrap());
        assert_eq!(doc.get("r1").unwrap().base().x, 0.0);
        assert_eq!(history.undo_len(), 1);
    }

    #[test]
    fn redo_refused_while_transaction_open() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        assert!(history.undo(&mut doc).unwrap());
        history.begin_transaction(&doc);
        assert!(!history.redo(&mut doc).unwrap());
        history.cancel_transaction(&mut doc).unwrap();
        assert!(history.redo(&mut doc).unwrap());
    }

    #[test]
    fn new_mutation_clears_redo() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        history
            .execute(
                &mut doc,
                MoveElements::new(vec![ElementId::of("r1")], 10.0, 0.0),
            )
            .unwrap();
        assert!(history.undo(&mut doc).unwrap());
        assert!(history.can_redo());
        history
            .execute(
                &mut doc,
                MoveElements::new(vec![ElementId::of("r1")], 20.0, 0.0),
            )
            .unwrap();
        assert!(!history.can_redo());
    }

    #[test]
    fn stack_limit_drops_oldest() {
        let mut doc = Document::new();
        let mut gen = CounterIdGenerator::new();
        let mut history = HistoryManager::with_max_stack_size(3);
        for i in 0..5 {
            history
                .execute(
                    &mut doc,
                    CreateElements::new(vec![rectangle(&format!("r{i}"), &mut gen)]),
                )
                .unwrap();
        }
        assert_eq!(history.undo_len(), 3);
    }

    #[test]
    fn destroy_keeps_mutating_without_recording() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        history.destroy();
        history
            .execute(
                &mut doc,
                MoveElements::new(vec![ElementId::of("r1")], 10.0, 0.0),
            )
            .unwrap();
        assert_eq!(doc.get("r1").unwrap().base().x, 10.0);
        assert_eq!(history.undo_len(), 1);
    }

    #[test]
    fn versions_do_not_drift_across_undo_redo_cycles() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        history
            .execute(
                &mut doc,
                SetStyle::new(
                    vec![ElementId::of("r1")],
                    StylePatch {
                        stroke_color: Some("#ff0000".to_string()),
                        ..StylePatch::default()
                    },
                ),
            )
            .unwrap();
        let version = doc.get("r1").unwrap().base().version;
        let nonce = doc.get("r1").unwrap().base().version_nonce;
        for _ in 0..3 {
            assert!(history.undo(&mut doc).unwrap());
            assert_eq!(doc.get("r1").unwrap().base().stroke_color, "#000000");
            assert!(history.redo(&mut doc).unwrap());
            assert_eq!(doc.get("r1").unwrap().base().stroke_color, "#ff0000");
            assert_eq!(doc.get("r1").unwrap().base().version, version);
            assert_eq!(doc.get("r1").unwrap().base().version_nonce, nonce);
        }
    }

    #[test]
    fn delete_undo_restores_visibility() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("r1", &mut gen)]),
            )
            .unwrap();
        history
            .execute(&mut doc, DeleteElements::new(vec![ElementId::of("r1")]))
            .unwrap();
        assert!(doc.get("r1").unwrap().base().is_deleted);
        assert!(history.undo(&mut doc).unwrap());
        assert!(!doc.get("r1").unwrap().base().is_deleted);
    }

    #[test]
    fn reorder_undo_redo_restores_order() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        for id in ["a", "b", "c"] {
            history
                .execute(&mut doc, CreateElements::new(vec![rectangle(id, &mut gen)]))
                .unwrap();
        }
        let before = doc.order();
        let rotated = vec![ElementId::of("b"), ElementId::of("c"), ElementId::of("a")];
        history
            .execute(&mut doc, Reorder::new(rotated.clone()))
            .unwrap();
        assert_eq!(doc.order(), rotated);
        assert!(history.undo(&mut doc).unwrap());
        assert_eq!(doc.order(), before);
        assert!(history.redo(&mut doc).unwrap());
        assert_eq!(doc.order(), rotated);
    }

    #[test]
    fn create_undo_redo_preserves_order_slot() {
        let (mut doc, mut history, mut gen) = stocked_doc();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("a", &mut gen)]),
            )
            .unwrap();
        history
            .execute(
                &mut doc,
                CreateElements::new(vec![rectangle("b", &mut gen)]),
            )
            .unwrap();
        let order_before = doc.order();
        assert!(history.undo(&mut doc).unwrap());
        assert!(doc.get("b").is_none());
        assert!(history.redo(&mut doc).unwrap());
        assert_eq!(doc.get("b").unwrap().id().as_str(), "b");
        assert_eq!(doc.order(), order_before);
    }
}
