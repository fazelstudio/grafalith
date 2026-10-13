# Extension Ecosystem — Architecture (Grafalith)

Design contract for the `.grlt` extension ecosystem. The host is the
Tauri desktop app (`apps/desktop`); the authoring surface is
`packages/grafalith-sdk`; native capabilities stay in
`crates/grafalith-sdk`. Adapted from the VSCode extension model for a
Home-first app with three editor kinds (`design`, `whiteboard`, `slides`).

## 1. Audit summary (what existed before this change)

| Area | State | Gap closed here |
|---|---|---|
| Engine/app command registries | Descriptor-driven, validated, unified palette | No `grafalith.*` canonical ids; extension commands invisible to `when` gating |
| Menus, tools, panels, status, activity | Registry-driven, one row template | No home widgets, no per-kind toolbar, no modal/panel custom render contract |
| Extension host | Install, validate, `onStartup`/`onCommand`/`onView`, dialog queue | No `onHome`/`onEditor:*`/`onProject`, no priority/dependency order, no unload-on-editor-close |
| Manifest | Identity + commands/menus/views/keybindings/configuration | No categories, permissions, dependencies, priority, extended contributes |
| SDK window/workspace | Toasts, quick pick, input, confirm, status items, config, memento | No warning level, duration, multi-action, progress, or full `grafalith.*` facade |
| Context keys / events | Ad-hoc `canExecute(ctx)` predicates, selection/document fan-out | No central context service, no `when` evaluator, no `grafalith.*` event bus |
| Rust SDK | Facade over core traits | No manifest/discovery/storage/notification DTOs for the Tauri host |
| Tauri side | Engine + project commands only | No extension discovery/storage IPC |

## 2. Loading strategy and lifecycle

```
[App Launch]
  Phase 1 Core Bootstrap — command, keybinding, settings, context services
  Phase 2 Extension Discovery — scan install dir, validate `.grlt`,
    dependency graph, engines-range gate (refuse, never half-load)
  Phase 3 Home Ready — render Home, activate `onStartup` then `onHome`
[Create/Open Project] → editor kind known
  Phase 4 Editor Bootstrap — load project, activate `onProject`,
    then `onEditor:*` / `onEditor:design|whiteboard|slides`
  Phase 5 Editor Ready — palette populated, UI contributions rendered
[Close editor → Home] — fire `willUnmount`/`didClose`, deactivate
  editor-scoped extensions (subscriptions disposed, views removed)
```

Priority inside each phase: `priority: "high"` first (built-in/core),
then dependency-free, then dependents (topological), then activation-event
match. A slow extension delays only itself: editor entry (`high/project`)
never waits for the `normal/extension` queue (see `startupQueue.ts`).

## 3. Hosting and sandbox decisions

- **Renderer-side extension host, isolated module scope.** Entry modules
  load through a blob-URL ESM import (`loadExtensionModule`); each gets
  its own `ExtensionContext`. There is no iframe/worker boundary today —
  isolation is by API shape, not by process.
- **No direct Tauri API for extensions.** Extensions reach the OS only
  through the SDK (`grafalith.fs`, `grafalith.clipboard`, storage, notifications),
  each gated by manifest `permissions`. The host bridges those calls to
  Tauri commands; undeclared permissions are denied with a typed error.
- **Unload on editor close.** Editor-scoped activations dispose their
  subscriptions and remove contributed views/status items; home-scoped
  extensions stay active. `disposeAll()` runs in reverse install order.
- **State persistence.** `storage` (memento, per-extension) and `settings`
  (namespaced config, localStorage-backed with change events) survive
  restarts; in-memory UI state does not.

## 4. Manifest (`.grlt`) contract

Root file `grafalith.extension.json`, `formatVersion: 1`, suffix `.grlt`.
Required identity: `id`, `publisher`, `name`, `version` (semver `x.y.z`),
`engines.grafalith` (caret `^x.y.z` or `*`). Optional: `description`,
`license`, `categories`, `keywords`, `main` (default `index.js`),
`priority` (`high` for core/built-in), `dependencies`
(`publisher.id` → version range), `permissions`
(`filesystem:read`, `filesystem:write`, `network`, `clipboard`,
`notifications`), `activationEvents`, `contributes`.

Activation events: `onStartup`, `onHome`, `onProject`,
`onEditor:*`, `onEditor:design`, `onEditor:whiteboard`,
`onEditor:slides`, `onCommand:<id>`, `onView:<id>`. No events means
eager (actives on every trigger, used by built-ins).

Contributes: `commands`, `menus` (menubar, canvas/layers/statusbar/
activity/home context, commandPalette, select lists), `keybindings`,
`configuration` (settings), `activityBarItems`, `statusBarItems`,
`panels`, `modals`, `toolbarItems`, `editorTools` (per kind),
`themes`, `diagramNodes`, `assetProviders`, `homeWidgets`,
`projectTemplates` (legacy `views`/`activity`/`panels`/`status`/`tools`
aliases keep working).

## 5. API surface (`grafalith.*`)

One facade, many namespaces — see `packages/grafalith-sdk/src/grafalith.ts`:

`commands`, `events`, `ui.menuBar`, `ui.activityBar`, `ui.statusBar`,
`ui.contextMenu`, `ui.toolbar`, `ui.panel`, `ui.modal`,
`ui.notification` (toast, progress, status message), `ui.quickInput`,
`ui.commandPalette`, `settings`, `keybindings`, `workspace`, `editor`,
`canvas`, `diagram`, `assets`, `storage`, `context`, `extensions`,
`env`, `clipboard`, `fs`.

Rules: command ids are `grafalith.<scope>.<section>.<action>`
(lowercase, dot-separated); built-ins register on the same bus as
extensions; every registration returns a `Disposable`; `when` clauses
evaluate against the central context-key service
(`grafalith.context.screen`, `editorType`, `hasActiveProject`,
`selectedCount`, `activeTool`, `layerSelected`, …).

## 6. Built-in events

`grafalith.app.ready`, `app.beforeQuit`, `home.ready`,
`project.willOpen`, `project.didOpen`, `project.willClose`,
`project.didClose`, `editor.didMount`, `editor.willUnmount`,
`editor.tool.didChange`, `canvas.selection.didChange`,
`layer.didAdd`, `layer.didRemove`, `layer.didChange`,
`settings.didChange:<key>`, `extension.didActivate:<id>`,
`extension.didDeactivate:<id>`, `extension.didFail:<id>`.
