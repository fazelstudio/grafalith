# JavaScript / TypeScript Guide — Grafalith

Use the Grafalith engine from JavaScript or TypeScript through the npm/WASM build.

Package: `@fazelstudio/grafalith`. Source of truth: `crates/grafalith/`.

## Install

```bash
npm install @fazelstudio/grafalith
# or
bun add @fazelstudio/grafalith
```

## Quick start

```typescript
import { JsEngine, bindings_protocol_version } from '@fazelstudio/grafalith';

// The bundler target initializes on import — no init() call needed.
// (The Node.js target exports an async init() instead.)

const engine = new JsEngine();

// Create shapes
engine.apply_batch(JSON.stringify([
  { op: 'create', element: { id: 'r1', type: 'rectangle', x: 100, y: 100, width: 200, height: 120 } },
]));

// Read status for render-loop dirty checks and toolbar state
const status = JSON.parse(engine.status());

// Export, import, undo
const scene = JSON.parse(engine.export_scene());
engine.undo();
```

The engine owns all state. Hosts translate DOM events into `apply_batch` ops
(`pointerDown`, `pointerMove`, `pointerUp`, `wheel`, `keyDown`, `textInput`, …)
and render from the `renderModel` op's deterministic `RenderModelDto`.

Paint rotated entries from `frame` (unrotated box) with `rotation` about its
center; `bounds` is the rotation-aware AABB for culling/hit-testing only.
Painting `bounds` dims rotated double-applies the rotation and visibly grows
the shape at non-90° angles. The selection overlay follows the same rule
(`frame` for outline/handles, `bounds` for extents).

## Protocol shape

Every method takes and returns JSON strings, never throws across the boundary.
A whole-batch parse failure returns an error envelope; a per-op failure returns
an `ok:false` entry inside the batch result.

Check `bindings_protocol_version()` (currently `1`) before the first real call
and refresh the bundle when it changes. Unknown `op` strings fail the whole
batch explicitly so version skew is loud, not silent.

Full op list: [`commands.md`](./commands.md).

## Build the artifact

Requires `wasm-pack`. From the repo root:

```bash
# Browser bundler target (out: pkg/bundler)
bun run build:wasm

# Node.js target (out: pkg/node)
bun run build:wasm:node
```

Details: [`crates/grafalith/README.md`](../../crates/grafalith/README.md).
Publishing: [`../../DEVELOPMENT.md`](../../DEVELOPMENT.md).
