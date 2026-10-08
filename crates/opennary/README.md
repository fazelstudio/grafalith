# opennary — npm/WASM distribution of the OpenNary engine

`opennary` is the `wasm-pack` entry point that ships the OpenNary Rust engine
to browsers and Node.js as `@fazelstudio/opennary`. It is a 1:1 move of the
`opennary-bindings` WASM glue (`JsEngine` + `bindings_protocol_version`) — no
second implementation, no drift.

- **String-only, never throws.** Every method takes/returns JSON strings
  (plus a few `bool`/`u32` scalars). Whole-crossing failures are error
  envelopes (`{"ok":false,"code":...}`); per-op failures are `ok:false`
  entries inside the batch result.
- **Full protocol via `apply_batch`.** Includes `align`, `distribute`,
  and `applyAutoLayout` — no dedicated crossing for them by design.

## Build

Requires [`wasm-pack`](https://rustwasm.github.io/wasm-pack/).

```bash
# Browser bundler (webpack/vite/rollup)
wasm-pack build crates/opennary --target bundler --out-dir pkg

# Node.js (CommonJS)
wasm-pack build crates/opennary --target nodejs --out-dir pkg-node

# Native tests (no WASM runner needed — wasm-bindgen compiles to plain methods)
cargo test -p opennary
```

## Use from JS/TS

```ts
import { JsEngine, bindings_protocol_version } from '@fazelstudio/opennary';

// The bundler target initializes on import — no init() call needed.
console.log('protocol:', bindings_protocol_version());

const engine = new JsEngine();

// Create two rectangles in one crossing.
let out = JSON.parse(engine.apply_batch(JSON.stringify([
  { op: 'create', element: {
    id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50,
    rotation: 0, strokeColor: '#333333',
    backgroundColor: { type: 'solid', color: '#e8f4fc' },
    strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid',
    opacity: 100, seed: 1, version: 0, versionNonce: 1,
    isDeleted: false, groupIds: [], locked: false, hidden: false,
    frameId: null, roundness: null,
  }},
  { op: 'create', element: {
    id: 'b', type: 'rectangle', x: 250, y: 30, width: 100, height: 50,
    rotation: 0, strokeColor: '#333333',
    backgroundColor: { type: 'solid', color: '#e8f4fc' },
    strokeWidth: 2, strokeStyle: 'solid', fillStyle: 'solid',
    opacity: 100, seed: 1, version: 0, versionNonce: 1,
    isDeleted: false, groupIds: [], locked: false, hidden: false,
    frameId: null, roundness: null,
  }},
])));
console.log(out.applied); // 2
```

### Align example (layout ops go through `apply_batch`)

```ts
const aligned = JSON.parse(engine.apply_batch(JSON.stringify([
  { op: 'align', ids: ['a', 'b'], mode: 'left' },
])));
console.assert(aligned.results[0].ok, JSON.stringify(aligned));

const distributed = JSON.parse(engine.apply_batch(JSON.stringify([
  { op: 'distribute', ids: ['a', 'b', 'c'], axis: 'horizontal' },
])));

const laidOut = JSON.parse(engine.apply_batch(JSON.stringify([
  { op: 'applyAutoLayout', frameId: 'frame-1' },
])));

console.log(JSON.parse(engine.status()).elementCount);
console.log(engine.element_count());
console.log(engine.can_undo(), engine.can_redo());
engine.undo();
engine.redo();
```

Other crossings:

```ts
const sceneJson: string = engine.export_scene();
const summary = JSON.parse(engine.import_scene(sceneJson, false)); // { imported, skipped }
const payload: string = engine.encode_clipboard();
const decoded = JSON.parse(JsEngine.decode_clipboard(payload)); // { count, skipped, ids }
const plan = JSON.parse(engine.plan_png_export(JSON.stringify({ background: 'white', padding: 20, scale: 2 })));
```

Check `bindings_protocol_version()` (currently `1`) before the first real
call and refresh the JS bundle when it changes — unknown `op` strings fail
the whole batch parse explicitly so skew is loud, not silent.
