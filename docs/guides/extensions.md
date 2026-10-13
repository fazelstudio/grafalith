# Extension Guide

Audience: third-party developers (a) adding engine capabilities — node
types, tools, commands, renderers, importer/exporters — without modifying
engine sources, and (b) shipping desktop extensions without forking
`apps/desktop`.

> Vocabulary: an installable unit users download is an **Extension** (`.grlt`,
> see §6). `*Extension` names are also the engine capability traits
> (`ShapeExtension`, `CommandExtension`, …) — the Rust interfaces a native
> extension implements. Native (Rust) and desktop (TypeScript) extensions
> share the product word by design.

Stability markers: `stable` (frozen), `unstable` (additive growth),
`internal` (do not use).

## 1. Custom UI button calling the engine

Build any UI (React/Vue/vanilla/native WebView/Python Qt) and call commands.
No built-in UI or keymap is required.

TypeScript (WASM), using the string protocol (`stable`):

```ts
import { JsEngine } from "@fazelstudio/grafalith";

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
from grafalith import Engine

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
use grafalith_bindings::Engine;

let mut engine = Engine::new();
let res = engine.apply_ops(vec![grafalith_bindings::BatchOp::Select {
    ids: vec!["rect-1".to_string()],
}]);
assert_eq!(res.applied, 1);
```

Subscribe to changes by draining events per frame (`session.drainEvents`) and
re-querying `view.renderModel` + `session.state` — one crossing per frame.

## 2. External Rust crate: new node type + tool + command

1. Depend on `grafalith-core` (path or published version) — never copy engine files.
2. Implement `ShapeExtension` (behavior mirrors `extension_example.rs`):

```rust
use grafalith_core::{ShapeExtension, Element, EngineResult};

pub struct StickerShape;

impl ShapeExtension for StickerShape {
    fn type_name(&self) -> &str { "acme.sticker" }
    fn bounds(&self, el: &Element) -> Option<grafalith_core::geometry::Bounds> {
        Some(el.bounds())
    }
    fn hit_test(&self, el: &Element, x: f64, y: f64) -> Option<bool> {
        Some(grafalith_core::hit_test::hit_test_element(el, x, y))
    }
}
```

3. Ship a `Extension` declaring capabilities through `ExtensionContext`
   (`tools`, `shapes`, `commands`, `serializers`, `importers`, `exporters`),
   with `ExtensionMetadata` for the compatibility check.
4. Register without touching core:

```rust
use grafalith_core::{ExtensionRegistry, ShapeRegistry};

let mut preg = ExtensionRegistry::new();
preg.register(Box::new(AcmeExtension))?;
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

## 3. Renderer / importer / exporter capabilities

- Renderer: consume `view.renderModel` DTOs host-side (Canvas2D today).
  Never add raster code to `grafalith-core`.
- Importer/exporter: implement `SerializerExtension`/`ImporterExtension`/
  `ExporterExtension`; JSON stays the interchange language.

## 4. Worked examples in this repo

- `examples/ext-sticker/` — standalone workspace crate: sticker node type +
  tool + history-tracked command. Run:
  `cargo test --manifest-path examples/ext-sticker/Cargo.toml`.
- `examples/custom-button/` — one toolbar scenario on three hosts, each
  against a real built artifact.
- `generated/grafalith-commands.d.ts` + `generated/grafalith.pyi` — produced by
  `scripts/gen_command_bindings.py` from the single 88-op table
  (CI runs `--check`).

## 5. TypeScript SDK

`packages/grafalith-sdk` is the extension surface for TypeScript: `.grlt`
manifests (`manifest.ts`), the extension command bus (`commands.ts`),
contribution validation (`contributions.ts`), window surfaces
(`window.ts`: notifications, quick pick, input, dialogs, status bar),
workspace surfaces (`workspace.ts`: config, events, memento), activation
(`extension.ts`: eager plus lazy `onStartup`/`onCommand`/`onView`), tool
contributions, and overlay renderers over a typed engine client. It drives
the real engine through the same JSON protocol — no engine changes, no
  second module. Full authoring contract: [§6 below](#6-desktop-extension-packages-grlt).

Boundary rule: TypeScript extensions contribute UI, tools, panels,
overlays, and automation. New node types and history-integrated commands
stay Rust (`crates/grafalith-sdk`, `examples/ext-sticker`) because `Custom`
payloads and `CommandExtension` never cross the JSON boundary.

---

## 6. Desktop extension packages (`.grlt`)

Audience: third-party developers shipping desktop extensions without forking
`apps/desktop`. The desktop owns all UI chrome; the engine owns document
state; extensions contribute through registries.

### 6.1. Package identity

- Suffix: `.grlt` (locked; `.opn` collides with manufacturing/chess
  software, `.ony` collides with the `ony` CLI/product family).
- Format: zip archive. Root file: `grafalith.extension.json` with
  `formatVersion: 1` carried inside the content, never in the suffix.
- Install: unpack per `publisher.id` into the user extension directory.
  Validation lives in two lockstep mirrors: `packages/grafalith-sdk/src/manifest.ts`
  (`validateGrltManifest`, `satisfiesEngines`) for authors and
  `apps/desktop/src/platform/extensions/extensionManifest.ts` for the host.
  Both carry the same `GRLT_FORMAT_VERSION`.

Minimal manifest:

```json
{
  "formatVersion": 1,
  "id": "sticker",
  "publisher": "acme",
  "name": "Sticker Pack",
  "version": "1.0.0",
  "engines": { "grafalith": "^0.1.0" },
  "main": "./dist/extension.js",
  "priority": "normal",
  "permissions": ["notifications"],
  "activationEvents": ["onStartup", "onHome", "onEditor:design"],
  "contributes": {
    "commands": [{ "command": "acme.sticker.create", "title": "Create sticker" }],
    "menus": { "canvas.context": [{ "command": "acme.sticker.create" }] },
    "activity": [{ "id": "acme.stickers", "title": "Stickers" }]
  }
}
```

`engines.grafalith` uses caret semantics (`^0.1.0` means `>=0.1.0 <0.2.0`).
Incompatible extensions are refused at install, never half-loaded.
Activation events: `onStartup`, `onHome`, `onProject`,
`onEditor:*`, `onEditor:design`, `onEditor:whiteboard`,
`onEditor:slides`, `onCommand:<id>`, `onView:<id>` (see
`docs/guides/extension-ecosystem.md` for the phase order, priority, and
dependency rules). Permissions gate `clipboard`, `filesystem`, `network`,
and `notifications` — undeclared access fails with a typed error.

### 6.2. Contribution points (all command-backed)

Every surface renders from a registry through one row template, so an
extension never patches shell markup:

| Surface | Registry | Template |
|---|---|---|
| Menubar, canvas/layers/statusbar/activity/home context, select lists | `registries/menus.ts` (`menusFor(location)`) + extension rows (`extensionMenuRowsFor`) | `ui/primitives/actionRow.tsx` (`ActionRow`), menubar `RegistryRow` |
| Engine intents | `registries/commands.ts` (`executeCommand`) | `PaletteCommandRow` |
| Host chrome (navigation, project, panel, dialog, window, view, settings) | `registries/appCommands.ts` (`executeAppCommand`) | `ActionRow` |
| Extension JS commands | `platform/extensions/extensionContributions.ts` + `extensionHost.ts` | palette rows, context-menu intents |
| Activity icons, settings section icons | `ui/iconRegistry.tsx` (`resolveIcon`) | rail/sidebar buttons |
| Tools, panels, status items, settings sections/tabs | `registries/tools.ts`, `panels.ts`, `status.ts`, `features/settings/settingsDescriptors.ts` | toolbar, dock, status bar, settings sidebar |
| Modal/dialog, toast, quick pick, input | SDK `window.ts` (`WindowApi`) bridged to `Dialog` + `ToastProvider` + palette | host dialogs |

Rules: one user intent is one command id (`namespace.action`); enablement is
a pure `canExecute` predicate, never an ad-hoc `disabled` prop; icons resolve
through `iconIds()` so a typo degrades to a text row. Menu rows support
`parent` for menu/sub-menu nesting; the File > New submenu is kind-driven
from `projectKindRegistry`.

Relevance notes (Grafalith, not VSCode):

- Modal/dialog: yes — `dialog.openSettings` / `dialog.openQuickSwitcher`
  host commands plus SDK `showDialog`; the settings page and the editor
  settings modal render one `SettingsContent`, so extension `configuration`
  contributions land in both at once.
- Select menus: yes — the `Select` primitive is template-driven and
  `select.list` menu rows (e.g. settings sections) resolve through commands.
- Status bar: yes — items are registry-ordered; selection/tool/zoom clicks
  run commands (`selectAll`, quick switcher, `resetZoom`); extensions add ordered
  items through the same status registry.
- Settings: yes — sections and controls are registry-driven with platform
  predicates; section switches run through `settings.openSection`.
- Terminal/debug/source-control views: no — out of scope for a design canvas.

### 6.3. Host lifecycle (`apps/desktop/src/platform/extensions/`)

- `extensionManifest.ts` — identity validation (plus `description`,
  `license`, `categories`, `keywords`, `priority`, `dependencies`,
  `permissions`, extended activation events).
- `grltArchive.ts` — dependency-free zip reader (stored + deflated) and
  manifest/file extraction, plus a stored-zip builder for tests.
- `extensionContributions.ts` — runtime stores: JS command handlers,
  extension menu rows per location, view-surface metadata, status text and
  visibility, install records, per-extension configuration declarations,
  per-kind editor tools (`extensionEditorToolsFor`).
- `homeContributions.ts` — Home widgets, project templates per kind, and
  create-new interceptors (extensions extend Home without shell changes;
  unload removes their entries).
- `extensionContext.ts` — per-extension activation context in the SDK shape:
  command bus, window (leveled toasts with actions/duration/source,
  `showToast`, `showProgress`, `showStatusMessage`, quick pick, input,
  confirm dialogs, status bar items), workspace (namespaced config with
  change events, selection/document/viewport/open/close/editor event
  fan-out, memento aliased as `storage`), `env`, permission-gated
  `clipboard`, sandboxed `fs` (denies without the manifest permission).
- `extensionDialogs.ts` + `app/shell/ExtensionDialogHost.tsx` — single-flight
  modal queue rendered once in the application shell.
- `extensionHost.ts` — `DesktopExtensionHost.install()` (validate + stage),
  `installFromBytes()` (unzip + load the `main` entry via blob import),
  `activateByTrigger()` (startup/home/project/editor/command/view, high
  priority first then dependency order), `activateHome()`,
  `activateProject()`, `activateEditor(kind)`, `executeCommand()` (lazy
  `onCommand` activation on first use), `enqueueStartupActivation()`
  (normal priority, `extension` tag), `emitSelection`/`emitDocument`/
  `emitProjectClosed`/`emitActiveEditor` fan-out,
  `deactivateEditorScope()` (unload editor-scoped extensions on return
  Home, reverse order), `disposeAll()` (reverse order).
  `getExtensionHost()` is the window-shared singleton; the editor sets its
  toast notifier on mount.
- `platform/context/contextKeys.ts` — central context-key service plus the
  `when`-clause evaluator (`grafalith.context.screen`, `editorType`,
  `hasActiveProject`, `selectedCount`, `activeTool`, `layerSelected`).
- `platform/events/appEvents.ts` — typed `grafalith.*` lifecycle event bus
  (app, home, project, editor, canvas, layer, settings families).
- `platform/commands/canonicalIds.ts` — canonical
  `grafalith.<scope>.<section>.<action>` ids aliased to the engine/app
  registries (palette population, docs, diagnostics).
- `app/shell/ToastProvider.tsx` — leveled toasts (`info`/`success`/
  `warning`/`error`) with actions, duration, source attribution, and
  dismiss-all (wired to `grafalith.view.notification.dismissAll`).
- `src-tauri/src/extensions.rs` — native side: extension directory
  discovery plus per-extension JSON storage (`extension_list`,
  `extension_storage_get`, `extension_storage_set` Tauri commands).

Installing from the UI: the palette command `extension.installFromFile`
(`Install extension package`) opens an `.grlt` file picker and stages the
package through `installFromBytes`; success and validation errors both
report through toasts. Entry modules are plain ESM exposing `activate`
(and optionally `deactivate`).

Rendered today: extension commands (palette, canvas/layers context menus),
menu placements into every registry location, activity-rail icons (click
runs the contributed command or lazily activates the view), status bar
items (dynamic text, show/hide, click commands), toasts with one primary
action, and modal quick pick/input/confirm. Extension panels, custom tools,
and custom views are stored and validated; their custom React rendering
stays on the roadmap behind a component sandbox. Extension `configuration`
declarations are collected per install (`extensionConfigurations()`) for the
settings surface to render next.

### 6.4. Startup and loading priority

`platform/boot/startupQueue.ts` (`createStartupQueue`) orders boot work:

1. `critical/boot` — theme, locale, window reveal.
2. `high/project` — home list, editor project open. Never waits for extensions.
3. `normal/extension` — extension activation. Paused while a project opens,
   resumed after the session reports ready.
4. `low/maintenance` — trash purge, telemetry.

Entering the editor pauses the `extension` tag, drains `project` work first,
then resumes extensions in the background. A slow extension therefore delays only
itself, never project entry.

### 6.5. Failure isolation, statuses, and output channels

Every phase failure is per-extension: the host toasts the reason, marks a
status, writes detail to the extension's output channel plus the system
channel (`Grafalith — Extensions`), and keeps the app and every other
extension running.

Statuses (`platform/extensions/extensionStatus.ts`, persisted across
restarts so known-bad extensions skip quietly next launch): `DISCOVERED →
VALIDATING → VALID → LOADING → ACTIVE`, with `INVALID_MANIFEST`,
`INCOMPATIBLE_VERSION`, `MISSING_DEPENDENCY`, `CIRCULAR_DEPENDENCY`
(topological `dependencyResolver.ts`: missing/blocked/circular/version
reports), `LOAD_FAILED`, `INVALID_ENTRY`, `ACTIVATION_FAILED`,
`ACTIVATION_TIMEOUT` (5 s deadline), `DISABLED` (user, stays skipped
until re-enabled), `DEACTIVATED` (editor close / shutdown).
`deactivate()` errors and timeouts (3 s) force-dispose subscriptions and
continue teardown.

Extension Manager (`platform/extensions/extensionManager.ts`,
`features/extension-manager/ExtensionManagerPanel.tsx`): list with live
status, `all/active/failed` filters, Enable / Disable / Reload /
Uninstall / Output per row — all without restarting
(`grafalith.extensions.manager.open`, `.manager.showAll/.manager.showActive`/
`.manager.showFailed`, per-id `.enable:<id>` / `.disable:<id>` /
`.reload:<id>` / `.uninstall:<id>` / `.showOutput:<id>`,
`grafalith.extensions.output.showSystem`; the three-part
`grafalith.extensions.showAll/.showActive/.showFailed` and
`grafalith.output.showSystem` forms stay working as aliases).
The shell mounts the manager and the output panel once
(`app/shell/ExtensionPanelsHost.tsx`, driven by
`platform/extensions/extensionPanels.ts`); palette entries
(`extension.openManager`, `output.showSystem`) open the same dialog.
Dev hot-reload (`watchForDevReload`, polling `devReloadWatcher.ts` with
an injectable fingerprint source plus a Tauri-fs wiring snippet) re-activates
on file change and leaves failures disabled with a toast until the next
good reload.
Extension-contributed UI mounts behind `ExtensionErrorBoundary` so one
crashing widget unmounts to a retry card instead of taking down Home or
the editor.

Static manifest `contributes` auto-register at install
(`platform/extensions/manifestContributions.ts`): menus, views/activity/
panels/status/tools, per-kind editor tools (rendered in the toolbar via
`features/editor/ExtensionTools.tsx`, command-backed with failure
toasts), Home widgets (cards opening the owner's output) and project
templates (create a blank scene of their kind; `interceptProjectCreate`
redirects run first), plus a per-package catalog for themes/diagram
nodes/asset providers. One invalid entry skips alone; disable/uninstall/
editor-scope unload remove exactly their owner's rows. Commands still
need handlers from `activate()`; keybindings stay inert until shortcut
dispatch supports overrides. Extension `configuration` renders in
Settings → Extensions (`settings.extensions.*` locale keys, `#/settings/
extensions` route) bound to the same `extension:<package>:<key>`
localStorage keys the context reads. The editor and Home keep central
context keys synced (`syncEditorState` in `EditorScreen`/`HomeScreen`)
so `when` clauses gate on live state; project open/close and editor-kind
switches fan out to extension workspaces. Core bootstrap runs before
`App` loads (`platform/boot/coreBootstrap.ts` + `main.tsx`): any Phase 1
service failure renders the dependency-free fatal dialog
(`app/shell/FatalBootDialog.tsx`, console-logged) and the app never
proceeds half-broken.

Output channels (`platform/extensions/outputChannel.ts`): extensions log
via `context.createOutputChannel(name)`; the bottom `OutputPanel`
switches between every extension channel and the system channel, which
records discovery, validation, activation order, and every skip reason.
Permissions: undeclared `clipboard`/`filesystem` access throws a typed
deny (logged to the channel); undeclared `notifications` warns in the
channel but still delivers so activation never crashes on a missing
declaration.
