//! Shape registry (instance-scoped).
//!
//! TS source: `packages/core/src/shapes/registry.ts` (`ShapeDefinition` +
//! `ShapeRegistry` + `defaultShapeRegistry` singleton + `registerShape`;
//! built-ins self-register on import in `builtin-shapes.ts`).
//!
//! Target (Phase 02, extended Phase 09): the registry is owned by the
//! document/session instance — never a process-global singleton — so
//! multi-instance and WASM hosts stay isolated (discovery §F.1). Rust uses
//! an explicit `register_builtin_shapes(&mut registry)` call instead of
//! import side-effects. Retaining any global requires an ADR (module 10).
//! See `docs/architecture/ADR-0003-instance-scoped-state.md`.
