# @fazelstudio/nary-sdk — TypeScript extension SDK

The primary extension-ecosystem surface (VSCode model): extensions are
TypeScript modules with a manifest, activated by the host against a typed
engine client. The engine itself stays headless Rust; this package only
formats JSON batches and parses results over the stable protocol.

- `src/protocol.generated.ts` — 78-op typed vocabulary, generated from the
  same `COMMANDS` table as `generated/nary-commands.d.ts` (CI `--check`).
- `src/client.ts` — `EngineClient`: typed methods + raw `batch()` escape hatch.
- `src/extension.ts` — `ExtensionRegistry` (manifest → activate → dispose)
  and `OverlayRegistry` (custom canvas layers).
- `example/toolbar-extension.ts` — runnable toolbar + overlay scenario.

## Boundary rule

TypeScript extensions contribute **UI, tools buttons, panels, canvas
overlays, and automation**. New **node types** and history-integrated
**commands** stay Rust (`crates/nary-sdk`, `examples/ext-sticker`): `Custom`
payloads and `CommandExtension` never cross the JSON boundary.

## Run

```bash
bun run build:wasm:node        # real engine artifact (repo root)
bun --filter @fazelstudio/nary-sdk example
bun --filter @fazelstudio/nary-sdk typecheck
```
