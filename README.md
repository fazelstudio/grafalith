<p align="center">
  <img src="public/assets/icons/opennary.svg" width="120" alt="OpenNary logo" />
</p>

<h1 align="center">OpenNary</h1>

<p align="center">
  A lightweight, framework-agnostic canvas engine for building infinite whiteboard applications — written in Rust, distributed to npm (WASM) and PyPI (Python).
</p>

<p align="center">
  <a href="https://github.com/fazelstudio/opennary/actions/workflows/ci.yml"><img src="https://github.com/fazelstudio/opennary/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@fazelstudio/opennary"><img src="https://img.shields.io/npm/v/@fazelstudio/opennary" alt="npm version" /></a>
  <a href="https://pypi.org/project/opennary/"><img src="https://img.shields.io/pypi/v/opennary" alt="PyPI version" /></a>
  <a href="https://github.com/fazelstudio/opennary/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@fazelstudio/opennary" alt="license" /></a>
</p>

## Features

- **Shape primitives** — Rectangle (with roundness), ellipse, line, arrow (arrow/bar/dot heads), freedraw, text, frame, image (with crop), vector path, component instance
- **Selection** — Click, multi-select (Shift+click), rubber-band selection, group-aware drill-in
- **Transform** — Move, resize (8 handles, rotation-aware), rotate (15° snap), multi-select proportional resize
- **Style** — Solid colors, linear/radial gradients, hachure/cross-hatch fills, stroke styles (solid/dashed/dotted), opacity
- **Text** — In-place editing, auto-resize, alignment, IME composition support
- **Arrows** — Free arrows or bound to elements (auto-follow on move/resize/rotate)
- **History** — Undo/redo via command pattern with exact snapshot inversion
- **Clipboard** — Copy, paste (cascade offset), cut, duplicate — with id/group/binding remap
- **Organization** — Groups, layers (z-order), lock, frames with constraints and flex-like auto-layout
- **Precision tools** — Align (6 ops), distribute (2 ops), snap to grid and object edges
- **Vector editing** — Multi-click pen with symmetric Bezier handles, path anchor/handle editing, image cropping
- **Spatial index** — Grid-based spatial hash for fast hit-testing and viewport culling
- **Export/Import** — Versioned JSON scene serialization and PNG export planning
- **Headless engine API** — 100% usable without any UI framework; hosts render from a deterministic `RenderModel`
- **Extension system** — Custom shapes, tools, commands, and serializers via extension traits

## Install

```bash
npm install @fazelstudio/opennary
# or
bun add @fazelstudio/opennary
```

```bash
pip install opennary
```

Usage: [`docs/guides/javascript.md`](./docs/guides/javascript.md) for
JavaScript/TypeScript, [`docs/guides/python.md`](./docs/guides/python.md)
for Python.

## Crates

| Crate | Description |
|----|-------------|
| [`opennary-geometry`](./crates/opennary-geometry) | Pure 2D math — points, bounds, transforms, hit-testing, spatial grid, snapping, viewport |
| [`opennary-core`](./crates/opennary-core) | Document domain — elements, document store, history/commands, editor session, clipboard, components, extensions |
| [`opennary-io`](./crates/opennary-io) | Interchange — versioned JSON schema, staged import pipeline, clipboard codec, PNG export descriptors |
| [`opennary-bindings`](./crates/opennary-bindings) | Host boundary — JSON-string batch protocol, `Engine` facade, render/session DTOs |
| [`opennary`](./crates/opennary) | npm distribution — `wasm-pack` target, published as `@fazelstudio/opennary` |
| [`opennary-python`](./crates/opennary-python) | PyPI distribution — `maturin`/PyO3 bindings, published as `opennary` |

Dependency direction: `opennary`/`opennary-python` → `opennary-bindings` → `opennary-io` → `opennary-core` → `opennary-geometry`.

## Docs

- [`docs/`](./docs/) — product scope, technical contract, and guides.
- [`docs/guides/javascript.md`](./docs/guides/javascript.md) — JavaScript/TypeScript usage.
- [`docs/guides/python.md`](./docs/guides/python.md) — Python usage.
- [`docs/guides/commands.md`](./docs/guides/commands.md) — command and protocol reference.
- [`docs/guides/extensions.md`](./docs/guides/extensions.md) — extensions without forking.
- [`docs/guides/desktop.md`](./docs/guides/desktop.md) — desktop demo (reference host).
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — technical contract.
- [`docs/PRD.md`](./docs/PRD.md) — scope and out-of-scope boundaries.
- [`crates/README.md`](./crates/README.md) — Rust workspace map and design rules.

## Development

See [`DEVELOPMENT.md`](./DEVELOPMENT.md). Contributing: see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © [fazelstudio](https://github.com/fazelstudio)
