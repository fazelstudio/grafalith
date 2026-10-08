import { appCommandRegistry } from '../../registries/appCommands';
import { commandRegistry } from '../../registries/commands';
import { menuLocations, type MenuLocation } from '../../registries/menus';
import { iconIds } from '../../ui/iconRegistry';
import { ONRY_FORMAT_VERSION, onryPackageId, type OnryManifest } from './extensionManifest';

/** Handler behind one extension command id (JS-side intent, not an engine op). */
export type ExtensionCommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** One extension menu row placed into an existing host menu location. */
export interface ExtensionMenuRow {
  location: MenuLocation;
  commandId: string;
  group: number;
  order: number;
}

/** View-surface metadata contributed by a extension (rail, dock, status, tool). */
export interface ExtensionViewContribution {
  surface: 'activity' | 'panel' | 'status' | 'tool' | 'view';
  id: string;
  title: string;
  icon?: string;
  /** Command run on click (status and activity items); absent renders read-only. */
  command?: string;
  /** Dock side for panel contributions (default right). */
  location?: 'left' | 'right';
}

/** Namespaced configuration declared by installed extensions (`extensionId.key`). */
export interface ExtensionConfiguration {
  extensionId: string;
  key: string;
  title: string;
  default: string | boolean | number;
}

/** Configuration declared by every installed extension (settings renders these). */
export function extensionConfigurations(): ExtensionConfiguration[] {
  const configs: ExtensionConfiguration[] = [];
  for (const record of installed.values()) {
    for (const setting of record.manifest.contributes?.configuration ?? []) {
      configs.push({
        extensionId: onryPackageId(record.manifest),
        key: setting.key,
        title: setting.title,
        default: setting.default,
      });
    }
  }
  return configs;
}

/** Installed extension record kept by the host. */
export interface InstalledExtension {
  packageId: string;
  manifest: OnryManifest;
  active: boolean;
}

const commandHandlers = new Map<string, ExtensionCommandHandler>();
const menuRows: ExtensionMenuRow[] = [];
const viewContributions: ExtensionViewContribution[] = [];
const installed = new Map<string, InstalledExtension>();

/**
 * Validate one manifest against this host (format, engines range, and
 * contribution surfaces). Returns one message per problem.
 */
export function validateExtensionForHost(manifest: OnryManifest, hostVersion: string): string[] {
  const problems: string[] = [];
  if (manifest.formatVersion !== ONRY_FORMAT_VERSION) {
    problems.push(`unsupported formatVersion ${manifest.formatVersion}`);
  }
  if (!satisfiesEngines(manifest.engines.opennary, hostVersion)) {
    problems.push(`engines.opennary "${manifest.engines.opennary}" incompatible with host ${hostVersion}`);
  }
  const declared = new Set((manifest.contributes?.commands ?? []).map((command) => command.command));
  for (const command of manifest.contributes?.commands ?? []) {
    if (command.command === '') problems.push('contributed command id must not be empty');
    if (command.title === '') problems.push(`contributed command "${command.command}" needs a title`);
    if (command.icon !== undefined && !iconIds().includes(command.icon)) {
      problems.push(`unknown icon "${command.icon}" for command "${command.command}"`);
    }
  }
  for (const [location, placements] of Object.entries(manifest.contributes?.menus ?? {})) {
    if (!menuLocations().includes(location as MenuLocation)) {
      problems.push(`unknown menu location "${location}"`);
    }
    for (const placement of placements) {
      const known =
        declared.has(placement.command) ||
        commandRegistry.get(placement.command) !== undefined ||
        appCommandRegistry.get(placement.command) !== undefined ||
        commandHandlers.has(placement.command);
      if (!known) problems.push(`menu "${location}" targets unknown command "${placement.command}"`);
    }
  }
  const sections: Record<string, readonly { id: string; title: string; icon?: string }[] | undefined> = {
    views: manifest.contributes?.views,
    activity: manifest.contributes?.activity,
    panels: manifest.contributes?.panels,
    status: manifest.contributes?.status,
    tools: manifest.contributes?.tools,
  };
  for (const [section, items] of Object.entries(sections)) {
    for (const item of items ?? []) {
      if (item.id === '') problems.push(`contributed ${section} id must not be empty`);
      if (item.title === '') problems.push(`contributed ${section} "${item.id}" needs a title`);
      if (item.icon !== undefined && !iconIds().includes(item.icon)) {
        problems.push(`unknown icon "${item.icon}" for ${section} "${item.id}"`);
      }
    }
  }
  return problems;
}

/** Minimal caret/star range check shared with the SDK surface. */
export function satisfiesEngines(range: string, hostVersion: string): boolean {
  if (range === '*') return true;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  const host = /^(\d+)\.(\d+)\.(\d+)/.exec(hostVersion.trim());
  if (!caret || !host) return false;
  const [, rMajor, rMinor, rPatch] = caret.map(Number);
  const [, hMajor, hMinor, hPatch] = host.map(Number);
  if (rMajor > 0) {
    return hMajor === rMajor && (hMinor > rMinor || (hMinor === rMinor && hPatch >= rPatch));
  }
  if (rMinor > 0) return hMajor === 0 && hMinor === rMinor && hPatch >= rPatch;
  return hMajor === 0 && hMinor === 0 && hPatch === rPatch;
}

/** Register one extension command handler (id must be contributed or namespaced). */
export function registerExtensionCommand(id: string, handler: ExtensionCommandHandler): void {
  if (id === '') throw new Error('extension command id must not be empty');
  if (commandHandlers.has(id)) throw new Error(`extension command already registered: ${id}`);
  commandHandlers.set(id, handler);
}

/** Execute one extension command handler. Unknown ids report, never throw. */
export async function executeExtensionCommand(
  id: string,
  ...args: unknown[]
): Promise<{ ok: boolean; value?: unknown; reason?: string }> {
  const handler = commandHandlers.get(id);
  if (!handler) return { ok: false, reason: 'unknown-command' };
  try {
    return { ok: true, value: await handler(...args) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Extension command ids for palette search. */
export function extensionCommandIds(): string[] {
  return [...commandHandlers.keys()];
}

/** Whether a extension command handler exists. */
export function hasExtensionCommand(id: string): boolean {
  return commandHandlers.has(id);
}

/** Register extension menu rows (validated locations, ordered with built-ins). */
export function registerExtensionMenuRows(rows: readonly ExtensionMenuRow[]): void {
  for (const row of rows) {
    if (!menuLocations().includes(row.location)) {
      throw new Error(`unknown menu location "${row.location}"`);
    }
    menuRows.push(row);
  }
  menuRows.sort((a, b) => a.group - b.group || a.order - b.order);
}

/** Extension rows for one menu location in display order. */
export function extensionMenuRowsFor(location: MenuLocation): readonly ExtensionMenuRow[] {
  return menuRows.filter((row) => row.location === location);
}

/** Register extension view-surface metadata (activity, panel, status, tool, view). */
export function registerExtensionViews(views: readonly ExtensionViewContribution[]): void {
  for (const view of views) {
    if (viewContributions.some((entry) => entry.surface === view.surface && entry.id === view.id)) {
      throw new Error(`duplicate extension ${view.surface} "${view.id}"`);
    }
    viewContributions.push(view);
  }
}

/** Extension view contributions for one surface. */
export function extensionViewsFor(surface: ExtensionViewContribution['surface']): readonly ExtensionViewContribution[] {
  return viewContributions.filter((view) => view.surface === surface);
}

/** Remove one extension view contribution (status item disposal). */
export function removeExtensionView(surface: ExtensionViewContribution['surface'], id: string): void {
  const index = viewContributions.findIndex((view) => view.surface === surface && view.id === id);
  if (index !== -1) viewContributions.splice(index, 1);
  statusTexts.delete(id);
  hiddenStatus.delete(id);
}

/** Update the click command of one extension view contribution. */
export function updateExtensionViewCommand(
  surface: ExtensionViewContribution['surface'],
  id: string,
  command: string | undefined,
): void {
  const view = viewContributions.find((entry) => entry.surface === surface && entry.id === id);
  if (view) view.command = command;
}

/** Track one installed extension package. */
export function trackInstalledExtension(packageId: string, manifest: OnryManifest): void {
  if (installed.has(packageId)) throw new Error(`extension already installed: ${packageId}`);
  installed.set(packageId, { packageId, manifest, active: false });
}

/** Mark one installed extension active or inactive. */
export function setExtensionActive(packageId: string, active: boolean): void {
  const record = installed.get(packageId);
  if (!record) throw new Error(`unknown extension: ${packageId}`);
  record.active = active;
}

/** Installed extension records in install order. */
export function installedExtensions(): readonly InstalledExtension[] {
  return [...installed.values()];
}

/** Reset all extension state (tests and full host teardown). */
export function resetExtensionState(): void {
  commandHandlers.clear();
  menuRows.length = 0;
  viewContributions.length = 0;
  statusTexts.clear();
  hiddenStatus.clear();
  installed.clear();
}

/** Dynamic status item text owned by extensions (default is the title). */
const statusTexts = new Map<string, string>();
const hiddenStatus = new Set<string>();

/** Read one extension status item's text (falls back to the contribution title). */
export function extensionStatusText(id: string, fallback: string): string {
  return statusTexts.get(id) ?? fallback;
}

/** Update one extension status item's text. */
export function setExtensionStatusText(id: string, text: string): void {
  statusTexts.set(id, text);
}

/** Hide or show one extension status item. */
export function setExtensionStatusVisible(id: string, visible: boolean): void {
  if (visible) hiddenStatus.delete(id);
  else hiddenStatus.add(id);
}

/** Whether one extension status item is visible. */
export function isExtensionStatusVisible(id: string): boolean {
  return !hiddenStatus.has(id);
}
