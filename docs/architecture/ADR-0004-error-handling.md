# ADR-0004 — Typed Errors, No Panics for Domain Failures

**Status:** Accepted (Phase 01, 2026-09-29)
**Branch:** `rewrite/rust-core`

## Context

Module 01 §F: *"Jangan menggunakan panic untuk expected user/domain
errors. Gunakan typed error/result … Panic hanya untuk invariant yang
benar-benar must-never-fail."* The TS engine signals failures
inconsistently (throws for unknown shape types, silent skips with counts
for invalid import elements, `NaN` throws with count 0). The Rust port must
unify this behind one handling story before domain logic lands.

## Problem

What is the single error-handling contract every Rust phase follows?

## Options

1. **`Result<T, EngineError>` everywhere fallible** (chosen): one
   `#[non_exhaustive]` enum in `fazelidraw-core::error`, with an
   `EngineResult<T>` alias; `panic!` only for must-never-fail invariants
   and never across FFI.
2. **Per-crate error enums from day one**: more precise, but the domain
   variants are unknown until Phases 02–06; premature precision would churn.
3. **`anyhow`-style erased errors**: convenient for applications, wrong for
   an engine library whose hosts (WASM/TS facade, Tauri commands) must
   match on error kinds to produce user-facing messages.

## Decision

Option 1. Phase 01 establishes `EngineError::{InvalidInput, NotFound,
InvariantViolation}` as the seed; later phases extend the enum (it is
`#[non_exhaustive`, so match sites already carry wildcard arms).
Additional rules:

- Multi-step commands that fail leave `before == after` unless partial
  mutation is an explicit, tested part of the contract (module 05).
- Invalid import input must never partially corrupt the document; failure
  paths are tested with `count 0` semantics mirroring the TS atomicity
  tests (Phase 06).
- No `unwrap()`/`expect()` on expected-failure paths; `expect()` is
  allowed only with a message on true invariants, and clippy/review may
  still challenge it.

## Consequences

- Host boundaries (Phase 07 WASM, Phase 09 Tauri) map `EngineError`
  variants to transport errors explicitly; no Rust panic ever crosses FFI.
- Every new fallible API returns `EngineResult`; reviewers reject
  `Option`-swallowing or stringly-typed errors.
- TS `throw` sites map to variants case-by-case during porting; each
  mapping is recorded in its phase report (EXPECTED vs. INTENTIONAL-BREAK
  classification per module 15).

## Rejected alternatives

- Per-crate enums now: rejected as premature — split when a crate's error
  taxonomy is actually known (likely `fazelidraw-io` in Phase 06).
- Erased errors: rejected — hosts need matchable kinds, not messages.
