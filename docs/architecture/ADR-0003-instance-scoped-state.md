# ADR-0003 — Instance-Scoped State, No Globals

**Status:** Accepted (Phase 01, 2026-09-29)
**Branch:** `rewrite/rust-core`

## Context

The TS engine carries process-global mutable state: `defaultShapeRegistry`,
`defaultComponentRegistry`, module-global `clipboardBuffer` /
`consecutivePasteCount`, and built-in shape self-registration on import.
ARCHITECTURE §9.2 promises multi-instance safety (two canvases, different
configs, one page) via explicitly passed config — the globals contradict
that promise (discovery report §F.1). Modules 01 §B and 10 require
instance-scoped registries by default.

## Problem

May the Rust engine retain any global registry or buffer for convenience?

## Options

1. **Instance-scoped, no globals** (chosen): `Document`/session owns the
   shape registry, component registry, clipboard buffer, and spatial index.
   Registration is explicit (`register_builtin_shapes(&mut registry)`),
   never an import side-effect.
2. **Globals with interior mutability** (`OnceLock<Mutex<…>>`): mirrors TS
   most mechanically, but reintroduces cross-instance leakage, test
   pollution, and WASM-host hazards for zero benefit.
3. **Hybrid** (global defaults + per-instance overrides): the worst of both
   — two truth sources for "which shape set is active".

## Decision

Option 1, unconditionally. There is no grandfathered global: clipboard
buffer state, paste-cascade counters, registries, and caches are fields of
the owning instance. If a future extension (e.g. a JS-visible plugin slot)
genuinely needs process-wide state, it requires a new ADR with isolation
and cleanup analysis — module 10 mandates it.

## Consequences

- Deterministic tests: id generators and registries are injectable per
  instance (counters in tests, uuid-like sources in production).
- WASM/Tauri hosts can run multiple engine instances without interference.
- Porting Phases 02–06 must convert each TS global into an owned field;
  any port that reaches for `static mut` / global `Mutex` fails review.
- TS `registerShape()` global-registry semantics become an explicit
  **intentional difference** documented at the binding layer (Phase 07),
  not a silent behavior drift.

## Rejected alternatives

- Global singletons: rejected — convenience does not outweigh instance
  isolation, the documented product promise.
- Hybrid defaults: rejected — ambiguity about which registry answers a
  query is exactly the dual-truth class module 05 forbids.
