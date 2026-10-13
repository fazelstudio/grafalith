# Hello World extension (template)

Minimal `.grlt` extension: one command (`acme.hello.say`), one canvas
context-menu row, one keybinding, one setting, one toast, one output
channel. Copy this folder and rename the `acme` namespace to yours.

## Manifest field guide (`manifest.grlt.json`)

Rename to `grafalith.extension.json` at the zip root when packing.

| Field | Required | Rule |
|---|---|---|
| `formatVersion` | yes | Must be `1` (carried in content, never in the `.grlt` suffix). |
| `id` | yes | Lowercase `publisher.extension-name` (`[a-z0-9._-]`). |
| `publisher` | yes | Non-empty namespace; install id is `publisher.id`. |
| `name` | yes | Non-empty display name. |
| `version` | yes | Semver `x.y.z`. |
| `description` | no | Short text shown in the Extension Manager. |
| `license` | no | SPDX id, e.g. `MIT`. |
| `homepage` / `repository` | no | Links shown in the Extension Manager. |
| `engines.grafalith` | yes | Range (`^0.1.0` or `*`); mismatches refuse install, never half-load. |
| `categories` | no | e.g. `tools`, `shapes`, `importers`, `exporters`, `styles`, `fonts`. |
| `main` | no | Entry path (default `index.js`); must export `activate()`. |
| `priority` | no | `"high"` runs first in each phase (built-ins); default normal. |
| `dependencies` | no | `publisher.id` → range; missing/circular deps skip with a toast. |
| `permissions` | no | `notifications`, `clipboard`, `filesystem:read/write`, `network`. Undeclared clipboard/fs access is denied; undeclared notifications warn. |
| `activationEvents` | no | `onStartup`, `onHome`, `onProject`, `onEditor:design\|whiteboard\|slides\|*`, `onCommand:<id>`, `onView:<id>`. Absent means eager. |
| `contributes` | no | `commands`, `menus`, `keybindings`, `configuration`, `activityBarItems`, `statusBarItems`, `panels`, `modals`, `toolbarItems`, `editorTools` (per kind), `themes`, `diagramNodes`, `assetProviders`, `homeWidgets`, `projectTemplates`. |

## Status lifecycle

`DISCOVERED → VALIDATING → VALID → LOADING → ACTIVE`, with failure
states (`INVALID_MANIFEST`, `INCOMPATIBLE_VERSION`, `MISSING_DEPENDENCY`,
`CIRCULAR_DEPENDENCY`, `LOAD_FAILED`, `INVALID_ENTRY`,
`ACTIVATION_FAILED`, `ACTIVATION_TIMEOUT`) shown in the Extension
Manager and persisted across restarts. `DISABLED` stays skipped until
you re-enable. One failing extension never breaks the app or others.

## Layout

- `manifest.grlt.json` — copy to `grafalith.extension.json` at the zip root.
- `src/index.ts` — builds to `dist/index.js` (the manifest `main`).

## Pack and install

```bash
npm run build
# zip so the root holds grafalith.extension.json + dist/index.js, then
# rename to .grlt and install from the palette (Install extension package)
```

## Test and debug

- Open the Extension Manager to see status, enable/disable/reload
  without restarting, and jump to your Output Channel.
- System log: palette → `grafalith.output.showSystem` (`Grafalith — Extensions`).
- Dev hot-reload: the host re-activates your extension on file change;
  failures leave it disabled with a toast until the next good reload.
