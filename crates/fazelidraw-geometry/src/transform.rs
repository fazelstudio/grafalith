//! Translation / rotation / scale representation.
//!
//! TS sources: `x/y/width/height/rotation` on `BaseElement`
//! (`packages/core/src/scene/types.ts`); resize/rotate math in
//! `packages/core/src/interaction/transform.ts`.
//!
//! Target (Phase 04): one mathematically explicit transform model
//! (translation, rotation, dimensions, origin/anchor) shared by move, resize
//! (opposite-anchor, flip, aspect-lock, min `>= 1`), rotate (shift-snap
//! `PI/12`), and rendering. NaN/Infinity must never enter persistent state
//! (module 04 invariants).
