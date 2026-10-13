import { createRegistry, type Descriptor } from './core';

/**
 * Declarative menu location. Menubar sections own top-level menus, context
 * locations own right-click menus, and select locations own dropdown lists.
 * Every location renders through one template so extensions add rows without
 * touching shell code.
 */
export type MenuLocation =
  | 'menubar.file'
  | 'menubar.edit'
  | 'menubar.view'
  | 'canvas.context'
  | 'layers.context'
  | 'inspector.context'
  | 'panel.context'
  | 'statusbar.context'
  | 'activitybar.context'
  | 'home.card.context'
  | 'select.list';

/** One contributed row: an engine or host command placed in a menu. */
export interface MenuItemDefinition extends Descriptor {
  location: MenuLocation;
  /** Command id from the engine registry or the host app-command registry. */
  commandId: string;
  /** `engine` rows resolve via commandRegistry, `app` rows via appCommandRegistry. */
  commandKind: 'engine' | 'app';
  /** Visual group; the template renders a separator between groups. */
  group: number;
  /** Position inside the group; lower renders first. */
  order: number;
  /** Submenu parent within the same location (for menu/sub-menu nesting). */
  parent?: string;
}

const MENU_ITEMS: readonly MenuItemDefinition[] = [
  { id: 'file.new', labelKey: 'editor.menu.new', defaultLabel: 'New', location: 'menubar.file', commandId: 'project.new', commandKind: 'app', group: 0, order: 0 },
  { id: 'file.save', labelKey: 'editor.menu.save', defaultLabel: 'Save', location: 'menubar.file', commandId: 'project.save', commandKind: 'app', group: 0, order: 10 },
  { id: 'file.duplicate', labelKey: 'editor.menu.duplicateProject', defaultLabel: 'Duplicate', location: 'menubar.file', commandId: 'project.duplicate', commandKind: 'app', group: 0, order: 20 },
  { id: 'file.exportPng', labelKey: 'editor.commands.exportPng', defaultLabel: 'Export PNG', location: 'menubar.file', commandId: 'exportPng', commandKind: 'engine', group: 0, order: 30 },
  { id: 'file.exportSvg', labelKey: 'editor.commands.exportSvg', defaultLabel: 'Export SVG', location: 'menubar.file', commandId: 'exportSvg', commandKind: 'engine', group: 0, order: 31 },
  { id: 'file.exportPdf', labelKey: 'editor.commands.exportPdf', defaultLabel: 'Export PDF', location: 'menubar.file', commandId: 'exportPdf', commandKind: 'engine', group: 0, order: 32 },
  { id: 'file.home', labelKey: 'navigation.backToHome', defaultLabel: 'Back to home', location: 'menubar.file', commandId: 'navigation.backToHome', commandKind: 'app', group: 1, order: 0 },
  { id: 'edit.undo', labelKey: 'editor.commands.undo', defaultLabel: 'Undo', location: 'menubar.edit', commandId: 'undo', commandKind: 'engine', group: 0, order: 0 },
  { id: 'edit.redo', labelKey: 'editor.commands.redo', defaultLabel: 'Redo', location: 'menubar.edit', commandId: 'redo', commandKind: 'engine', group: 0, order: 10 },
  { id: 'edit.selectAll', labelKey: 'editor.commands.selectAll', defaultLabel: 'Select all', location: 'menubar.edit', commandId: 'selectAll', commandKind: 'engine', group: 1, order: 0 },
  { id: 'view.zoomIn', labelKey: 'editor.commands.zoomIn', defaultLabel: 'Zoom in', location: 'menubar.view', commandId: 'zoomIn', commandKind: 'engine', group: 0, order: 0 },
  { id: 'view.zoomOut', labelKey: 'editor.commands.zoomOut', defaultLabel: 'Zoom out', location: 'menubar.view', commandId: 'zoomOut', commandKind: 'engine', group: 0, order: 10 },
  { id: 'view.resetZoom', labelKey: 'editor.commands.resetZoom', defaultLabel: 'Reset zoom', location: 'menubar.view', commandId: 'resetZoom', commandKind: 'engine', group: 0, order: 20 },
  { id: 'view.fitContent', labelKey: 'editor.commands.fitContent', defaultLabel: 'Fit content', location: 'menubar.view', commandId: 'fitContent', commandKind: 'engine', group: 0, order: 30 },
  { id: 'view.palette', labelKey: 'editor.commands.commandPalette', defaultLabel: 'Command palette', location: 'menubar.view', commandId: 'commandPalette', commandKind: 'engine', group: 1, order: 0 },
  { id: 'canvas.delete', labelKey: 'editor.commands.delete', defaultLabel: 'Delete', location: 'canvas.context', commandId: 'delete', commandKind: 'engine', group: 0, order: 0 },
  { id: 'canvas.duplicate', labelKey: 'editor.commands.duplicate', defaultLabel: 'Duplicate', location: 'canvas.context', commandId: 'duplicate', commandKind: 'engine', group: 0, order: 10 },
  { id: 'canvas.group', labelKey: 'editor.commands.group', defaultLabel: 'Group', location: 'canvas.context', commandId: 'group', commandKind: 'engine', group: 1, order: 0 },
  { id: 'canvas.lock', labelKey: 'editor.commands.lock', defaultLabel: 'Lock', location: 'canvas.context', commandId: 'lock', commandKind: 'engine', group: 1, order: 10 },
  { id: 'layers.selectAll', labelKey: 'editor.commands.selectAll', defaultLabel: 'Select all', location: 'layers.context', commandId: 'selectAll', commandKind: 'engine', group: 0, order: 0 },
  { id: 'layers.delete', labelKey: 'editor.commands.delete', defaultLabel: 'Delete', location: 'layers.context', commandId: 'delete', commandKind: 'engine', group: 0, order: 10 },
  { id: 'layers.copy', labelKey: 'editor.commands.copy', defaultLabel: 'Copy', location: 'layers.context', commandId: 'copy', commandKind: 'engine', group: 0, order: 20 },
  { id: 'layers.duplicate', labelKey: 'editor.commands.duplicate', defaultLabel: 'Duplicate', location: 'layers.context', commandId: 'duplicate', commandKind: 'engine', group: 0, order: 30 },
  { id: 'layers.bringToFront', labelKey: 'editor.commands.bringToFront', defaultLabel: 'Bring to front', location: 'layers.context', commandId: 'bringToFront', commandKind: 'engine', group: 1, order: 0 },
  { id: 'layers.sendToBack', labelKey: 'editor.commands.sendToBack', defaultLabel: 'Send to back', location: 'layers.context', commandId: 'sendToBack', commandKind: 'engine', group: 1, order: 10 },
  { id: 'layers.lock', labelKey: 'editor.commands.lock', defaultLabel: 'Lock', location: 'layers.context', commandId: 'lock', commandKind: 'engine', group: 2, order: 0 },
  { id: 'layers.unlock', labelKey: 'editor.commands.unlock', defaultLabel: 'Unlock', location: 'layers.context', commandId: 'unlock', commandKind: 'engine', group: 2, order: 10 },
  { id: 'layers.group', labelKey: 'editor.commands.group', defaultLabel: 'Group', location: 'layers.context', commandId: 'group', commandKind: 'engine', group: 3, order: 0 },
  { id: 'layers.ungroup', labelKey: 'editor.commands.ungroup', defaultLabel: 'Ungroup', location: 'layers.context', commandId: 'ungroup', commandKind: 'engine', group: 3, order: 10 },
  { id: 'statusbar.resetZoom', labelKey: 'editor.commands.resetZoom', defaultLabel: 'Reset zoom', location: 'statusbar.context', commandId: 'view.resetZoom', commandKind: 'app', group: 0, order: 0 },
  { id: 'statusbar.fitContent', labelKey: 'editor.commands.fitContent', defaultLabel: 'Fit content', location: 'statusbar.context', commandId: 'view.fitContent', commandKind: 'app', group: 0, order: 10 },
  { id: 'activitybar.layers', labelKey: 'editor.panels.layersToggle', defaultLabel: 'Toggle layers', location: 'activitybar.context', commandId: 'panel.toggleLayers', commandKind: 'app', group: 0, order: 0 },
  { id: 'activitybar.inspector', labelKey: 'editor.panels.inspectorToggle', defaultLabel: 'Toggle inspector', location: 'activitybar.context', commandId: 'panel.toggleInspector', commandKind: 'app', group: 0, order: 10 },
  { id: 'home.duplicate', labelKey: 'editor.menu.duplicateProject', defaultLabel: 'Duplicate', location: 'home.card.context', commandId: 'project.duplicate', commandKind: 'app', group: 0, order: 0 },
  { id: 'home.home', labelKey: 'navigation.projects', defaultLabel: 'Go to Projects', location: 'home.card.context', commandId: 'navigation.goHome', commandKind: 'app', group: 1, order: 0 },
  { id: 'home.open', labelKey: 'projects.actions.open', defaultLabel: 'Open', location: 'home.card.context', commandId: 'project.open', commandKind: 'app', group: 0, order: 10 },
  { id: 'home.rename', labelKey: 'projects.actions.rename', defaultLabel: 'Rename', location: 'home.card.context', commandId: 'project.rename', commandKind: 'app', group: 0, order: 20 },
  { id: 'home.favorite', labelKey: 'projects.actions.favorite', defaultLabel: 'Favorite', location: 'home.card.context', commandId: 'project.toggleFavorite', commandKind: 'app', group: 0, order: 30 },
  { id: 'home.delete', labelKey: 'projects.actions.delete', defaultLabel: 'Delete', location: 'home.card.context', commandId: 'project.delete', commandKind: 'app', group: 1, order: 10 },
  { id: 'settings.general', labelKey: 'settings.general.title', defaultLabel: 'General', location: 'select.list', commandId: 'settings.openSection', commandKind: 'app', group: 0, order: 0 },
  { id: 'settings.appearance', labelKey: 'settings.appearance.title', defaultLabel: 'Appearance', location: 'select.list', commandId: 'settings.openSection', commandKind: 'app', group: 0, order: 10 },
  { id: 'settings.editor', labelKey: 'settings.editor.title', defaultLabel: 'Editor', location: 'select.list', commandId: 'settings.openSection', commandKind: 'app', group: 0, order: 20 },
  { id: 'settings.shortcuts', labelKey: 'settings.shortcuts.title', defaultLabel: 'Shortcuts', location: 'select.list', commandId: 'settings.openSection', commandKind: 'app', group: 0, order: 30 },
  { id: 'settings.extensions', labelKey: 'settings.extensions.title', defaultLabel: 'Extensions', location: 'select.list', commandId: 'settings.openSection', commandKind: 'app', group: 0, order: 40 },
];

/** Validated lookup over contributed menu rows. */
export const menuRegistry = createRegistry('menu', MENU_ITEMS, {
  validateAll: (items) => {
    const problems: string[] = [];
    const slots = new Set<string>();
    for (const item of items) {
      const slot = `${item.location}:${item.group}:${item.order}`;
      if (slots.has(slot)) problems.push(`duplicate menu slot "${slot}" for id "${item.id}"`);
      slots.add(slot);
    }
    return problems;
  },
});

/** Rows for one location in display order. */
export function menusFor(location: MenuLocation): readonly MenuItemDefinition[] {
  return menuRegistry
    .all()
    .filter((item) => item.location === location)
    .sort((a, b) => a.group - b.group || a.order - b.order);
}

/** Locations a extension may extend without shell changes. */
export function menuLocations(): readonly MenuLocation[] {
  const locations: MenuLocation[] = [];
  for (const item of menuRegistry.all()) {
    if (!locations.includes(item.location)) locations.push(item.location);
  }
  return locations;
}
