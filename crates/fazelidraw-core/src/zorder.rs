//! Z-order operations (domain state, undoable, serialized).
//!
//! TS source: `packages/core/src/scene/layer-actions.ts`
//! (`bringToFront` / `sendToBack` / `bringForward` / `sendBackward` via
//! `setElementOrder`, so order deltas flow to history).
//!
//! Target (Phase 02): pure order operations over the document's explicit
//! order vector. Render order and hit-test order must agree (top-wins).
