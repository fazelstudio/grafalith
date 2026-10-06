# 06 — Extension Guide (make an external package)

Audience: third-party developers adding a node type, tool, command, renderer,
or importer/exporter **without modifying engine sources**. Stability markers:
`stable` (frozen), `unstable` (additive growth), `internal` (do not use).
Today's in-tree proof is `crates/nary-core/tests/plugin_example.rs` (star
shape + tool, 4 tests, no core changes); the out-of-tree crate flow is roadmap
M6. The mechanics below work now for in-workspace and out-of-workspace Rust
crates (compile-time path); JS/Python drive behavior through the protocol
(callback path). Runtime WASM sandbox plugins are deferred (ADR-0017).

## 1. Custom UI button calling the engine (the core scenario)

Build any UI (React/Vue/vanilla/native WebView/Python Qt) and call commands.
No built-in UI or keymap is required.

TypeScript (WASM), using the string protocol (`stable`):

```ts
import { JsEngine } from "@fazelstudio/nary";

const engine = new JsEngine();

// A "Rectangle" button with your own design:
rectButton.onclick = () => {
  engine.apply_batch(JSON.stringify([
    { op: "setTool", tool: "rectangle" },   // command: tool.activate
  ]));
};

// Enable/disable the button reactively:
const state = JSON.parse(engine.apply_batch(JSON.stringify([{ op: "sessionState" }])));
undoButton.disabled = !state.results[0].data.canUndo;
```

Python (`stable`):

```python
from nary import Engine

engine = Engine()
#зано custom button: activate the rectangle tool, then create a node
engine.apply_batch([{"op": "setTool", "tool": "rectangle"}])
engine.apply_batch([{"op": "create", "element": {
    "id": "rect-1", "type": "rectangle",
    "x": 10, "y": 10, "width": 100, "height": 100,
}}])
```

Rust (native embedding, `unstable` surface for direct `Document` access;
prefer the batch protocol unless embedding natively):

```rust
use nary_bindings::Engine;

let mut engine = Engine::new();
let res = engine.apply_ops(vec![nary_bindings::BatchOp::Select {
    ids: vec!["rect-1".to_string()],
}]);
assert_eq!(res.applied, 1);
```

Subscribe to changes by draining events per frame (`session.drainEvents`) and
re-querying `view.renderModel` + `session.state` — one crossing per frame
(`getFrame` pattern in the desktop host, `useEngine.ts:241-260`).

## 2. External Rust crate: new node type + tool + command

1. Depend on `nary-core` (path or published version) — never copy engine files.
2. Implement `ShapeExtension` (`stable` surface once marked; behavior below
   mirrors `plugin_example.rs`):

```rust
use nary_core::{ShapeExtension, Element, EngineResult};

pub struct StickerShape; // your type

impl ShapeExtension for StickerShape {
    fn type_name(&self) -> &str { "acme.sticker" } // own namespace (ADR-0016)
    fn bounds(&self, el: &Element) -> Option<nary_core::geometry::Bounds> {
        Some(el.bounds()) // or custom math
    }
    fn hit_test(&self, el: &Element, x: f64, y: f64) -> Option<bool> {
        Some(nary_core::hit_test::hit_test_element(el, x, y))
    }
    // render_desc / default_size / create_drag as needed
}
```

3. Ship a `Plugin` declaring capabilities through `PluginContext`
   (`tools`, `shapes`, `commands`, `serializers`, `importers`, `exporters`),
   with `PluginMetadata{id, name, version, min/max_engine}` for the
   compatibility check (`PLUGIN_PROTOCOL_VERSION = 1`).
4. Register without touching core:

```rust
use nary_core::{PluginRegistry, ShapeRegistry};

let mut preg = PluginRegistry::new();
preg.register(Box::new(AcmePlugin))?; // register → activate → use → deactivate → dispose
let shapes = ShapeRegistry::new();
shapes.register_extension("acme.sticker", Box::new(StickerShape))?;
```

5. Store data in `Element::Custom { type_name: "acme.sticker", data }`
   (opaque `PatchValue` map; core validates finiteness, behavior is yours).
6. Drive it from any UI via dynamic dispatch: `executeCommand("acme.sticker.
   create", payload)` (M1; today: your command's `BatchOp` through
   `apply_batch`).

Rules: instance-scoped (no globals — ADR-0003); fallible ops return
`EngineResult` (no panics across FFI — ADR-0004); no DOM/Canvas/React/Tauri in
engine code; one user intent = one history entry (go through `Command`, never
direct field mutation).

## 3. Renderer / importer / exporter extensions

- Renderer: consume `view.renderModel` DTOs host-side (Canvas2D today; Skia/
  WebGPU later). Never add raster code to `nary-core` (ADR-0017).
- Importer/exporter: implement `SerializerExtension`/`ImporterExtension`/
  `ExporterExtension` (`format_id()` + string-only transforms); JSON stays the
  interchange language; binary (`postcard`) only if JSON proves slow on a hot
  path.

## 4. Presets

- `engine-preset-standard`: everything (default — today's behavior).
- `engine-preset-minimal`: document + selection + history only.
- Heavy codecs (`usvg`, `parley`-based layout) arrive as Cargo features so
  minimal users pay nothing (M4/M6).

## 5. Worked examples in this repo (M6, all executed green)

- `examples/ext-sticker/` — standalone workspace crate (excluded from the
  engine workspace): sticker node type + tool + history-tracked command,
  3 integration tests. Run: `cargo test --manifest-path
  examples/ext-sticker/Cargo.toml`.
- `examples/custom-button/` — one toolbar scenario on three hosts, each
  against a real built artifact: Rust (`cargo run -p nary-bindings
  --example custom_button`), JS (`node examples/custom-button/button.cjs`
  after `bun run build:wasm:node`), Python (`python
  examples/custom-button/button.py` after installing the maturin wheel).
- `generated/nary-commands.d.ts` + `generated/nary.pyi` — produced by
  `scripts/gen_command_bindings.py` from the single 78-op table
  (cross-checked against `protocol.rs`; CI runs `--check`).
