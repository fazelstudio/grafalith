# Contributing to Grafalith

Thank you for your interest in contributing to Grafalith.

## Before you start

- Read the [Code of Conduct](./CODE_OF_CONDUCT.md).
- Check the [product scope](./docs/PRD.md) and the relevant architecture or crate guide before proposing a feature or changing a contract.
- For security-sensitive issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
- Discuss substantial changes to public APIs, protocol/schema formats, dependency boundaries, or rendering architecture with the maintainers before investing in an implementation.

## Development setup

The canonical setup, build, test, lint, and packaging commands live in [`DEVELOPMENT.md`](./DEVELOPMENT.md). Do not maintain a second command list here.

```bash
git clone https://github.com/fazelstudio/grafalith.git
cd grafalith
bun install  # Needed for desktop and repository tooling, not for Rust-only engine work.
```

Use [`crates/README.md`](./crates/README.md) for the current Rust crate map and dependency boundaries. Use the applicable guide under [`docs/guides/`](./docs/README.md) for command protocol, host integration, extensions, or desktop behavior.

## Contribution expectations

- Keep each change focused on the requested behavior; avoid unrelated refactors.
- Follow the documented architecture and existing implementation patterns. Ask before changing established public contracts or dependency boundaries.
- Add or update tests for behavior changes and regressions.
- Update the relevant documentation in the same change. Regenerate protocol bindings and other generated artifacts using the repository's generator; do not edit generated outputs manually unless the repository explicitly designates them as source files.
- Document public Rust APIs with Rustdoc appropriate to their contract, including important behavior, preconditions, errors, or invariants where needed.
- Do not add dependencies without explaining why they are needed and their impact, especially on WASM/native compatibility and bundle size.
- Do not claim checks passed unless they were run. Report any checks that could not be run and why.

## Pull requests

A pull request should explain:

- **What changed** and the user-visible or technical reason for it.
- **How it was verified**, including tests and relevant build, lint, or type checks.
- **Which documentation or generated files changed**, where applicable.
- **Known limitations or compatibility impact**, especially for public APIs, serialized data, or protocol changes.

Before submitting, review the diff for unrelated changes and follow the relevant checks in [`DEVELOPMENT.md`](./DEVELOPMENT.md).

## License

By submitting a contribution, you agree that it is provided under the repository's [MIT License](./LICENSE).
