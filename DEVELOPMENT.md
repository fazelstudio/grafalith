# Development Guide — Grafalith

Canonical guide for local setup, build, test, lint, and development checks. Release and publication steps belong in [`RELEASING.md`](./RELEASING.md).

Related references: [README](./README.md) · [Architecture](./docs/ARCHITECTURE.md) · [PRD](./docs/PRD.md) · [Crate map](./crates/README.md).

## Prerequisites

- Rust toolchain: use `rust-toolchain.toml` if present; otherwise use the toolchain required by the workspace.
- [Bun](https://bun.sh/) for desktop dependencies and workspace scripts.
- `wasm-pack` only when building the npm/WASM package.
- `maturin` and `twine` only for Python distribution workflows.
- Tauri system dependencies only for `apps/desktop` (see the [Tauri prerequisites](https://tauri.app/start/prerequisites)).

## Setup

```bash
git clone https://github.com/fazelstudio/grafalith.git
cd grafalith
bun install
```

`bun install` is needed for the desktop application and repository tooling; Rust-only engine work should use Cargo directly where possible.

## Standard Rust checks

Run the relevant checks for the changed crates. Use the workspace-wide checks before a release or when changes cross crate boundaries.

```bash
cargo fmt --all
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo check --workspace
cargo build --workspace
cargo build --workspace --release
```

## Desktop and repository tooling

Run scripts from the workspace root:

```bash
bun run lint
bun run i18n:verify
bun run verify:docs
bun run verify:bindings
bun run tauri:dev
bun run tauri:build
```

Run `i18n:verify` for locale changes and `verify:bindings` for protocol or generated-binding changes. Use the package scripts as the source of truth if a script is renamed or removed.

## WASM package

Requires `wasm-pack`.

```bash
bun run build:wasm
bun run build:wasm:node
```

The source lives in `crates/grafalith/`; see that crate's README for target-specific details.

## Python package

Requires a compatible Python toolchain and `maturin`.

```bash
bun run dev:python
bun run build:python
```

The Python wrapper lives in `crates/grafalith-python/`. Use the crate manifest as the source of truth for the Cargo package name and version. Native Python-linked tests may require a configured Python interpreter.

## Optional fuzzing

Fuzzing requires nightly Rust and `cargo-fuzz`; it is additional validation rather than a replacement for deterministic tests.

```bash
cargo install cargo-fuzz
cd crates/grafalith-io/fuzz
cargo +nightly fuzz run import_scene -- -max_total_time=120
cargo +nightly fuzz run clipboard -- -max_total_time=60
```

## Troubleshooting

- If a WASM optimization step fails, check the target and release settings in `crates/grafalith/Cargo.toml` before changing build configuration.
- If Python-linked Cargo checks fail because no interpreter is configured, use the documented fallback in the Python crate guide and report the limitation.
- `bun run clean` removes generated build outputs and caches. Confirm the script's current targets before running it if you have local artifacts you need to preserve.
