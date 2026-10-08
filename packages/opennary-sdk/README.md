# @fazelstudio/opennary-sdk — TypeScript extension SDK

The primary extension-ecosystem surface: extensions are
TypeScript modules with a manifest, activated by the host against a typed
engine client. The engine itself stays headless Rust; this package only
formats JSON batches and parses results over the stable protocol.

- `src/protocol.generated.ts` — 78-op typed vocabulary, generated from the
  same `COMMANDS` table as `generated/opennary-commands.d.ts` (CI `--check`).
- `src/client.ts` — `EngineClient`: typed methods + raw `batch()` escape hatch.
- `src/manifest.ts` — `.onry` identity (`opennary.extension.json`, format v1),
  validation, and `engines` range gating.
- `src/commands.ts` — `ExtensionCommandRegistry`: register/execute/gate extension
  commands with disposables.
- `src/contributions.ts` — contribution validation (commands, menus, views,
  activity, panels, status, tools, keybindings, configuration) against host
  surfaces.
- `src/window.ts` — `WindowApi` (notifications, quick pick, input, dialogs,
  status bar items) plus a memory adapter for tests.
- `src/workspace.ts` — config store, workspace events, and per-extension memento.
- `src/extensions.ts` — `ExtensionRegistry` (manifest → activate → dispose,
  lazy `activateByTrigger` for `onStartup`/`onCommand`/`onView`) and
  `OverlayRegistry` (custom canvas layers).
- `example/toolbar-extension.ts` — runnable toolbar + overlay scenario.

## Boundary rule

TypeScript extensions contribute **UI, tools buttons, panels, canvas
overlays, and automation**. New **node types** and history-integrated
**commands** stay Rust (`crates/opennary-sdk`, `examples/ext-sticker`):
custom payloads never cross the JSON boundary.

## Run

```bash
bun run build:wasm:node        # real engine artifact (repo root)
bun --filter @fazelstudio/opennary-sdk example
bun --filter @fazelstudio/opennary-sdk typecheck
```

## Run SDK tests

```bash
cd packages/opennary-sdk && bun test src/
```
