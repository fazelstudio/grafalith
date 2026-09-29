# ADR-0005 — Dependency Policy

**Status:** Accepted (Phase 01, 2026-09-29)
**Branch:** `rewrite/rust-core`

## Context

The TS core holds **zero runtime dependencies** (`packages/core/package.json`
has only `typescript` as a devDependency) — a deliberate product property
(PRD §1: lightweight, < 150 KB gzipped core). Module 03 demands every Rust
dependency carry a documented reason (purpose, license, WASM/native
compat, maintenance risk). Module 13 forbids `unsafe` by default and
speculative optimization.

## Problem

Which dependencies may the Rust workspace take, and under what process?

## Options

1. **Zero-dependency core + allowlist-by-ADR** (chosen): Phase 01 ships
   with no external dependencies at all (verified by `cargo tree`);
   each future dependency needs purpose/license/WASM-compat justification
   in its phase report, and heavy ones need an ADR.
2. **Batteries-included now** (serde, uuid, tokio, glam, …): pays
   compile-time, audit, and bundle-size costs before any consumer exists.
3. **Case-by-case without record**: drifts back to accidental weight —
   exactly how JS bundles rot.

## Decision

Option 1. Standing rules:

- `fazelidraw-geometry` and `fazelidraw-core` stay dependency-free until a
  phase proves otherwise. No async runtime, no ECS, no geometry library in
  core without a bundle-size analysis ADR (cf. AGENTS.md v4 restraint on
  computational-geometry deps).
- Pre-approved (still justified at adoption time, not auto-added):
  `serde`/`serde_json` for `fazelidraw-io` (Phase 06); `wasm-bindgen` for
  `fazelidraw-wasm` (Phase 07); `criterion` + `proptest` as dev-dependencies
  for benches/property tests (Phase 04+).
- `unsafe` is prohibited by default; any use needs why/scope/invariants/
  tests/benchmarks per module 13.
- Feature flags only for real axes (`serde`, host targets); never for
  trivial internal behavior.
- License compatibility (MIT-compatible) is checked at adoption, not
  assumed.

## Consequences

- `cargo tree --workspace` remains a one-glance audit; CI can gate on
  dependency count if desired later.
- WASM compatibility stays trivially true while the tree is empty; each
  new dep must state its `wasm32` story.
- Reviewers reject drive-by dependencies the same way they reject drive-by
  features: classify need first (PARITY / ARCHITECTURE / FUTURE).

## Rejected alternatives

- Batteries-included: rejected — unproven weight against a lightweight
  product promise.
- Unrecorded adoption: rejected — invisible supply-chain and bundle drift.
