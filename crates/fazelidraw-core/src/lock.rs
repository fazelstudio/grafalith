//! Lock / unlock operations.
//!
//! TS source: `packages/core/src/scene/lock-actions.ts`.
//!
//! Locked is a mutation guard, not a UI hint: locked elements are skipped
//! by move/resize/rotate/delete paths. Target: Phase 02.
