# Fazelidraw

A lightweight, framework-agnostic canvas engine for building infinite whiteboard applications.

[![CI](https://github.com/fazelstudio/fazelidraw/actions/workflows/ci.yml/badge.svg)](https://github.com/fazelstudio/fazelidraw/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@fazelstudio/fazelidraw)](https://www.npmjs.com/package/@fazelstudio/fazelidraw)
[![license](https://img.shields.io/npm/l/@fazelstudio/fazelidraw)](https://github.com/fazelstudio/fazelidraw/blob/main/LICENSE)

## Features

- **Shape primitives** — Rectangle, ellipse, line, arrow, freedraw, text
- **Selection** — Click, multi-select (Shift+click), rubber-band selection
- **Transform** — Move, resize (8 handles), rotate
- **Style** — Solid colors, linear gradients, stroke styles (solid/dashed/dotted), opacity
- **Text** — In-place editing, auto-resize, alignment
- **Arrows** — Free arrows or bound to elements (auto-follow on move)
- **History** — Undo/redo via command pattern
- **Clipboard** — Copy, paste, cut, duplicate
- **Spatial index** — Grid-based spatial hash for fast hit-testing and viewport culling
- **Export/Import** — JSON (full scene serialization) and PNG
- **Infinite canvas** — Pan and zoom with mouse/touch
- **Headless Editor API** — 100% usable without any UI framework
- **Event system** — Reactive subscriptions for all state changes

## Install

```bash
npm install @fazelstudio/fazelidraw
# or
bun add @fazelstudio/fazelidraw
```

For React bindings:

```bash
npm install @fazelstudio/react @fazelstudio/fazelidraw react react-dom
```

## Quick Start — Headless (No Framework)

```typescript
import { createEditor } from '@fazelstudio/fazelidraw';

const editor = createEditor();
editor.mount(document.getElementById('canvas') as HTMLDivElement);

// Create shapes
editor.createElement({ type: 'rectangle', x: 100, y: 100, width: 200, height: 120 });
editor.createElement({ type: 'text', x: 100, y: 250, width: 300, height: 40, text: 'Hello Fazelidraw!' });

// React to changes
editor.on('change', () => {
  console.log('Elements:', editor.getElementCount());
});

editor.on('selectionChange', (ids) => {
  console.log('Selected:', ids);
});

// Style, undo/redo, export
editor.setStyle(editor.getSelection(), { strokeColor: '#ff0000' });
editor.undo();
const json = editor.exportToJSON();
```

## Quick Start — React

```tsx
import { FazelidrawEditor } from '@fazelstudio/react';

function App() {
  return <FazelidrawEditor />;
}
```

## Packages

| Package | Description |
|---------|-------------|
| [`@fazelstudio/fazelidraw`](./packages/core) | Core engine — zero framework dependency, headless Editor API |
| [`@fazelstudio/react`](./packages/react) | React bindings + default UI components |

## Architecture

- **Zero framework dependency** — Pure TypeScript, no React/Vue/Svelte in core
- **Dual-canvas rendering** — Static canvas for elements, interactive canvas for UI overlays
- **Data-oriented design** — Elements are plain objects, behavior lives in separate functions
- **Spatial grid indexing** — Fast bounds queries for viewport culling and hit-testing
- **Editor API** — Single public facade for all engine operations
- **Event system** — Lightweight pub-sub for reactive UI updates

## Sub-path Imports

Tree-shakeable imports via sub-paths:

```typescript
import { createEditor, Editor } from '@fazelstudio/fazelidraw';
import { PanZoom } from '@fazelstudio/fazelidraw/interaction';
import { SpatialGrid } from '@fazelstudio/fazelidraw/spatial';
import { exportSceneToJSON } from '@fazelstudio/fazelidraw/io';
```

## Development

```bash
# Install dependencies
bun install

# Run demo app
bun run dev

# Run tests
bun test --filter @fazelstudio/fazelidraw

# Type check all packages
bun run typecheck

# Build all packages
bun run build
```

## Publishing

```bash
# Publish core package
bun run publish:core

# Publish react package
bun run publish:react

# Publish both
bun run publish:all
```

## Performance

- 5,000 elements: viewport culling ~0.35ms, hit-test ~0.01ms
- Full render pipeline: ~0.33ms (1.98% of 16ms frame budget at 60fps)
- Spatial grid provides 6.3x speedup for hit-test operations

## License

[MIT](./LICENSE) © [fazelstudio](https://github.com/fazelstudio)
