# Desktop Guide — Nary reference host

The Tauri desktop app under `apps/desktop/` is the reference host. It owns all
UI chrome and rasterization; the engine owns all document state.

## Run

```bash
bun install   # desktop dependencies only; the engine needs no JS install
bun run tauri:dev
bun run tauri:build
```

## How it drives the engine

- One `Engine` per window, behind `AppState`.
- DOM events are translated into `apply_batch` ops (`pointerDown`,
  `pointerMove`, `pointerUp`, `wheel`, `keyDown`, `textInput`, …).
- Each frame drains events (`session.drainEvents`), then re-queries
  `view.renderModel` and `session.state` — one crossing per frame.
- The deterministic `RenderModelDto` is rasterized with a single Canvas2D
  canvas and a `requestAnimationFrame` loop.

## UI text

UI strings live in `apps/desktop/src/app/i18n/` with English as the canonical
key set. See [`locale-guide.md`](./locale-guide.md) for layout, rules, and how
to add keys or locales.
