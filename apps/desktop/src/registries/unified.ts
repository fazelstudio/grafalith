import {
  appCommandRegistry,
  canExecuteAppCommand,
  executeAppCommand,
  searchAppCommands,
  type AppCommandContext,
  type AppCommandDefinition,
} from './appCommands';
import {
  commandRegistry,
  canExecuteCommand,
  executeCommand,
  searchCommands,
  type CommandContext,
  type CommandDefinition,
} from './commands';
import { menusFor, type MenuItemDefinition } from './menus';
import { paletteMru, recordPaletteUse } from './paletteMru';
import {
  executeExtensionCommand,
  hasExtensionCommand,
  extensionCommandIds,
  extensionMenuRowsFor,
} from '../platform/extensions/extensionContributions';

/** One palette row from any registry, ranked and grouped uniformly. */
export interface UnifiedPaletteRow {
  kind: 'engine' | 'app' | 'extension';
  id: string;
  label: string;
  description: string;
  category: string;
  executable: boolean;
}

/**
 * Combined palette search over engine and host commands. MRU ids rank
 * first, then substring matches in registration order, so the palette
 * learns without a separate frecency service.
 */
export function searchUnifiedPalette(
  query: string,
  engineCtx: CommandContext,
  appCtx: AppCommandContext,
): UnifiedPaletteRow[] {
  const needle = query.trim().toLowerCase();
  const engineHits = searchCommands(query);
  const appHits = searchAppCommands(query);
  const rows: UnifiedPaletteRow[] = [
    ...engineHits.map(
      (command: CommandDefinition): UnifiedPaletteRow => ({
        kind: 'engine',
        id: command.id,
        label: command.defaultLabel,
        description: command.defaultDescription ?? '',
        category: command.category,
        executable: canExecuteCommand(command.id, engineCtx).executable,
      }),
    ),
    ...appHits.map(
      (command: AppCommandDefinition): UnifiedPaletteRow => ({
        kind: 'app',
        id: command.id,
        label: command.defaultLabel,
        description: command.defaultDescription ?? '',
        category: command.category,
        executable: canExecuteAppCommand(command.id, appCtx).executable,
      }),
    ),
    ...extensionCommandIds()
      .filter((id) => needle === '' || id.toLowerCase().includes(needle))
      .map(
        (id): UnifiedPaletteRow => ({
          kind: 'extension',
          id,
          label: id,
          description: '',
          category: 'extension',
          executable: hasExtensionCommand(id),
        }),
      ),
  ];
  const mru = paletteMru();
  const rank = (row: UnifiedPaletteRow): number => {
    const at = mru.indexOf(`${row.kind}:${row.id}`);
    return at === -1 ? mru.length + 1 : at;
  };
  const filtered =
    needle === ''
      ? rows
      : rows.filter((row) =>
          `${row.label} ${row.description} ${row.id} ${row.category}`.toLowerCase().includes(needle),
        );
  return [...filtered].sort((a, b) => rank(a) - rank(b));
}

/** Execute one palette row through its own registry and record MRU use. */
export async function executeUnifiedRow(
  row: UnifiedPaletteRow,
  engineCtx: CommandContext,
  appCtx: AppCommandContext,
): Promise<{ ok: boolean; reason?: string }> {
  if (row.kind === 'extension') {
    const outcome = await executeExtensionCommand(row.id);
    if (outcome.ok) {
      recordPaletteUse(`extension:${row.id}`);
      return { ok: true };
    }
    return { ok: false, reason: outcome.reason };
  }
  const result =
    row.kind === 'engine'
      ? await executeCommand(row.id, engineCtx)
      : await executeAppCommand(row.id, appCtx);
  if (result.status === 'ok') {
    recordPaletteUse(`${row.kind}:${row.id}`);
    return { ok: true };
  }
  return { ok: false, reason: result.status === 'disabled' ? result.reason : result.status };
}

/** Group rows by category for palette section headers. */
export function groupUnifiedRows(rows: readonly UnifiedPaletteRow[]): { category: string; rows: UnifiedPaletteRow[] }[] {
  const groups: { category: string; rows: UnifiedPaletteRow[] }[] = [];
  for (const row of rows) {
    const group = groups.find((entry) => entry.category === row.category);
    if (group) group.rows.push(row);
    else groups.push({ category: row.category, rows: [row] });
  }
  return groups;
}

/** Menu enablement shared by menubar, context, and select surfaces. */
export function menuRowExecutable(row: MenuItemDefinition, engineCtx: CommandContext, appCtx: AppCommandContext): boolean {
  if (row.commandKind === 'engine') {
    const command = commandRegistry.get(row.commandId);
    if (!command) return hasExtensionCommand(row.commandId);
    return canExecuteCommand(row.commandId, engineCtx).executable;
  }
  const command = appCommandRegistry.get(row.commandId);
  if (!command) return hasExtensionCommand(row.commandId);
  return canExecuteAppCommand(row.commandId, appCtx).executable;
}

/** Execute one contributed menu row through its own registry. */
export async function executeMenuRow(
  row: MenuItemDefinition,
  engineCtx: CommandContext,
  appCtx: AppCommandContext,
): Promise<void> {
  if (hasExtensionCommand(row.commandId) && !commandRegistry.get(row.commandId) && !appCommandRegistry.get(row.commandId)) {
    await executeExtensionCommand(row.commandId);
    return;
  }
  if (row.commandKind === 'engine') await executeCommand(row.commandId, engineCtx);
  else await executeAppCommand(row.commandId, appCtx);
}

/** Menu rows for a select-list location (Select primitive options source). */
export function selectOptionsFor(location: 'select.list'): readonly MenuItemDefinition[] {
  return menusFor(location);
}

/** Extension-contributed rows for one menu location in display order. */
export function extensionRowsFor(location: MenuItemDefinition['location']) {
  return extensionMenuRowsFor(location);
}
