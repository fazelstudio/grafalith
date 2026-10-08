# Extension Guide

Audience: third-party developers (a) adding engine capabilities — node
types, tools, commands, renderers, importer/exporters — without modifying
engine sources, and (b) shipping desktop extensions without forking
`apps/desktop`.

> Vocabulary: an installable unit users download is an **Extension** (`.onry`,
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
import { JsEngine } from "@fazelstudio/opennary";

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
from opennary import Engine

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
use opennary_bindings::Engine;

let mut engine = Engine::new();
let res = engine.apply_ops(vec![opennary_bindings::BatchOp::Select {
    ids: vec!["rect-1".to_string()],
}]);
assert_eq!(res.applied, 1);
```

Subscribe to changes by draining events per frame (`session.drainEvents`) and
re-querying `view.renderModel` + `session.state` — one crossing per frame.

## 2. External Rust crate: new node type + tool + command

1. Depend on `opennary-core` (path or published version) — never copy engine files.
2. Implement `ShapeExtension` (behavior mirrors `extension_example.rs`):

```rust
use opennary_core::{ShapeExtension, Element, EngineResult};

pub struct StickerShape;

impl ShapeExtension for StickerShape {
    fn type_name(&self) -> &str { "acme.sticker" }
    fn bounds(&self, el: &Element) -> Option<opennary_core::geometry::Bounds> {
        Some(el.bounds())
    }
    fn hit_test(&self, el: &Element, x: f64, y: f64) -> Option<bool> {
        Some(opennary_core::hit_test::hit_test_element(el, x, y))
    }
}
```

3. Ship a `Extension` declaring capabilities through `ExtensionContext`
   (`tools`, `shapes`, `commands`, `serializers`, `importers`, `exporters`),
   with `ExtensionMetadata` for the compatibility check.
4. Register without touching core:

```rust
use opennary_core::{ExtensionRegistry, ShapeRegistry};

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
  Never add raster code to `opennary-core`.
- Importer/exporter: implement `SerializerExtension`/`ImporterExtension`/
  `ExporterExtension`; JSON stays the interchange language.

## 4. Worked examples in this repo

- `examples/ext-sticker/` — standalone workspace crate: sticker node type +
  tool + history-tracked command. Run:
  `cargo test --manifest-path examples/ext-sticker/Cargo.toml`.
- `examples/custom-button/` — one toolbar scenario on three hosts, each
  against a real built artifact.
- `generated/opennary-commands.d.ts` + `generated/opennary.pyi` — produced by
  `scripts/gen_command_bindings.py` from the single 79-op table
  (CI runs `--check`).

## 5. TypeScript SDK

`packages/opennary-sdk` is the extension surface for TypeScript: `.onry`
manifests (`manifest.ts`), the extension command bus (`commands.ts`),
contribution validation (`contributions.ts`), window surfaces
(`window.ts`: notifications, quick pick, input, dialogs, status bar),
workspace surfaces (`workspace.ts`: config, events, memento), activation
(`extension.ts`: eager plus lazy `onStartup`/`onCommand`/`onView`), tool
contributions, and overlay renderers over a typed engine client. It drives
the real engine through the same JSON protocol — no engine changes, no
  second module. Full authoring contract: [§6 below](#6-desktop-extension-packages-onry).

Boundary rule: TypeScript extensions contribute UI, tools, panels,
overlays, and automation. New node types and history-integrated commands
stay Rust (`crates/opennary-sdk`, `examples/ext-sticker`) because `Custom`
payloads and `CommandExtension` never cross the JSON boundary.

---

## 6. Desktop extension packages (`.onry`)

Audience: third-party developers shipping desktop extensions without forking
`apps/desktop`. The desktop owns all UI chrome; the engine owns document
state; extensions contribute through registries.

### 6.1. Package identity

- Suffix: `.onry` (locked; `.opn` collides with manufacturing/chess
  software, `.ony` collides with the `ony` CLI/product family).
- Format: zip archive. Root file: `opennary.extension.json` with
  `formatVersion: 1` carried inside the content, never in the suffix.
- Install: unpack per `publisher.id` into the user extension directory.
  Validation lives in two lockstep mirrors: `packages/opennary-sdk/src/manifest.ts`
  (`validateOnryManifest`, `satisfiesEngines`) for authors and
  `apps/desktop/src/platform/extensions/extensionManifest.ts` for the host.
  Both carry the same `ONRY_FORMAT_VERSION`.

Minimal manifest:

```json
{
  "formatVersion": 1,
  "id": "sticker",
  "publisher": "acme",
  "name": "Sticker Pack",
  "version": "1.0.0",
  "engines": { "opennary": "^0.1.0" },
  "main": "./dist/extension.js",
  "activationEvents": ["onStartup"],
  "contributes": {
    "commands": [{ "command": "acme.sticker.create", "title": "Create sticker" }],
    "menus": { "canvas.context": [{ "command": "acme.sticker.create" }] },
    "activity": [{ "id": "acme.stickers", "title": "Stickers" }]
  }
}
```

`engines.opennary` uses caret semantics (`^0.1.0` means `>=0.1.0 <0.2.0`).
Incompatible extensions are refused at install, never half-loaded.

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

Relevance notes (OpenNary, not VSCode):

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

- `extensionManifest.ts` — identity validation.
- `onryArchive.ts` — dependency-free zip reader (stored + deflated) and
  manifest/file extraction, plus a stored-zip builder for tests.
- `extensionContributions.ts` — runtime stores: JS command handlers,
  extension menu rows per location, view-surface metadata, status text and
  visibility, install records, per-extension configuration declarations.
- `extensionContext.ts` — per-extension activation context in the SDK shape:
  command bus, window (leveled toasts with one primary action, quick
  pick, input, confirm dialogs, status bar items), workspace (namespaced
  config with change events, selection/document event fan-out, memento).
- `extensionDialogs.ts` + `app/shell/ExtensionDialogHost.tsx` — single-flight
  modal queue rendered once in the application shell.
- `extensionHost.ts` — `DesktopExtensionHost.install()` (validate + stage),
  `installFromBytes()` (unzip + load the `main` entry via blob import),
  `activateByTrigger()` (startup/command/view), `executeCommand()` (lazy
  `onCommand` activation on first use), `enqueueStartupActivation()`
  (normal priority, `extension` tag), `emitSelection`/`emitDocument` fan-out,
  `disposeAll()` (reverse order). `getExtensionHost()` is the window-shared
  singleton; the editor sets its toast notifier on mount.

Installing from the UI: the palette command `extension.installFromFile`
(`Install extension package`) opens an `.onry` file picker and stages the
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
