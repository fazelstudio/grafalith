//! Component masters, instances, overrides, and resolve cache.
//!
//! TS sources: `packages/core/src/components/component-registry.ts`
//! (master registry + `defaultComponentRegistry` singleton),
//! `instance-sync.ts` (version-keyed `InstanceResolveCache`),
//! `component-actions.ts` (create/override/reset/detach/materialize).
//!
//! Target (Phase 09; domain part in Phase 02): instance-scoped registry,
//! detach-as-materialize semantics, cache with explicit owner +
//! invalidation + tests. Per-instance vs. global is decided in
//! ADR-0003 (instance-scoped).
