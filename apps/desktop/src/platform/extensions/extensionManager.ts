// Extension Manager actions: list, filter, enable, disable, reload,
// uninstall, and output-channel shortcuts.
//
// Every action is a `grafalith.extensions.*` command id so palettes, the
// command palette, and keyboard shortcuts share one path. The panel UI in
// `features/extension-manager` renders from `list()` and calls these
// actions; the host shell wires the `manager.open` command to show it.
import { getExtensionHost } from './extensionHost';
import { getExtensionStatuses, type ExtensionStatus } from './extensionStatus';
import { extensionPanelStore } from './extensionPanels';

/** Canonical manager command ids (palette + docs + diagnostics). */
export const EXTENSION_MANAGER_COMMANDS = [
  'grafalith.extensions.manager.open',
  'grafalith.extensions.manager.showAll',
  'grafalith.extensions.manager.showActive',
  'grafalith.extensions.manager.showFailed',
  'grafalith.extensions.output.showSystem',
] as const;

export type ExtensionManagerCommand = (typeof EXTENSION_MANAGER_COMMANDS)[number];

/** Per-id commands use a colon suffix (`grafalith.extensions.enable:<id>`). */
export function enableCommandFor(packageId: string): string {
  return `grafalith.extensions.enable:${packageId}`;
}

/** Per-id commands use a colon suffix (`grafalith.extensions.disable:<id>`). */
export function disableCommandFor(packageId: string): string {
  return `grafalith.extensions.disable:${packageId}`;
}

/** Per-id commands use a colon suffix (`grafalith.extensions.reload:<id>`). */
export function reloadCommandFor(packageId: string): string {
  return `grafalith.extensions.reload:${packageId}`;
}

/** Per-id commands use a colon suffix (`grafalith.extensions.uninstall:<id>`). */
export function uninstallCommandFor(packageId: string): string {
  return `grafalith.extensions.uninstall:${packageId}`;
}

/** Per-id commands use a colon suffix (`grafalith.extensions.showOutput:<id>`). */
export function showOutputCommandFor(packageId: string): string {
  return `grafalith.extensions.showOutput:${packageId}`;
}

/** One row in the Extension Manager list. */
export interface ExtensionManagerRow {
  packageId: string;
  status: ExtensionStatus;
  reason?: string;
  active: boolean;
}

/** List every installed extension with its live status. */
export function listExtensions(): ExtensionManagerRow[] {
  const host = getExtensionHost();
  const statuses = getExtensionStatuses();
  return host.installed().map((packageId) => ({
    packageId,
    status: host.statusOf(packageId),
    reason: statuses.reason(packageId),
    active: host.statusOf(packageId) === 'ACTIVE',
  }));
}

/** Filter helpers for the manager list (all / active / failed). */
export function filterExtensions(
  rows: readonly ExtensionManagerRow[],
  filter: 'all' | 'active' | 'failed',
): ExtensionManagerRow[] {
  if (filter === 'active') return rows.filter((row) => row.active);
  if (filter === 'failed') {
    return rows.filter(
      (row) =>
        row.status === 'INVALID_MANIFEST' ||
        row.status === 'INCOMPATIBLE_VERSION' ||
        row.status === 'MISSING_DEPENDENCY' ||
        row.status === 'CIRCULAR_DEPENDENCY' ||
        row.status === 'LOAD_FAILED' ||
        row.status === 'INVALID_ENTRY' ||
        row.status === 'ACTIVATION_FAILED' ||
        row.status === 'ACTIVATION_TIMEOUT',
    );
  }
  return [...rows];
}

/** Enable one extension without restarting the app. */
export function enableExtension(packageId: string): Promise<boolean> {
  return getExtensionHost().enable(packageId);
}

/** Disable one extension without restarting the app. */
export function disableExtension(packageId: string): Promise<boolean> {
  return getExtensionHost().disable(packageId);
}

/** Reload one extension without restarting the app. */
export function reloadExtension(packageId: string): Promise<boolean> {
  return getExtensionHost().reload(packageId);
}

/** Uninstall one extension. */
export function uninstallExtension(packageId: string): Promise<boolean> {
  return getExtensionHost().uninstall(packageId);
}

/** Show the output channel of one extension. */
export function showExtensionOutput(packageId: string): void {
  getExtensionHost().showOutput(packageId);
}

/** Show the system output channel. */
export function showSystemOutput(): void {
  getExtensionHost().showSystemOutput();
}

type ManagerOpenListener = (filter: 'all' | 'active' | 'failed') => void;

const openListeners = new Set<ManagerOpenListener>();

/** Shell subscribes to mount the manager panel on `manager.open`. */
export function onOpenExtensionManager(listener: ManagerOpenListener): { dispose(): void } {
  openListeners.add(listener);
  return { dispose: () => void openListeners.delete(listener) };
}

function emitOpen(filter: 'all' | 'active' | 'failed'): void {
  for (const listener of [...openListeners]) listener(filter);
}

/**
 * Execute one manager command by id (`grafalith.extensions.*`,
 * `grafalith.output.showSystem`, per-id `enable:<id>` / `disable:<id>` /
 * `reload:<id>` / `uninstall:<id>` / `showOutput:<id>`).
 * Unknown ids report `ok: false` instead of throwing.
 */
export async function executeManagerCommand(
  id: string,
): Promise<{ ok: boolean; value?: unknown; reason?: string }> {
  // Legacy three-part aliases from the original spec stay working; the
  // four-part `manager.*` forms above are canonical (command-id convention).
  const normalized =
    id === 'grafalith.extensions.showAll'
      ? 'grafalith.extensions.manager.showAll'
      : id === 'grafalith.extensions.showActive'
        ? 'grafalith.extensions.manager.showActive'
        : id === 'grafalith.extensions.showFailed'
          ? 'grafalith.extensions.manager.showFailed'
          : id;
  id = normalized;
  if (id === 'grafalith.extensions.manager.open' || id === 'grafalith.extensions.manager.showAll') {
    emitOpen('all');
    extensionPanelStore.openManager('all');
    return { ok: true };
  }
  if (id === 'grafalith.extensions.manager.showActive') {
    emitOpen('active');
    extensionPanelStore.openManager('active');
    return { ok: true };
  }
  if (id === 'grafalith.extensions.manager.showFailed') {
    emitOpen('failed');
    extensionPanelStore.openManager('failed');
    return { ok: true };
  }
  if (id === 'grafalith.output.showSystem' || id === 'grafalith.extensions.output.showSystem') {
    showSystemOutput();
    extensionPanelStore.openOutput(false);
    return { ok: true };
  }
  const [command, target] = id.split(/:(.+)/);
  if (!target) return { ok: false, reason: `unknown-command: ${id}` };
  if (command === 'grafalith.extensions.enable') return { ok: await enableExtension(target) };
  if (command === 'grafalith.extensions.disable') return { ok: await disableExtension(target) };
  if (command === 'grafalith.extensions.reload') return { ok: await reloadExtension(target) };
  if (command === 'grafalith.extensions.uninstall') return { ok: await uninstallExtension(target) };
  if (command === 'grafalith.extensions.showOutput') {
    showExtensionOutput(target);
    extensionPanelStore.openOutput(true);
    return { ok: true };
  }
  return { ok: false, reason: `unknown-command: ${id}` };
}
