# crates — Grafalith Rust engine

The Rust workspace is the single source of truth for the engine. Hosts
(browser JS, Python, Tauri desktop) are thin adapters over the JSON-string
protocol — all engine rules live here.

## Crate responsibilities (one-way dependency)

```text
grafalith  ─┐
            ├─▶ grafalith-bindings ─▶ grafalith-io ─▶ grafalith-core ─▶ grafalith-geometry
grafalith-python ┘        │              │           │            │
                     │              │           │            │
               JSON string      envelope +   domain      pure math
               batch protocol   clipboard   (no DOM,     (no deps)
               + DTOs           codec       no React,
                                           no Tauri)
```

- **`grafalith-geometry`** — pure 2D math, zero deps: `point`, `rect` (`Bounds`),
  `segment`, `rotation`, `hit`, `path`, `transform` (resize/rotate/handles),
  `spatial` (`SpatialGrid`), `snap`, `viewport`.
- **`grafalith-core`** — persistent domain + editor session (see the module map in
  `grafalith-core/src/lib.rs`): `domain`, `history`, `session`, `ops`, `view`,
  `ext`. `Document` is the sole version/nonce authority; all mutation goes
  through `Command` (two-phase validate-then-store, one history entry per
  intent). Text creation stays provisional inside the edit session's history
  transaction, so committing empty text leaves no element or undo entry.
- **`grafalith-io`** — interchange: `schema` (versioned DTOs, lenient-version /
  strict-data), `pipeline` (`export/import`, staged plan, PNG descriptors),
  `clipboard_codec` (versioned envelope + bare-array compatibility).
- **`grafalith-bindings`** — the only stateful surface (`Engine`):
  `protocol` (JSON-string `BatchOp`, `PROTOCOL_VERSION`), `engine` (dispatch,
  reuses the same command/io machinery), `render_dto`/`session` shapes,
  `wasm::JsEngine` (string-only), `tauri` (thin wrapper, no Tauri dep).
- **`grafalith`** — npm distribution (`wasm-pack`), published as
  `@fazelstudio/grafalith`. Thin, string-only.
- **`grafalith-python`** — PyPI distribution (`maturin`/PyO3), published as
  `grafalith`. Thin, dict-in/dict-out.
- **`grafalith-sdk`** — Rust SDK facade for extensions.
- **`grafalith-text`** — Text measurement and shaping helpers.

The SDK facade re-exports the engine extension traits plus the host-side
packaging   modules: `manifest` (`.grlt` validation mirroring the TS SDK),
`discovery` (installed-package listing), `storage` (per-extension JSON
storage), `notification` (toast routing DTOs), `status` (lifecycle states
mirroring the desktop status machine), `dependency` (activation-order
resolution: missing/blocked/circular reports). The Tauri host calls these
from `apps/desktop/src-tauri/src/extensions.rs`.

## Distribution channels

| Registry | Package | Built from |
|---|---|---|
| npm | `@fazelstudio/grafalith` | `crates/grafalith` (wasm-pack `cdylib`) |
| PyPI | `grafalith` | `crates/grafalith-python` (maturin) |
| crates.io | `grafalith-geometry`, `grafalith-core`, `grafalith-io`, `grafalith-bindings`, `grafalith-sdk`, `grafalith-text` | the engine crates (`rlib` libraries) |

Only the six engine crates above are publishable to crates.io. The other
workspace members are build artifacts or hosts, not libraries Rust code can
depend on, and are pinned with `publish = false` so a stray
`cargo publish -p <name>` cannot claim a registry name:

| Crate | Why `publish = false` |
|---|---|
| `grafalith` | wasm-pack `cdylib`, no `rlib` — the npm artifact |
| `grafalith-py` | PyO3 extension module — the PyPI artifact |
| `grafalith-desktop` | Tauri application host (`apps/desktop/src-tauri`) |
| `ext-sticker` | out-of-workspace teaching example |

Each channel keeps the same `0.1.0` version, and the crates.io publish order
follows the dependency arrow: `grafalith-geometry` → `grafalith-core` →
`grafalith-io` → `grafalith-bindings` / `grafalith-sdk` / `grafalith-text`.

`bun run verify:packages` (CI) enforces all of the above: required registry
metadata, the `publish = false` guards, a clean `cargo package --list` file
set, and a topological publish order. Publishing commands live in
[`../DEVELOPMENT.md`](../DEVELOPMENT.md#publishing).

## Main rules

- `grafalith-core` must not depend on any host binding, renderer, DOM/Canvas,
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

## Readiness for the future extension SDK

The engine is deliberately architected for a future public extension SDK (the
"VSCode extension" model) without shipping the SDK yet:

- **Command-based core** — every user intent is one atomic `Command` executed
  via `HistoryManager`; the protocol batch is a command list. Hosts build
  tool buttons by calling commands (CodeMirror 6 style).
- **Extension = installable unit** — `Extension` trait + `ExtensionMetadata` +
  lifecycle (register → activate → deactivate → dispose) + protocol-version
  compatibility check. Instance-scoped, no globals.
- **Extension = registered capability** — `ShapeExtension`,
  `CommandExtension`, `SerializerExtension`, `ImporterExtension`,
  `ExporterExtension`. Extensions declare capabilities through `ExtensionContext`,
  which is backed by the registry's persistent capability storage
  (`tools`/`shapes`/`commands`/`serializers`/`importers`/`exporters`).
- **Dispatch seam** — `ExtensionRegistry::command_by_id` is the lookup point
  for the future `executeCommand` protocol op; the SDK will re-export the
  registry surface so extension authors never touch engine internals.

When the SDK ships, it will be a thin facade crate (`grafalith-sdk`) over these
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
| Extensions | `shape_registry`, `shape_extension`, `extension`, `command_extension`, `serializer` | instance-scoped, no globals |
| Interchange | `grafalith-io/*` | versioned schema, staged import, clipboard codec, PNG plan |
| Host boundary | `grafalith-bindings/*` | JSON-string batch, per-op atomic, error envelopes |

What stays host-side (by design, not a gap): Canvas2D rasterization, DOM
(textarea overlay, OS clipboard, file download), pixel-exact text measuring
(core provides a trait + deterministic fallback), and all UI chrome.
