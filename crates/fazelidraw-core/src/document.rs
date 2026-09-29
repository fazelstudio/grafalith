//! Document store: id map + explicit z-order + version/nonce authority.
//!
//! TS source: `packages/core/src/scene/scene.ts` (`Map<id, Element>` +
//! `elementOrder: string[]` + `sceneNonce`; `upsertElement` as the single
//! authoritative mutation path with clone-isolation; soft-delete;
//! `onMutation` / `onAfterUpsert` fan-out; owned `SpatialGrid`).
//!
//! Target (Phase 02): `Document` owns elements, order, the nonce/version
//! counter (exactly one owner — no competing counters), the spatial index,
//! and the instance-scoped registries. Controlled mutation only, via
//! document/command APIs that uphold the module-04 invariants
//! (unique ids, valid references, finite transforms, no NaN/Infinity).
