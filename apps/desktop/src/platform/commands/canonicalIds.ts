// Canonical `grafalith.*` command ids for every UI section and action.
//
// Convention: `grafalith.<scope>.<section>.<action>` (lowercase,
// dot-separated). Built-ins register on the same bus as extension
// commands; legacy short ids (`undo`, `project.save`, …) keep working as
// aliases so existing palettes, menus, and tests never break.

import { appCommandRegistry } from '../../registries/appCommands';
import { commandRegistry } from '../../registries/commands';

/** One canonical id plus the legacy id it delegates to. */
export interface CanonicalCommandAlias {
  /** Stable namespaced id (`grafalith.<scope>.<section>.<action>`). */
  canonical: string;
  /** Registry the legacy id lives in. */
  kind: 'engine' | 'app';
  /** Legacy id (`undo`, `project.save`, …). */
  legacy: string;
}

/**
 * Canonical ids covering every extensible section: home, palette,
 * settings, views, notifications, per-kind editor tools, home project
 * creation, dialogs, panels, and layers/canvas menus.
 */
export const CANONICAL_COMMANDS: readonly CanonicalCommandAlias[] = [
  { canonical: 'grafalith.core.app.quit', kind: 'app', legacy: 'window.close' },
  { canonical: 'grafalith.core.commandPalette.open', kind: 'engine', legacy: 'commandPalette' },
  { canonical: 'grafalith.core.settings.open', kind: 'app', legacy: 'dialog.openSettings' },
  { canonical: 'grafalith.view.activityBar.toggle', kind: 'app', legacy: 'panel.toggleLayers' },
  { canonical: 'grafalith.view.statusBar.toggle', kind: 'app', legacy: 'view.resetZoom' },
  { canonical: 'grafalith.view.panel.toggle', kind: 'app', legacy: 'panel.toggleInspector' },
  { canonical: 'grafalith.view.notification.dismissAll', kind: 'app', legacy: 'notification.dismissAll' },
  { canonical: 'grafalith.editor.design.tool.select', kind: 'app', legacy: 'tool.activateSelect' },
  { canonical: 'grafalith.editor.whiteboard.tool.select', kind: 'app', legacy: 'tool.activateSelect' },
  { canonical: 'grafalith.editor.slides.tool.select', kind: 'app', legacy: 'tool.activateSelect' },
  { canonical: 'grafalith.editor.design.node.add', kind: 'engine', legacy: 'paste' },
  { canonical: 'grafalith.editor.slides.node.add', kind: 'engine', legacy: 'paste' },
  { canonical: 'grafalith.editor.whiteboard.tool.pen', kind: 'engine', legacy: 'escape' },
  { canonical: 'grafalith.home.project.create.design', kind: 'app', legacy: 'project.new' },
  { canonical: 'grafalith.home.project.create.whiteboard', kind: 'app', legacy: 'project.new' },
  { canonical: 'grafalith.home.project.create.slides', kind: 'app', legacy: 'project.new' },
  { canonical: 'grafalith.home.project.open', kind: 'app', legacy: 'project.open' },
  { canonical: 'grafalith.extensions.manager.open', kind: 'app', legacy: 'extension.openManager' },
  { canonical: 'grafalith.extensions.manager.showAll', kind: 'app', legacy: 'extension.openManager' },
  { canonical: 'grafalith.extensions.manager.showActive', kind: 'app', legacy: 'extension.openManager' },
  { canonical: 'grafalith.extensions.manager.showFailed', kind: 'app', legacy: 'extension.openManager' },
  { canonical: 'grafalith.extensions.output.showSystem', kind: 'app', legacy: 'output.showSystem' },
];

const CANONICAL_PATTERN = /^grafalith\.[a-z]+\.[a-zA-Z]+\.[a-zA-Z.]+$/;

/** Whether an id follows the canonical convention. */
export function isCanonicalCommandId(id: string): boolean {
  return CANONICAL_PATTERN.test(id);
}

/** Resolve a canonical id to its legacy registry entry. */
export function resolveCanonicalCommand(canonical: string): { kind: 'engine' | 'app'; legacy: string } | undefined {
  return CANONICAL_COMMANDS.find((entry) => entry.canonical === canonical);
}

/** Whether a canonical or legacy id exists in any registry. */
export function hasCommand(id: string): boolean {
  const resolved = resolveCanonicalCommand(id);
  if (resolved) {
    return resolved.kind === 'engine'
      ? commandRegistry.get(resolved.legacy) !== undefined
      : appCommandRegistry.get(resolved.legacy) !== undefined;
  }
  return commandRegistry.get(id) !== undefined || appCommandRegistry.get(id) !== undefined;
}

/** Every canonical id (palette population, docs, diagnostics). */
export function canonicalCommandIds(): string[] {
  return CANONICAL_COMMANDS.map((entry) => entry.canonical);
}
