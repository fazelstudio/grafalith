import { describe, expect, test } from 'bun:test';
import { menuLocations, menuRegistry, menusFor } from './menus';
import { appCommandRegistry } from './appCommands';
import { commandRegistry } from './commands';

describe('menu registry', () => {
  test('locations cover menubar, canvas, panel, status, activity, and home', () => {
    const locations = menuLocations();
    for (const expected of [
      'menubar.file',
      'menubar.edit',
      'menubar.view',
      'canvas.context',
      'layers.context',
      'statusbar.context',
      'activitybar.context',
      'home.card.context',
    ] as const) {
      expect(locations).toContain(expected);
    }
  });

  test('every row resolves to an engine or host command', () => {
    for (const row of menuRegistry.all()) {
      const found =
        row.commandKind === 'engine'
          ? commandRegistry.get(row.commandId)
          : appCommandRegistry.get(row.commandId);
      expect(found, `missing command "${row.commandId}" for menu "${row.id}"`).toBeDefined();
    }
  });

  test('slots are ordered and unique per location', () => {
    for (const location of menuLocations()) {
      const rows = menusFor(location);
      const slots = rows.map((row) => `${row.group}:${row.order}`);
      expect(new Set(slots).size).toBe(slots.length);
    }
    expect(menusFor('menubar.file').map((row) => row.id)).toContain('file.save');
  });
});
