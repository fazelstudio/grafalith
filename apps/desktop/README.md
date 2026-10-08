# OpenNary Desktop

Reference Tauri host for the OpenNary canvas engine.

## Design system boundaries

- Semantic UI and canvas interaction tokens live in `src/app/theme/tokens.css`.
- The native scrollbar is restyled once globally in `tokens.css`; page
  scroll containers that must not shift opt into
  `scrollbar-gutter: stable` in their own stylesheet.
- Typed theme metadata and shared desktop dimensions/timing live in
  `src/app/theme/tokens.ts`.
- Reusable controls and overlays live in `src/ui/primitives/`.
- All hover hints use the single `Tooltip` primitive in
  `src/ui/primitives/tooltip.tsx`; never add a native `title` attribute on
  buttons or labels. Tooltip content is a localized `t()` string and styling
  uses the themed elevated surface, so locale and light/dark themes apply
  automatically (dark tooltip in dark mode, light in light mode). Nothing
  renders until boot theme and locale are applied, so no fallback-colored
  frame ever flashes. A bordered pointer nub on the active side aims at the
  hovered control. Placement defaults to `auto` (above when there is room,
  below near the top edge, else to the side) with explicit `top` for bottom
  toolbars, `bottom` for top bars, and `right` for collapsed rails.
- Toasts are provided by `src/app/shell/ToastProvider.tsx`.
- Editor tools, commands, menus, and panels are registry-driven; new editor
  surfaces should consume those registries rather than duplicate handlers.
  Engine intents live in `src/registries/commands.ts`; host chrome lives in
  `src/registries/appCommands.ts`. Menu placement lives in
  `src/registries/menus.ts`; every row renders through the single `ActionRow`
  template and icons resolve through `src/ui/iconRegistry.tsx`.
  Palette search is unified over engine, host, and extension commands
  (`src/registries/unified.ts`, category groups, MRU ranking).
  Boot order lives in `src/platform/boot/startupQueue.ts` (project entry
  never waits for extensions). Extension packaging (`.onry`), the SDK surface,
  and the desktop extension host are specified in
  `docs/guides/extensions.md`.
  The editor menubar is File/Edit/View only (File holds New, Save,
  Duplicate, and Back to home), and the titlebar quick-open
  pill (layer list, `>` for commands) reuses the command registry and the
  render-model navigator instead of duplicating their logic.
- Every editor family (design, whiteboard, diagram) renders through the
  single `EditorShell` master template in
  `src/features/editor/shell/EditorShell.tsx`: titlebar capsule, menubar,
  activity bar, left dock, canvas, right dock, and status bar. Kind editors
  under `src/features/editor/editors/` supply only content slots, so dock
  widths, min/max clamps, and expand/collapse stay identical everywhere.
  Never duplicate that layout per kind.
- Everything that varies per family lives in the single kind registry
  (`src/features/projects/projectKinds.ts`): display label, empty-canvas
  hint, and starting template. Menus, home, cards, and editors consume it;
  the template owns the kind mapping and the reverse lookup is derived, so
  the mapping is stored once. The `ProjectKind` union mirrors
  `PROJECT_KINDS` in `src-tauri/src/projects.rs` — extend both together.
- Command rows are rendered once (`PaletteCommandRow` in
  `src/features/editor/palette/`), shared by the command palette overlay
  and the titlebar quick switcher. Shortcut chips all format through
  `formatShortcut`; never hardcode labels like `Ctrl+S`.
- Projects carry a `kind` (`design` | `whiteboard` | `diagram`) in project
  metadata (Tauri and browser stores share the contract); unknown or missing
  kinds normalize to `design` through the single `normalizeProjectKind`
  helper.
- Persistence is manual Save (File > Save or Ctrl+S) plus a debounced
  autosave (default 2000 ms) that can be toggled and re-tuned in
  Settings > Editor. Unsaved changes show a `*` after the project name in
  the titlebar capsule and in the window title (`name* - OpenNary`). There
  is no recovery banner; the close dialog stays the single unsaved-changes
  gate.
- User-facing text belongs in `src/app/i18n/` and must keep English and
  Indonesian key sets in parity.
- Workspace pages (Projects, Trash, Settings) share the
  `workspace-page-header` / `workspace-page-title` /
  `workspace-page-description` header composition from
  `src/app/shell/shell.css` with `22px 28px 48px` page padding.
- Settings sections are registry-driven (`settingSectionRegistry` in
  `src/features/settings/settingsDescriptors.ts`); the sidebar renders
  entries from the registry with icons resolved through one map, and the
  content panel renders controls from `settingRegistry`. A header search
  filters settings across all sections without leaving the page.
- The settings content itself lives once in `SettingsContent`
  (`src/features/settings/SettingsContent.tsx`): the settings page
  (`SettingsScreen`, route-owned section) and the editor settings modal
  (`SettingsModal`, internal section state, opened from the activity-bar
  gear) render the same component, so new options are added in one place
  and both surfaces stay in sync. The modal uses the wide dialog variant
  at a fixed 75% of the window with internal scrolling; its header carries
  the search and the close button, so no bottom actions are needed.

## Run

From the repository root:

```bash
bun run --filter @fazelstudio/desktop dev
bun run --filter @fazelstudio/desktop typecheck
bun run --filter @fazelstudio/desktop test
bun run --filter @fazelstudio/desktop build
```
