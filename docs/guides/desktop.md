# Desktop Guide — Grafalith reference host

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
- Each frame polls one small shape (`sessionState`, now carrying the scene
  nonce). The full `renderModel` is re-queried only when something
  paint-relevant changed (scene nonce, selection, viewport, edited element,
  assets), and the canvas repaints only when that key or a transient overlay
  (drag ghost, guides, size) changed. Idle frames poll at a slow cadence and
  inputs flag the next frame directly; caret moves and draft typing cross
  cheaply and never repaint the canvas. Wheel deltas coalesce to one op per
  frame; hover moves with no gesture cross nothing at all.
- Drags never write the document per move: `pointerMove` only feeds the
  read-only `previewMove`/`previewResize`/`previewRotate` queries for a
  host-side ghost, and `pointerUp` commits the new position in one history
  entry (cancelled when the drop is invalid or `Esc` aborts). Snap guides
  and the magnet effect live only for the drag itself and vanish on release;
  while moving, the selection box rides the same preview delta so object and
  box travel as one unit; while resizing, the box morphs onto the preview
  box (with live content for box kinds) and while rotating it takes the
  preview angle.
- The deterministic `RenderModelDto` is rasterized with a single Canvas2D
  canvas and a `requestAnimationFrame` loop.

## UI text

UI strings live in `apps/desktop/src/app/i18n/` with English as the canonical
key set. See [`locale-guide.md`](./locale-guide.md) for layout, rules, and how
to add keys or locales.

## UI foundation

- Semantic UI and canvas interaction tokens are defined in
  `apps/desktop/src/app/theme/tokens.css`; typed theme metadata and shared
  desktop dimensions/timing are in `src/app/theme/tokens.ts`.
- Reusable controls and overlays belong in `apps/desktop/src/ui/primitives/`.
  Use the shared `Dialog`, controls, and error state instead of recreating
  local variants. All hover hints use the single `Tooltip` primitive there:
  pass a localized `t()` string as content and never use the native `title`
  attribute, so the browser default tooltip never appears. The tooltip uses
  the themed elevated surface (dark in dark mode, light in light mode) and
  stays hidden until boot theme and locale are applied, so no
  fallback-colored frame flashes. A bordered pointer nub on the active side
  aims at the hovered control. Placement is viewport-aware (`auto` by
  default; `top` for bottom toolbars, `bottom` for top bars, `right` for
  collapsed rails) and styling follows semantic theme tokens.
- Transient notifications use `ToastProvider`; screens should call
  `useToast()` rather than render their own toast region.
- Editor tools, commands, menus, and panels are registry-driven. New editor
  surfaces should consume those registries and the shared token system.
  Engine intents live in `src/registries/commands.ts` (including targeted
  `selectIds`/`deselect` and per-op `inspector.setBounds/setRotation/setStyle`
  writes); host chrome lives in `src/registries/appCommands.ts`
  (`navigation.*`, `project.*` including card-scoped
  `open/rename/delete/toggleFavorite/create`, `panel.*`, `dialog.*`,
  `notification.*`, `window.*`, `tool.*`, `view.*`, `settings.openSection`).
  Menu placement lives in `src/registries/menus.ts` (`menusFor(location)`)
  covering menubar, canvas/layers/statusbar/activity/home context menus,
  select lists, and settings sections, with `parent` for sub-menu nesting
  and `extensionMenuRowsFor()` for extension rows. Every row renders through the
  single `ActionRow` template in `src/ui/primitives/actionRow.tsx`, and icons
  resolve through `src/ui/iconRegistry.tsx` — never branch on ids in shell
  code. Palette search is unified (`registries/unified.ts`:
  engine + host + extension rows, category grouping, MRU ranking).
- The editor's left and right docks are user-resizable within the shared
  minimum, default, and maximum widths. Their sizes are stored in the
  user-level editor workspace preference, not in project documents; invalid or
  missing values fall back to the default.
- Home navigation only changes the route. The editor session owns the single
  authoritative project-open operation, preventing duplicate storage reads and
  metadata writes during navigation. Boot work is ordered through
  `src/platform/boot/startupQueue.ts`: critical chrome first, project open on
  high priority (never blocked by extensions), extension activation in the
  background (paused during project open, resumed after ready). See
  [`extensions.md`](./extensions.md) for the `.grlt` package format.

## Project opening lifecycle

- Navigation enters the editor immediately and shows the current loading stage
  instead of blocking on the Home screen.
- The editor opens the project in order: read the host payload, validate and
  import it into the engine, then initialize the interactive workspace.
- The Tauri host stores project metadata and documents with a temporary-file
  replacement flow. Windows replaces existing files with an explicit
  destination removal because its standard `rename` operation does not
  overwrite an existing file.
- IPC rejections are normalized from both string and object-shaped Tauri
  errors. When a backend or engine initialization fails, the editor preserves
  the technical detail beneath the localized message so a retry screen is
  actionable instead of collapsing every failure into an unexplained storage
  error.
- Tauri command arguments use the generated camelCase wire shape (for example,
  `sceneJson`), even when the native Rust parameter uses `snake_case`.
- Home project cards render a read-only canvas preview from the stored scene.
  The preview computes scene bounds and fits all visible elements into the
  card, including projects whose objects are far apart; it never imports the
  preview into the active editor engine or updates `lastOpenedAtMs`.
- Home supports a persisted user-level Grid/List view toggle beside the search
  field. Grid is the default; the two icon buttons use accessible labels and
  tooltips rather than repeating long view names in the toolbar.
- The editor opens every project in `select` mode, matching the engine's
  `EditorState` default. Drawing tools are host chrome state and are
  synchronized to the engine; after a shape gesture commits, the host returns
  to `select` so the next pointer action cannot create an accidental second
  object. Double-clicking a toolbar tool (or the palette command
  `tool.toggleSticky`) toggles sticky mode: the tool stays active after
  commit instead of returning to `select`. `Esc` with a non-Select tool and
  no text session also returns to `select`; `Esc` mid-drag cancels the
  gesture. Releasing a drag outside the canvas (over panels, toolbar, or
  outside the window) cancels instead of committing.
- Text editing uses a provisional engine element while the overlay is active.
  The engine commits the provisional creation and text content as one undoable
  entry, or cancels it without leaving an empty element or undo entry when the
  session is committed or cancelled with empty content. While editing, the
  selection clears so no bounding box paints under the caret; the overlay is
  chromeless (caret plus live text only) and committing re-selects the element
  so its box and handles appear when editing ends. Double-clicking a text
  element starts editing even when the press lands on a resize handle of a
  small selected box; single clicks keep handle priority. New text defaults to a
  stroke that contrasts with the canvas background (black on light, white on
  dark, via WCAG luminance); the desktop sends its canvas color in the same
  `configure` batch as the tool switch and the text press, so defaults never
  lag a theme change, and stored elements never change on theme
  switch. The overlay substitutes a contrasting display color when a stored
  stroke has poor contrast, while committed rendering keeps the stored color.
  A fresh empty text whose stroke still has poor contrast (after a raced
  theme sync) is corrected to the contrasting default inside its own creation
  transaction; elements carrying content keep their colors untouched.
  Glyph color is the Stroke field: Fill paints only the box behind the glyphs
  and never recolors the text itself. A text box outline has its own Border
  field (width and dash reuse the stroke width/style); empty or transparent
  clears it. The background and the outline follow the content-driven box, so
  new lines grow them automatically. `Enter` (and `Shift+Enter`, identically) inserts a newline; commit
  is `Esc`, outside-click, blur, or tool/selection change. Native edits the
  key handler never sees (cut, mobile keyboards, autofill) reconcile onto the
  engine draft through the overlay change handler. Keystrokes plan against
  optimistic sends (not stale frames) and apply over the native caret range,
  so typing replaces the selection (select-all then type included) and fast
  typing composes in order; Ctrl+A/C/X stay native to the box while editor
  commands stay scoped out. Arrow keys, Home/End, clicks, and the overlay
  change all sync the caret through one idempotent path, and the mirror
  defers to fresh user motion so stale frames never pin it. With the text
  tool, single and double click on an existing text both edit it
  (pixel-refined caret at the click); a click elsewhere starts a
  fresh caret. The overlay lifts half a leading so its first baseline matches
  the committed render — no jump on commit. Text selections
  show only the left/right resize handles and resizing never scales the font;
  height follows the content (`lines × line height`). Corner drags on text
  scale the font by the width ratio (the box follows the content at the new
  size); edge drags only change the width.
- Canvas cursors follow the gesture, all theme-contrasted: default arrow on
  empty canvas and during draw/marquee drags, I-beam with the text tool,
  crosshair on shape tools, pointer over objects and all native buttons,
  directional resize arrows over selection handles (refresh-style ring over
  the rotate handle, kept during the rotate drag), and the held hand while
  moving (including a 500 ms long-press on an object) or panning.
- Editor tools are presented in a compact bottom floating toolbar. Frequently
  used tools remain visible, while less common tools are available from the
  upward `More tools` menu. The tool buttons are icon-only with localized
  tooltip and accessible names; history/destructive commands such as
  undo, redo, delete, and duplicate stay in command surfaces rather than
  occupying the tool dock. Dock widths use a user-level default and
  min/max clamp, prevent horizontal overflow, and use themed thin scrollbars
  for overflow areas.
- The editor status bar has registry-defined left and right regions. Built-in
  engine/protocol indicators are on the left, while selection/tool/zoom
  indicators are on the right and click through to commands (`selectAll`,
  quick switcher, `resetZoom`); installed extensions add ordered status items
  (dynamic text, show/hide, click commands) through the same registries
  without changing the shell layout.
- Toasts carry a level (`info`/`success`/`error`) and one primary action
  button; extension notifications map their first action onto it.
- Extension modal requests (quick pick, input, confirm) render through one
  `ExtensionDialogHost` mounted in the application shell.
- Installing a extension never touches shell code: the palette command
  `extension.installFromFile` stages an `.grlt` archive through the extension
  host (unzip, validate, blob-import the entry, lazy activation).
- The editor left side follows a VS Code-style activity rail. Entries come
  from the activity registry plus installed extension activity contributions
  (click runs the contributed command or lazily activates the view).
  A settings gear pinned at the rail bottom opens the settings modal
  (same content as the settings page, no navigation); panel toggles stay
  on top through the shared shell slot.
- Layers and Inspector are no longer duplicated as buttons in the editor
  titlebar. Each dock owns a chevron toggle that protrudes from its edge,
  matching the Home sidebar control. When collapsed, the dock transitions to
  zero width and disappears completely; only the protruding expand button
  remains. The left dock points inward with `<` when open and `>` when
  collapsed; the right dock mirrors that direction. Dock state remains part
  of the user-level workspace preference.
- Canvas cursor feedback is host-side and state-aware: a theme-aware custom
  arrow for empty select mode, a custom hand over a selectable object, custom
  open/closed hands during pan and move drags, a custom crosshair for drawing
  tools, and a custom text cursor for text mode. Dock resize handles use a
  theme-aware horizontal `<->` cursor. The engine remains cursor-agnostic.

## Editor menubar and quick open

- The editor menubar is File, Edit, and View only. File holds project actions
  (New offers Design, Whiteboard, and Diagram from the project template
  registry; Save writes immediately and shares the Ctrl+S handler; Place
  Video/Image is disabled until the engine gains an asset-upload flow;
  Duplicate copies the open project; Back to home keeps the unsaved-changes
  close lifecycle). Edit holds Undo, Redo, and Select All; View holds Zoom
  in, Zoom out, Zoom to 100%, Zoom to fit, and Command palette. Engine rows
  reuse the shared command registry so enablement and shortcuts match the
  palette, toolbar, and keys.
- Projects carry a `kind` (`design` | `whiteboard` | `diagram`) in project
  metadata. Home creation, File > New, and duplication all preserve it, and
  the editor selects the matching thin kind editor
  (`src/features/editor/editors/`). Everything per family — display label,
  empty-canvas hint, starting template — lives in the single kind registry
  (`apps/desktop/src/features/projects/projectKinds.ts`); surfaces consume
  it instead of branching on kind ids. Every family renders through the
  single `EditorShell` master template — menubar, activity bar, left dock,
  canvas, right dock, status bar — so dock widths, min/max clamps, and
  expand/collapse are identical everywhere. Only the empty-canvas hint text
  differs per kind today.
- Command rows render once (`PaletteCommandRow`), shared by the palette
  overlay and the quick switcher; shortcut chips all format through
  `formatShortcut`.
- The shell titlebar center hosts the quick-open pill (editor layout only),
  as wide as the palette. It shows the project name with a trailing `*`
  while unsaved changes exist; opening it drops a list
  of layer objects for selection attached below the pill at the same width
  (at most ten rows before scrolling), and typing `>` switches to command
  search. View > Command palette and Ctrl+Shift+P (Ctrl+K still works) open
  it directly in command mode.
- The OS window title follows the capsule: `<name> - Grafalith` when saved,
  `<name>* - Grafalith` while dirty.
- Persistence is manual Save plus a debounced autosave (default 2000 ms).
  Autosave can be toggled and re-tuned in Settings > Editor (250–30000 ms).
  There is no recovery banner; the close dialog stays the single
  unsaved-changes gate.
- Settings content lives once in `SettingsContent`: the settings page and
  the editor settings modal render the same component, so new options are
  added in one place and both surfaces stay in sync.
