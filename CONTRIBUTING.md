# Contributing to Grafalith

Thank you for your interest in contributing!

## Development setup

Canonical commands live in [`DEVELOPMENT.md`](./DEVELOPMENT.md) — do not
duplicate them here.

```bash
git clone https://github.com/fazelstudio/grafalith.git
cd grafalith
bun install   # desktop demo dependencies only
```

Then follow `DEVELOPMENT.md`: `cargo test --workspace`,
`cargo clippy --workspace --all-targets -- -D warnings`,
`cargo fmt --all`, `cargo build --workspace`.

## Project Structure

Short map (details in [`crates/README.md`](./crates/README.md)):

- `crates/grafalith-geometry/` — Pure 2D math (zero dependencies)
- `crates/grafalith-core/` — Document domain + editor session
- `crates/grafalith-io/` — Interchange (JSON schema, import pipeline, clipboard codec, PNG descriptors)
- `crates/grafalith-bindings/` — Host boundary (JSON-string batch protocol, `Engine` facade, DTOs)
- `crates/grafalith/` — npm distribution (`@fazelstudio/grafalith`)
- `crates/grafalith-python/` — PyPI distribution (`grafalith`)
- `crates/grafalith-sdk/` — Rust SDK facade for extensions
- `crates/grafalith-text/` — Text measurement and shaping helpers
- `apps/desktop/` — Tauri demo app (the reference host)
- `packages/grafalith-sdk/` — TypeScript SDK (typed client, extension registry)
- `examples/` — Standalone usage and extension examples
- `docs/` — Product scope, technical contract, and guides (`docs/guides/`)

Dependency direction: `grafalith`/`grafalith-python` → `grafalith-bindings` → `grafalith-io` → `grafalith-core` → `grafalith-geometry`.

## Rules

1. Engine crates must remain framework-agnostic (no React/Vue/DOM/Canvas/Tauri).
2. All mutations go through `Document` (the sole version/nonce authority) as one undoable `Command` via `HistoryManager`.
3. Run the checks in [`DEVELOPMENT.md`](./DEVELOPMENT.md) before submitting PRs.
4. Follow existing code conventions (data-oriented, elements as plain data, behavior in separate functions).
5. Every public item needs a short Rustdoc (1-2 lines).

See [`DEVELOPMENT.md`](./DEVELOPMENT.md#publishing) for release publishing.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
