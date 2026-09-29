# ADR-0001 — Rust Workspace Location

**Status:** Accepted (Phase 01, 2026-09-29)
**Branch:** `rewrite/rust-core`

## Context

The repository is a Bun monorepo (`workspaces: ["packages/*"]`) with
`packages/core` (TS engine) and `packages/react` (adapter). The Rust rewrite
needs a Cargo workspace that coexists with Bun without disturbing JS
tooling, CI, or packaging. Module 03 requires a root `Cargo.toml`
workspace; the discovery report (§G.1) listed `rust/` and
`packages/core-rs/` as alternatives.

## Problem

Where should the Cargo workspace live so that `cargo` and `bun` never
interfere, now and as `crates/*` grows toward WASM/Tauri targets?

## Options

1. **Root `Cargo.toml` + `crates/*`** (chosen): one workspace at the repo
   root, members limited to `crates/*`.
2. **`rust/` sub-workspace**: keeps the root "JS-clean" but adds a second
   root to navigate and complicates future Tauri layout (Tauri expects
   `src-tauri/` conventions, not a nested workspace).
3. **`packages/core-rs/`**: pretends Rust is another Bun package; Bun would
   try to manage it as a workspace member and `cargo` metadata would pollute
   npm packaging semantics.

## Decision

Option 1. Root `Cargo.toml` declares `members = ["crates/*"]` only, so:

- Bun workspaces (`packages/*`) and Cargo members (`crates/*`) are
  disjoint by construction;
- `cargo` ignores `node_modules/`; `bun` ignores `Cargo.toml`/`crates/`;
- existing CI (Bun-only jobs) is unaffected; a Rust job is additive.

## Consequences

- `target/` is gitignored at root; `Cargo.lock` is committed for
  deterministic builds.
- Future crates (`fazelidraw-editor`, `fazelidraw-io`, `fazelidraw-wasm`,
  `fazelidraw-tauri`, …) land under `crates/` without workspace changes.
- If a future host (e.g. Tauri app scaffolding) demands its own nested
  workspace, that decision gets its own ADR; this ADR does not pre-empt it.

## Rejected alternatives

- `rust/`: extra nesting with no tooling benefit; defers rather than
  solves host-layout questions.
- `packages/core-rs/`: mixes Bun and Cargo ownership of one directory;
  risks `bun install` touching Rust files and npm `files` including them.
