//! Canvas mode: infinite vs. bounded (pure config).
//!
//! TS source: `packages/core/src/render/canvas-mode.ts` (`CanvasMode` +
//! `DEFAULT_CANVAS_MODE`; immutable after editor init — pinned by
//! `editor/canvas-mode.test.ts`).
//!
//! Target (Phase 02): mode as plain config data. Bounded-mode painting
//! (dim-outside, border) belongs to the render model (Phase 04+), not here.
