//! Clipboard payload semantics (pure) — host owns the OS clipboard.
//!
//! TS source: `packages/core/src/interaction/clipboard.ts` (internal
//! buffer + best-effort `navigator.clipboard`; fresh ids + group/binding/
//! frame remap; cascade `PASTE_OFFSET = 10 × consecutive count`; single
//! history batch; pasted elements unlocked — all pinned by
//! `clipboard.test.ts`).
//!
//! Target (Phase 06): pure payload type + remap algorithm over an
//! instance-scoped buffer (the TS module globals `clipboardBuffer` /
//! `consecutivePasteCount` must not survive as globals — ADR-0003).
//! System integration goes through a `ClipboardAdapter` trait outside core.
