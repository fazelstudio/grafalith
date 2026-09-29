//! Commands, transactions, and undo/redo history.
//!
//! TS source: `packages/core/src/history/history-manager.ts`
//! (`maxStackSize = 100`; batch collapse so one gesture = one entry;
//! order snapshots; redo-clear on new mutation; `destroy` unsubscribe).
//!
//! Target (Phase 03): an explicit `Command` trait (`execute`/`undo` over a
//! `CommandContext`, atomic failure with `before == after`), history stacks
//! over commands/deltas, transaction batching for drag/resize/rotate/
//! import/paste/style-batch, and events-as-notifications (never a second
//! source of truth). See module 05 and ADR-0002.
