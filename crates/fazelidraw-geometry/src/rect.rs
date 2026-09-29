//! Axis-aligned and rotated bounds.
//!
//! TS sources: `Bounds`, `getRotatedBounds`, `distToSegment` in
//! `packages/core/src/shapes/geometry.ts`; per-shape `getBounds`/
//! `getElementBounds` in `packages/core/src/shapes/*.ts`.
//!
//! Target (Phase 04): one bounds owner used by culling, hit-testing, and
//! snapping alike (no duplicated geometry math between interaction and
//! rendering). Rotation-aware bounds are contract (module 06).
