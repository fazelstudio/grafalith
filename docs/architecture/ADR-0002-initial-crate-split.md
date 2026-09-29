# ADR-0002 — Initial Crate Split

**Status:** Accepted (Phase 01, 2026-09-29)
**Branch:** `rewrite/rust-core`

## Context

Module 02 sketches an end-state with up to eight crates
(`fazelidraw-core`, `-geometry`, `-render`, `-editor`, `-bindings`, …) but
warns: *"Agent tidak boleh membuat banyak crate hanya karena modular. Start
with the smallest stable boundaries and split only where
dependency/lifecycle/public API justify it."* Phase 01 must establish the
workspace plus the first library crate(s) without porting engine logic.

## Problem

Which crates exist on day one, and what rule governs adding more?

## Options

1. **Two crates now: `fazelidraw-geometry` + `fazelidraw-core`** (chosen):
   the only boundary already justified by evidence — pure math vs. document
   domain — with the dependency direction core → geometry.
2. **Single `fazelidraw` crate**: simpler today, but invites the giant-module
   sprawl the rewrite exists to escape (cf. the 1861-line TS `Editor`).
3. **Full end-state split now** (geometry, core, render-model, editor, io,
   wasm, …): premature; empty crates with no lifecycle justification,
   against module 02.

## Decision

Option 1. Phase 01 creates:

- `crates/fazelidraw-geometry/` — pure math, zero dependencies;
- `crates/fazelidraw-core/` — document domain, depends on geometry only.

Both contain documented module skeletons (TS-source mapping in each
module's docs) plus the shared error type; no behavior is ported yet.
Planned later crates and their owning phases:

| Crate | Phase | Justification trigger |
|---|---|---|
| `fazelidraw-render-model` | 04 | pure draw-list vs. host canvas split |
| `fazelidraw-editor` | 03/05 | session/gesture state vs. document state |
| `fazelidraw-io` | 06 | serde envelope + staged import pipeline |
| `fazelidraw-wasm` / `-napi` | 07 | host boundary with its own deps (wasm-bindgen/napi-rs) |
| `fazelidraw-tauri` | 09 | native app layer |

A new crate is added only when a distinct dependency direction, lifecycle,
or public-API boundary requires it — never for symmetry.

## Consequences

- `cargo tree` audit stays trivially reviewable while the workspace is
  small; every new crate must keep it that way.
- `pub` / `pub(crate)` discipline applies from day one (module 03 §7):
  `pub` only for intended boundaries.
- Splitting a crate later is a refactoring with an ADR note, not a
  rewrite — module paths are already namespaced by responsibility.

## Rejected alternatives

- Single crate: rejected — no forcing function against a new god-module.
- Full split now: rejected — speculative boundaries rot; each unjustified
  crate is API surface to maintain before any consumer exists.
