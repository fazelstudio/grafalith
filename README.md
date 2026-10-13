<p align="center">
  <img src="public/assets/icons/Grafalith.svg" width="120" alt="Grafalith logo" />
</p>

<h1 align="center">Grafalith</h1>

<p align="center">
  A lightweight, framework-agnostic 2D graphics engine written in Rust, designed to power drawing, design, presentation, and whiteboard experiences.
</p>

<p align="center">
  <a href="https://github.com/fazelstudio/grafalith/actions/workflows/ci.yml"><img src="https://github.com/fazelstudio/grafalith/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@fazelstudio/grafalith"><img src="https://img.shields.io/npm/v/@fazelstudio/grafalith" alt="npm version" /></a>
  <a href="https://pypi.org/project/grafalith/"><img src="https://img.shields.io/pypi/v/grafalith" alt="PyPI version" /></a>
  <a href="https://github.com/fazelstudio/grafalith/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@fazelstudio/grafalith" alt="license" /></a>
</p>

## Overview

Grafalith separates document and graphics logic from the host UI. The Rust engine can be embedded by applications through its supported bindings; hosts are responsible for presenting the engine's render output and handling platform-specific UI.

The repository also contains a Tauri desktop application with Design, Slides, and Whiteboard workflows. Those workflows may share engine primitives, but mode-specific document rules belong to their appropriate domain rather than being duplicated inside the shared core.

## Capabilities

The engine and surrounding packages cover areas such as:

- **2D elements** — shapes, paths, text, images, arrows, and frames.
- **Editing** — selection, transforms, styles, grouping, locking, ordering, and clipboard operations.
- **History** — command-based undo and redo.
- **Precision tools** — snapping, alignment, and distribution.
- **Geometry and hit testing** — reusable 2D math and spatial queries.
- **Interchange** — versioned scene data, import/export, and clipboard codecs.
- **Headless integration** — a host-facing API and deterministic render data.
- **Extensibility** — supported extension points for custom shapes or operations.

See the API guides and command reference for the capabilities available through each public interface. The README is an overview, not the authoritative feature-status checklist.

## Install

```bash
npm install @fazelstudio/grafalith
# or
bun add @fazelstudio/grafalith
```

```bash
pip install grafalith
```

Usage guides: [JavaScript/TypeScript](./docs/guides/javascript.md) · [Python](./docs/guides/python.md) · [Commands and protocol](./docs/guides/commands.md).

## Workspace map

| Area | Responsibility |
|---|---|
| `crates/grafalith-geometry/` | Pure 2D geometry, transforms, bounds, hit testing, spatial queries, snapping, and viewport math |
| `crates/grafalith-core/` | Document domain, editor state, commands, history, and core operations |
| `crates/grafalith-io/` | Versioned interchange, import pipeline, clipboard codecs, and export descriptors |
| `crates/grafalith-pptx/` | PowerPoint/PPTX-specific interchange, where provided by this workspace |
| `crates/grafalith-bindings/` | Host protocol, engine facade, and DTOs |
| `crates/grafalith/` | npm/WASM distribution |
| `crates/grafalith-python/` | Python distribution; use its manifest for the exact Cargo package name |
| `crates/grafalith-sdk/` | Rust-facing SDK and extension facade |
| `crates/grafalith-text/` | Text measurement and shaping helpers |
| `apps/desktop/` | Tauri reference desktop host |
| `packages/grafalith-sdk/` | TypeScript SDK for host integrations |

The Cargo manifests and [`crates/README.md`](./crates/README.md) are authoritative for the current workspace members and dependency direction.

## Documentation

- [Product requirements](./docs/PRD.md) — product goals, scope, and acceptance expectations.
- [Architecture contract](./docs/ARCHITECTURE.md) — domain boundaries and invariants.
- [Design notes](./DESIGN.md) — repository-specific implementation design; keep it verified against the source.
- [Development](./DEVELOPMENT.md) — setup, build, checks, and local workflows.
- [Releasing](./RELEASING.md) — package publication and release checks.
- [Comment guidelines](./docs/guides/comment-guidelines.md) — source-code comment rules.
- [Crate map](./crates/README.md) — Rust workspace details.
- [Documentation index](./docs/README.md) — guides and API references.

Contribution and security policies should live in their dedicated files (for example `CONTRIBUTING.md` and `SECURITY.md`) rather than being duplicated in this overview.

## License

[MIT](./LICENSE) © fazelstudio
