# Contributing to OpenNary

Thank you for your interest in contributing!

## Development setup

Canonical commands live in [`DEVELOPMENT.md`](./DEVELOPMENT.md) — do not
duplicate them here.

```bash
git clone https://github.com/fazelstudio/opennary.git
cd opennary
bun install   # desktop demo dependencies only
```

Then follow `DEVELOPMENT.md`: `cargo test --workspace`,
`cargo clippy --workspace --all-targets -- -D warnings`,
`cargo fmt --all`, `cargo build --workspace`.

## Project Structure

Short map (details in [`crates/README.md`](./crates/README.md)):

- `crates/opennary-geometry/` — Pure 2D math (zero dependencies)
- `crates/opennary-core/` — Document domain + editor session
- `crates/opennary-io/` — Interchange (JSON schema, import pipeline, clipboard codec, PNG descriptors)
- `crates/opennary-bindings/` — Host boundary (JSON-string batch protocol, `Engine` facade, DTOs)
- `crates/opennary/` — npm distribution (`@fazelstudio/opennary`)
- `crates/opennary-python/` — PyPI distribution (`opennary`)
- `crates/opennary-sdk/` — Rust SDK facade for extensions
- `crates/opennary-text/` — Text measurement and shaping helpers
- `apps/desktop/` — Tauri demo app (the reference host)
- `packages/opennary-sdk/` — TypeScript SDK (typed client, extension registry)
- `examples/` — Standalone usage and extension examples
- `docs/` — Product scope, technical contract, and guides (`docs/guides/`)

Dependency direction: `opennary`/`opennary-python` → `opennary-bindings` → `opennary-io` → `opennary-core` → `opennary-geometry`.

## Rules

1. Engine crates must remain framework-agnostic (no React/Vue/DOM/Canvas/Tauri).
2. All mutations go through `Document` (the sole version/nonce authority) as one undoable `Command` via `HistoryManager`.
3. Run the checks in [`DEVELOPMENT.md`](./DEVELOPMENT.md) before submitting PRs.
4. Follow existing code conventions (data-oriented, elements as plain data, behavior in separate functions).
5. Every public item needs a short Rustdoc (1-2 lines).

See [`DEVELOPMENT.md`](./DEVELOPMENT.md#publishing) for release publishing.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
