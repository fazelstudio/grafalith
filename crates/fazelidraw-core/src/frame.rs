//! Frame containment and child operations.
//!
//! TS source: `packages/core/src/scene/frame-actions.ts` (AABB containment,
//! child move/release, `DEFAULT_CONSTRAINTS`). Frame clipping itself is a
//! render-loop pass, not document state.
//!
//! Target (Phase 02, with constraints/auto-layout consumers in Phase 05).
