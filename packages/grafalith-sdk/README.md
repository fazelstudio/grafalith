# @fazelstudio/grafalith-sdk — TypeScript extension SDK

Build `.grlt` extensions for Grafalith without forking the app or the
engine. If you can write a function and a JSON file, you can ship an
extension: declare what you contribute, implement `activate`, handle
cleanup with disposables.

- Manifest: `src/manifest.ts` — `.grlt` identity
  (`grafalith.extension.json`, format v1), validation, `engines` range gate,
  permissions, activation events.
- Facade: `src/grafalith.ts` — `createGrafalithApi(host)` builds the full
  `grafalith.*` surface (`commands`, `events`, `ui.*`, `settings`,
  `keybindings`, `workspace`, `editor`, `canvas`, `diagram`, `assets`,
  `storage`, `context`, `extensions`, `env`, `clipboard`, `fs`).
- Engine client: `src/client.ts` — `EngineClient` over the JSON protocol.
- Commands: `src/commands.ts` — register/execute/gate with disposables.
- Contributions: `src/contributions.ts` — validate manifest contributions
  against host surfaces.
- Window: `src/window.ts` — notifications (toast, progress, status),
  quick pick, input, dialogs, status bar items (plus a memory adapter).
- Workspace: `src/workspace.ts` — config, events, per-extension memento.
- Context: `src/contextKeys.ts` — context keys + `when`-clause evaluator.
- Events: `src/events.ts` — built-in `grafalith.*` lifecycle event bus.
- Activation: `src/extension.ts` — manifest → activate → dispose, lazy
  triggers (`onStartup`, `onHome`, `onProject`, `onEditor:*`,
  `onCommand`, `onView`), priority + dependency ordering.
- Overlays: `src/extension.ts` (`OverlayRegistry`) — custom canvas layers.
- Disposables: `src/disposable.ts` — `DisposableCollection` + `combineDisposables`
  (push every registration; one bad `dispose()` never blocks teardown).
- Output: `src/output.ts` — `OutputChannel` + memory adapter
  (`context.createOutputChannel(name)`; system id `Grafalith — Extensions`).
- Template: `templates/basic-extension/` — copy-paste starter.
- Example: `example/toolbar-extension.ts` — runnable toolbar + overlay.

## Design-domain namespaces (`createGrafalithApi`)

Infrastructure: `commands` (register/execute/getAll/unregister/has/
onDidExecute), `events` (on/emit/off), `context` (set/get/onDidChange/
`when` matching), `settings`, `keybindings`, `storage`
(get/set/delete/clear), `extensions`
(get/getAll/onDidActivate/onDidDeactivate/onDidFail), `env` (incl.
`isDev`), `clipboard`, `fs`.

UI shell: `ui.menuBar` (addMenu/addMenuItem/addSeparator), `ui.activityBar`
(add/remove/setBadge), `ui.statusBar` (add/remove/setText/setTooltip),
`ui.commandPalette` (getAll/addItem/removeItem), `ui.panel`
(register/show/hide/toggle), `ui.modal`
(show/showAlert/showConfirm/showCustomModal/registerCustomModal),
`ui.contextMenu` (addItem/addSeparator), `ui.notification`
(toast/progress/statusMessage/dismissAll), `ui.quickInput`.

Design domain: `canvas`
(getViewport/addOverlay/getSelectedObjects/onDidChangeSelection/
onDidChangeViewport), `tools`
(registerTool per `design|whiteboard|diagram|all`, set/get/onDidChange),
`shapes` (registerShapeType/getShapeTypes), `diagram`
(registerNodeType/registerEdgeType/getNodeTypes/getEdgeTypes),
`properties` (registerInspectorSection/onDidChangeSelection), `assets`
(registerAssetProvider/getAssets), `styles`
(registerColorPalette/registerGradientPreset/registerStylePreset),
`fonts` (registerFontProvider), `snap` (registerSnapBehavior), `format`
(registerImporter/registerExporter), `workspace`
(getCurrentProject/getEditorType/onDidOpenProject/onDidCloseProject),
`editor`, `home` (registerProjectTemplate/addHomeWidget), `output`
(createOutputChannel). New node types and history-integrated commands
stay Rust — see below.

## Boundary rule

TypeScript extensions contribute **UI, tools buttons, panels, canvas
overlays, and automation**. New **node types** and history-integrated
**commands** stay Rust (`crates/grafalith-sdk`, `examples/ext-sticker`):
custom payloads never cross the JSON boundary.

## Quick start (5 minutes)

1. Copy `templates/basic-extension/` and edit `manifest.grlt.json`:
   rename to `grafalith.extension.json` at the zip root when packing.

```json
{
  "formatVersion": 1,
  "id": "hello-world",
  "publisher": "acme",
  "name": "Hello World",
  "version": "1.0.0",
  "engines": { "grafalith": "^0.1.0" },
  "main": "./dist/index.js",
  "activationEvents": ["onStartup"],
  "contributes": {
    "commands": [{ "command": "acme.hello.say", "title": "Say hello" }],
    "menus": { "canvas.context": [{ "command": "acme.hello.say" }] }
  }
}
```

2. Implement `activate` (see `templates/basic-extension/src/index.ts`):

```ts
import type { ExtensionContext } from "@fazelstudio/grafalith-sdk";

export function activate(context: ExtensionContext): void {
  const disposable = context.commands?.registerCommand("acme.hello.say", () => {
    context.window?.showNotification("Hello from my extension", { level: "success" });
  });
  if (disposable) context.subscriptions.push(disposable);
}
```

3. Pack: zip with `grafalith.extension.json` + `dist/index.js` at the root,
   rename to `.grlt`, install from the palette (`Install extension package`).

## Activation events

| Event | Fires when |
|---|---|
| `onStartup` | App boot (background queue, never blocks projects) |
| `onHome` | Home screen renders |
| `onProject` | A project opens |
| `onEditor:*` / `onEditor:design\|whiteboard\|diagram` | Editor mounts (wildcard or kind) |
| `onCommand:<id>` | First execution of the command (lazy) |
| `onView:<id>` | First reveal of the view (lazy) |

No `activationEvents` means eager (activates on every trigger).
`priority: "high"` runs first in each phase; `dependencies` order the rest.

## Contribution points

`commands`, `menus` (menubar, canvas/layers/statusbar/activity/home
context, commandPalette, select lists), `keybindings`, `configuration`
(settings), `activityBarItems`, `statusBarItems`, `panels`, `modals`,
`toolbarItems`, `editorTools` (per kind: `design`, `whiteboard`,
`diagram`), `themes`, `diagramNodes`, `assetProviders`, `homeWidgets`,
`projectTemplates` (create-new flow).

## Command ids and `when` clauses

Use `grafalith.<scope>.<section>.<action>` (lowercase, dot-separated),
e.g. `grafalith.home.project.create.design`. Gate visibility with `when`
against context keys (`grafalith.context.screen`,
`grafalith.context.editorType`, `grafalith.context.hasActiveProject`,
`grafalith.context.selectedCount`, `grafalith.context.activeTool`,
`grafalith.context.layerSelected`):

```json
{ "command": "acme.export.svg", "group": "export", "when": "grafalith.context.screen == editor" }
```

## Notifications, progress, quick input

```ts
grafalith.ui.notification.showToast({ type: "warning", message: "Unsaved changes", duration: 5000, source: "acme.pack" });
await grafalith.ui.notification.showProgress("Exporting", async (fraction) => { /* … */ fraction(0.5); });
const pick = await grafalith.ui.quickInput.showQuickPick([{ id: "a", label: "Poster" }], "Choose a template");
const name = await grafalith.ui.quickInput.showInputBox("Project name", "Untitled");
```

Permissions: `notifications` (toasts), `clipboard` (clipboard),
`filesystem:read`/`filesystem:write` (fs), `network` (fetch). Undeclared
access is denied with a typed error.

## Run SDK tests

```bash
cd packages/grafalith-sdk && bun test src/
```
