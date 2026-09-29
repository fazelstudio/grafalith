//! Bulk style operations (persistent style data only).
//!
//! TS source: `packages/core/src/scene/style-actions.ts` (bulk set +
//! mixed-state readers for UI).
//!
//! Target (Phase 02/05): persistent style (fill, stroke, opacity, font,
//! line width) strictly separated from transient UI state (hovered,
//! selected, editing, dragging), which must never serialize (module 04).
//! Mixed-state readers are UI helpers and may move to the adapter layer.
