# Extension Guide

Audience: third-party developers adding a node type, tool, command, renderer,
or importer/exporter **without modifying engine sources**.

Stability markers: `stable` (frozen), `unstable` (additive growth),
`internal` (do not use).

## 1. Custom UI button calling the engine

Build any UI (React/Vue/vanilla/native WebView/Python Qt) and call commands.
No built-in UI or keymap is required.

TypeScript (WASM), using the string protocol (`stable`):

```ts
import { JsEngine } from "@fazelstudio/nary";

const engine = new JsEngine();

// A "Rectangle" button with your own design:
rectButton.onclick = () => {
  engine.apply_batch(JSON.stringify([
    { op: "setTool", tool: "rectangle" },
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
# Custom button: activate the rectangle tool, then create a node
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
re-querying `view.renderModel` + `session.state` — one crossing per frame.

## 2. External Rust crate: new node type + tool + command

1. Depend on `nary-core` (path or published version) — never copy engine files.
2. Implement `ShapeExtension` (behavior mirrors `plugin_example.rs`):

```rust
use nary_core::{ShapeExtension, Element, EngineResult};

pub struct StickerShape;

impl ShapeExtension for StickerShape {
    fn type_name(&self) -> &str { "acme.sticker" }
    fn bounds(&self, el: &Element) -> Option<nary_core::geometry::Bounds> {
        Some(el.bounds())
    }
    fn hit_test(&self, el: &Element, x: f64, y: f64) -> Option<bool> {
        Some(nary_core::hit_test::hit_test_element(el, x, y))
    }
}
```

3. Ship a `Plugin` declaring capabilities through `PluginContext`
   (`tools`, `shapes`, `commands`, `serializers`, `importers`, `exporters`),
   with `PluginMetadata` for the compatibility check.
4. Register without touching core:

```rust
use nary_core::{PluginRegistry, ShapeRegistry};

let mut preg = PluginRegistry::new();
preg.register(Box::new(AcmePlugin))?;
let shapes = ShapeRegistry::new();
shapes.register_extension("acme.sticker", Box::new(StickerShape))?;
```

5. Store data in `Element::Custom { type_name: "acme.sticker", data }`
   (opaque map; core validates finiteness, behavior is yours).
6. Drive it from any UI via dynamic dispatch:
   `executeCommand("acme.sticker.create", payload)`.

Rules: instance-scoped (no globals); fallible ops return `EngineResult`
(no panics across FFI); no DOM/Canvas/React/Tauri in engine code; one user
intent = one history entry (go through `Command`, never direct field mutation).

## 3. Renderer / importer / exporter extensions

- Renderer: consume `view.renderModel` DTOs host-side (Canvas2D today).
  Never add raster code to `nary-core`.
- Importer/exporter: implement `SerializerExtension`/`ImporterExtension`/
  `ExporterExtension`; JSON stays the interchange language.

## 4. Worked examples in this repo

- `examples/ext-sticker/` — standalone workspace crate: sticker node type +
  tool + history-tracked command. Run:
  `cargo test --manifest-path examples/ext-sticker/Cargo.toml`.
- `examples/custom-button/` — one toolbar scenario on three hosts, each
  against a real built artifact.
- `generated/nary-commands.d.ts` + `generated/nary.pyi` — produced by
  `scripts/gen_command_bindings.py` from the single 79-op table
  (CI runs `--check`).

## 5. TypeScript SDK

`packages/nary-sdk` is the extension surface for TypeScript: extension
manifests, activation/disposal, tool contributions, and overlay renderers
over a typed engine client. It drives the real engine through the same JSON
protocol — no engine changes, no second module.

Boundary rule: TypeScript extensions contribute UI, tools, panels,
overlays, and automation. New node types and history-integrated commands
stay Rust (`crates/nary-sdk`, `examples/ext-sticker`) because `Custom`
payloads and `CommandExtension` never cross the JSON boundary.
