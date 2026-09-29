//! Arrow endpoint binding (perimeter focus + follow-on-move).
//!
//! TS source: `packages/core/src/interaction/arrow-binding.ts`
//! (`BINDING_THRESHOLD = 20`; focus `[0, 1)` wrap; attachment inverse;
//! gap — pinned by `arrow-binding.test.ts`).
//!
//! Target (Phase 05): exact port of the focus math; follow-on-move routed
//! through commands, not hidden `afterUpsert` side paths.
