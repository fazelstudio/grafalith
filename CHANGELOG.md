# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- The TypeScript engine (`packages/core`, `packages/react`) has been fully
  removed. The Rust workspace (`crates/*`) is now the single source of truth
  for the engine.
- The npm distribution is now `@fazelstudio/grafalith` (WASM via `wasm-pack`),
  replacing the old `@fazelstudio/grafalith` TypeScript package.
- The PyPI distribution is now `grafalith` (via `maturin`/PyO3).

### Added
- `crates/grafalith` — npm distribution crate (`JsEngine`, string-only API).
- `crates/grafalith-python` — PyPI distribution crate (`PyEngine`, dict-in/dict-out API).
- `path_edit` module — full vector path editing session (anchor/handle drag,
  symmetric Bezier handles with Alt-break, add/delete anchors, commit).
- `ResizeSelection` command — proportional multi-select resize.
- `SetCrop` command + crop session hit-testing (8 handles, scene↔natural mapping).
- `PenSession` Bezier handles + `build_path` commit.
- `define_component` promotion helper with full validation.
- Document-owned `SpatialGrid` synced on every mutation (viewport culling +
  hit-testing acceleration).
- `RenderModel::build_with_registry` — instance resolution for rendering.
- `ShapeExtension` trait methods: `minimum_size`, `default_size`, `create_drag`.
- `draw_box_element_via_registry` — registry-dispatched draw-create.
- Protocol ops: `resizeSelection`, `penBegin/Click/DragHandle/Commit/Cancel`,
  `cropStart/Drag/Commit/Cancel`, `pathEditBegin/Press/Drag/Release/Commit/Cancel`.
- `EngineStatus` / `SessionStateDto` now expose `penActive`, `cropping`,
  `pathEditing` session mirrors.
- Project docs: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `README.id.md`,
  `docs/PRD.md` (English), GitHub issue/PR templates, `CHANGELOG.md`.
