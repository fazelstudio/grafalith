# Releasing Grafalith

This guide covers version consistency, release validation, and publication. Do not treat a prior release-status note as current; verify registry state and package metadata at release time.

Before publishing:

1. Confirm the release scope, version, changelog/release notes, and supported compatibility policy.
2. Read `AGENTS.md`, `DEVELOPMENT.md`, and the README for each package being released.
3. Run the relevant tests, Clippy, formatting, package-readiness checks, and artifact builds.
4. Verify generated bindings and docs are current.
5. Review each `Cargo.toml`, `package.json`, `pyproject.toml`, license, repository URL, and publish include/exclude list.
6. Verify package names and dependency order from current manifests/metadata; do not rely on a copied list if the workspace has changed.
7. Publish only the intended artifacts and verify the installed/published package after release.

## npm / WASM

Build and verify the intended target before publishing:

```bash
bun run build:wasm
bun run verify:packages
cd pkg/bundler
npm publish
```

Use `pkg/node` instead of `pkg/bundler` only when intentionally releasing the Node.js target and its package is configured for publication.

## Python / PyPI

Keep the version in `crates/grafalith-python/pyproject.toml` aligned with the package's Cargo manifest. Build and test the wheel before upload.

```bash
bun run build:python
```

For a first release or a risky package change, publish to TestPyPI first when applicable. Use an account-scoped API token, enable account security required by PyPI, and never commit tokens or credentials.

## crates.io

Determine the exact publishable crate names and dependency order from the current manifests. Publish dependencies before crates that depend on them. For the workspace shape documented at the time this guide was written, the intended Rust library order is:

```bash
cargo login
cargo publish -p grafalith-geometry
cargo publish -p grafalith-core
cargo publish -p grafalith-io
cargo publish -p grafalith-pptx
cargo publish -p grafalith-bindings
cargo publish -p grafalith-sdk
cargo publish -p grafalith-text
```

Before using this sequence, verify each package exists, is configured for publishing, and has the correct dependency versions. Build artifacts, host applications, and examples may be marked `publish = false` and should not be published as libraries.

## Release completion

Record the released versions and links in the repository's chosen release record. Verify registry pages and perform a clean install/smoke test when practical. If publication partially fails, record exactly which artifacts were published before retrying; do not blindly rerun all publish commands.
