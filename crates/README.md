# crates — Nary Rust engine

The Rust workspace is the single source of truth for the engine. Hosts
(browser JS, Python, Tauri desktop) are thin adapters over the JSON-string
protocol — all engine rules live here.

## Crate responsibilities (one-way dependency)

```text
nary  ─┐
            ├─▶ nary-bindings ─▶ nary-io ─▶ nary-core ─▶ nary-geometry
nary-python ┘        │              │           │            │
                     │              │           │            │
               JSON string      envelope +   domain      pure math
               batch protocol   clipboard   (no DOM,     (no deps)
               + DTOs           codec       no React,
                                           no Tauri)
```

- **`nary-geometry`** — pure 2D math, zero deps: `point`, `rect` (`Bounds`),
  `segment`, `rotation`, `hit`, `path`, `transform` (resize/rotate/handles),
  `spatial` (`SpatialGrid`), `snap`, `viewport`.
- **`nary-core`** — persistent domain + editor session (see the module map in
  `nary-core/src/lib.rs`): `domain`, `history`, `session`, `ops`, `view`,
  `ext`. `Document` is the sole version/nonce authority; all mutation goes
  through `Command` (two-phase validate-then-store, one history entry per
  intent).
- **`nary-io`** — interchange: `schema` (versioned DTOs, lenient-version /
  strict-data), `pipeline` (`export/import`, staged plan, PNG descriptors),
  `clipboard_codec` (versioned envelope + bare-array compatibility).
- **`nary-bindings`** — the only stateful surface (`Engine`):
  `protocol` (JSON-string `BatchOp`, `PROTOCOL_VERSION`), `engine` (dispatch,
  reuses the same command/io machinery), `render_dto`/`session` shapes,
  `wasm::JsEngine` (string-only), `tauri` (thin wrapper, no Tauri dep).
- **`nary`** — npm distribution (`wasm-pack`), published as
  `@fazelstudio/nary`. Thin, string-only.
- **`nary-python`** — PyPI distribution (`maturin`/PyO3), published as
  `nary`. Thin, dict-in/dict-out.
- **`nary-sdk`** — Rust SDK facade for plugins and extensions.
- **`nary-text`** — Text measurement and shaping helpers.

## Main rules

- `nary-core` must not depend on any host binding, renderer, DOM/Canvas,
  React, or Tauri (enforced by the `workspace_wiring` test).
- All fallible ops → `EngineResult<T, EngineError>`; `panic!` is reserved for
  must-never-fail invariants and never crosses an FFI boundary.
- Instance-scoped state: no global singletons; many `Engine`
  instances coexist (multi-canvas, multi-document).
- Render is data (`RenderModel`/`DrawEntry`/`PaintDesc`), not raster: hosts
  (Canvas2D, Skia, …) draw; the engine never touches canvas/DOM.
- `Document` owns its query accelerator: a `SpatialGrid` synced on every
  mutation (tombstones evicted), backing viewport culling (`RenderModel`)
  and host hit-testing (`query_spatial`, `rebuild_spatial`, `raw_bounds`).
- `AssetStore` is synchronous in core (`Bytes`/`Url`); async/blob fetching is
  a host concern that bumps the explicit `asset_generation`.
- The protocol grows additively (`align`, `distribute`, `applyAutoLayout`,
  `resizeSelection`, `pen`/`crop`/`pathEdit` sessions); `PROTOCOL_VERSION`
  is bumped only for breaking changes.

## Standard commands

Canonical reference: [`../DEVELOPMENT.md`](../DEVELOPMENT.md).

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Readiness for the future plugin SDK

The engine is deliberately architected for a future public plugin SDK (the
"VSCode extension" model) without shipping the SDK yet:

- **Command-based core** — every user intent is one atomic `Command` executed
  via `HistoryManager`; the protocol batch is a command list. Hosts build
  tool buttons by calling commands (CodeMirror 6 style).
- **Plugin = installable unit** — `Plugin` trait + `PluginMetadata` +
  lifecycle (register → activate → deactivate → dispose) + protocol-version
  compatibility check. Instance-scoped, no globals.
- **Extension = registered capability** — `ShapeExtension`,
  `CommandExtension`, `SerializerExtension`, `ImporterExtension`,
  `ExporterExtension`. Plugins declare capabilities through `PluginContext`,
  which is backed by the registry's persistent capability storage
  (`tools`/`shapes`/`commands`/`serializers`/`importers`/`exporters`).
- **Dispatch seam** — `PluginRegistry::command_by_id` is the lookup point
  for the future `executeCommand` protocol op; the SDK will re-export the
  registry surface so plugin authors never touch engine internals.

When the SDK ships, it will be a thin facade crate (`nary-sdk`) over these
public surfaces — no engine changes required.

## Feature map (engine)

| Area | Module(s) | Notes |
|---|---|---|
| Element model (11 types + custom) | `element` | plain data; factories + validate + bounds per type |
| Document store | `document` | id map + explicit z-order + version/nonce authority; soft/hard delete; snapshots |
| History / commands | `command`, `history` | inversion via exact snapshots, not re-execution; transactions |
| Editor session | `editor`, `editor_state`, `selection`, `gesture`, `text_session`, `interaction` | normalized input; pointer phase machine; drainable event queue |
| Domain ops | `group`, `lock`, `zorder`, `style`, `frame`, `alignment`, `arrow_binding`, `constraints`, `auto_layout`, `clipboard`, `components`, `assets`, `path_edit` | follow-binding + constraint propagation inside the same transaction (no hidden `afterUpsert`) |
| View | `hit_test`, `render_model`, `canvas_mode`, `theme` | render as deterministic DTO; frame-clip partition; instance resolve |
| Extensions | `shape_registry`, `shape_extension`, `plugin`, `command_extension`, `serializer` | instance-scoped, no globals |
| Interchange | `nary-io/*` | versioned schema, staged import, clipboard codec, PNG plan |
| Host boundary | `nary-bindings/*` | JSON-string batch, per-op atomic, error envelopes |

What stays host-side (by design, not a gap): Canvas2D rasterization, DOM
(textarea overlay, OS clipboard, file download), pixel-exact text measuring
(core provides a trait + deterministic fallback), and all UI chrome.
