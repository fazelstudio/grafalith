# Development Guide — Grafalith

Canonical reference for building, testing, and publishing Grafalith.
`README.md` links here for anything beyond install + quick start;
`CONTRIBUTING.md` links here for commands; `AGENTS.md` §7 is a quick
summary of this file.

Related: [`README.md`](./README.md) (project overview) ·
[`CONTRIBUTING.md`](./CONTRIBUTING.md) (workflow) ·
[`crates/README.md`](./crates/README.md) (module map) ·
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) (technical contract) ·
[`docs/PRD.md`](./docs/PRD.md) (scope).

## Prerequisites

- Rust toolchain (see `rust-toolchain.toml` if present, else stable).
- [Bun](https://bun.sh/) — workspace scripts and the Tauri desktop demo.
- `wasm-pack` — only for the npm/WASM artifact.
- `maturin` + `twine` — only for the PyPI artifact.
- Tauri system dependencies — only for `apps/desktop`
  (see [Tauri prerequisites](https://tauri.app/start/prerequisites)).

## Setup

```bash
git clone https://github.com/fazelstudio/grafalith.git
cd grafalith

# Desktop demo dependencies only (engine needs no JS install)
bun install
```

## Standard checks (CI gate)

Run the relevant checks for your change before opening a PR:

```bash
# Tests
cargo test --workspace

# Lint — must pass with zero warnings
cargo clippy --workspace --all-targets -- -D warnings

# Format + format check
cargo fmt --all
cargo fmt --all -- --check

# Build
cargo build --workspace
cargo build --workspace --release
```

JS-side checks apply only to `apps/desktop` and tooling:

```bash
bun run lint
bun run i18n:verify   # locale key parity (desktop)
bun run verify:docs   # no stale links, guides indexed
bun run verify:bindings  # generated bindings match scripts/gen_command_bindings.py
```

## Fuzzing (optional, nightly only)

Short libFuzzer runs over hostile parser inputs. Not part of the PR gate —
CI runs them weekly via `fuzz.yml` (also manually from the Actions tab).
Deterministic equivalents run in every `cargo test` (`adversarial_parsers`).

```bash
cargo install cargo-fuzz
cd crates/grafalith-io/fuzz
cargo +nightly fuzz run import_scene -- -max_total_time=120
cargo +nightly fuzz run clipboard -- -max_total_time=60
```

## Artifacts

### npm / WASM (`@fazelstudio/grafalith`)

Requires `wasm-pack`. Source of truth: `crates/grafalith/`
(see [`crates/grafalith/README.md`](./crates/grafalith/README.md)).

```bash
# Browser bundler target (out: pkg/bundler)
bun run build:wasm

# Node.js target (out: pkg/node)
bun run build:wasm:node
```

### Python / PyPI (`grafalith`)

Requires `maturin`. Source of truth: `crates/grafalith-python/`
(see [`crates/grafalith-python/README.md`](./crates/grafalith-python/README.md)).

```bash
# Dev install into the active venv (fast iteration)
bun run dev:python

# Release wheel
bun run build:python
```

Native Rust tests for the Python converters run inside
`cargo test --workspace` (they link the system interpreter).
maturin enables the `extension-module` feature for wheels automatically,
so never pass it to plain `cargo` commands.

### Desktop demo (Tauri reference host)

```bash
bun run tauri:dev
bun run tauri:build
```

## Publishing

### npm (`@fazelstudio/grafalith`)

```bash
bun run build:wasm
cd pkg/bundler && npm publish
```

### PyPI (`grafalith`)

PyPI has no scope concept — the name is flat and globally unique
(`grafalith`); branding is carried by the GitHub org links in
`crates/grafalith-python/pyproject.toml` plus PyPI's org verification badge.

First-time checklist:

1. Create a PyPI account and enable 2FA (required for API tokens).
2. Create an API token at pypi.org → Account Settings → API tokens.
3. Test on TestPyPI first:

   ```bash
   maturin build --release
   twine upload --repository testpypi dist/*
   pip install --index-url https://test.pypi.org/simple/ grafalith
   ```

4. Publish:

   ```bash
   maturin build --release
   twine upload dist/*
   ```

Keep `crates/grafalith-python/pyproject.toml` (`[project].version`) and
`crates/grafalith-python/Cargo.toml` in lockstep when bumping versions.

### crates.io (`grafalith-*`)

crates.io is the Rust registry, the same role npm plays for JavaScript and
PyPI for Python: global unique names, first-come-first-served, and versions
that cannot be deleted once published (yanking only stops new adoption).

The Rust-facing packages are the six engine crates, in dependency order —
each one must be published after its internal dependencies already exist:

```bash
cargo login                      # once per machine
cargo publish -p grafalith-geometry
cargo publish -p grafalith-core
cargo publish -p grafalith-io
cargo publish -p grafalith-bindings
cargo publish -p grafalith-sdk
cargo publish -p grafalith-text
```

`cargo publish -p <crate>` verifies the manifest, checks that every internal
dependency is already on crates.io with a matching version, then uploads —
which is why the order above is not optional.

Not every workspace member is publishable. `publish = false` marks the four
crates that are build artifacts or hosts rather than libraries
(`grafalith` wasm cdylib, `grafalith-py` PyO3 module, `grafalith-desktop`
Tauri app, `ext-sticker` example); see the distribution table in
[`crates/README.md`](crates/README.md#distribution-channels).

Current status: the crates are publish-ready (`cargo package --list` is clean
and registry metadata is complete) but **no version has been published yet**.
Publish the first version when the engine API surface is ready to be
consumed — the crates.io names are still unclaimed, and
`bun run verify:packages` re-checks readiness on every CI run.

## Troubleshooting

- `wasm-pack` fails on Windows: retry with release profile
  (`wasm-opt = true` only for publishes, see `crates/grafalith/Cargo.toml`).
- `cargo check -p grafalith-python` is the fallback when no Python
  interpreter is configured.
- `bun run clean` removes build outputs and caches (`node_modules`,
  `target`, `pkg`, `dist`, wheels, `__pycache__`, `.venv`, coverage)
  to reclaim disk — everything it deletes is regenerated by the commands above.
  The cleanup uses rimraf through a Node script so wildcard targets work on
  Windows. The root `node_modules` directory is removed by a short-lived
  follow-up process after rimraf itself has exited.
