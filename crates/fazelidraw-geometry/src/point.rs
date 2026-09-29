//! Points and vectors.
//!
//! TS source: `Point = [number, number]` in `packages/core/src/scene/types.ts`
//! (consumed by `packages/core/src/shapes/geometry.ts`).
//!
//! Target (Phase 04): explicit point/vector newtypes with an explicit float
//! tolerance const for comparisons (never bare `==` on floats, never string
//! equality). See module 12 (floating point) and ADR-0005.
