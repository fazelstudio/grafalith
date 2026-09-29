//! Grid spatial hash for culling and hit-testing.
//!
//! TS source: `packages/core/src/spatial/spatial-grid.ts`
//! (`cellSize = 200` scene units; owned by the `Scene` instance, not global).
//!
//! Target (Phase 04): instance-scoped index with explicit owner and
//! invalidation rules, plus a `criterion` bench harness re-measuring the TS
//! claims (5k-element cull/hit) instead of inheriting them (module 13).
