import { appCommandRegistry } from '../../registries/appCommands';
import { commandRegistry } from '../../registries/commands';
import { menuLocations, type MenuLocation } from '../../registries/menus';
import { iconIds } from '../../ui/iconRegistry';
import { GRLT_FORMAT_VERSION, grltPackageId, type GrltManifest } from './extensionManifest';

/** Handler behind one extension command id (JS-side intent, not an engine op). */
export type ExtensionCommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/** One extension menu row placed into an existing host menu location. */
export interface ExtensionMenuRow {
  location: MenuLocation;
  commandId: string;
  group: number;
  order: number;
  /** Owning package (`publisher.id`) for per-extension unload; absent is host-owned. */
  extensionId?: string;
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
  /** Owning package (`publisher.id`) for per-extension unload; absent is host-owned. */
  extensionId?: string;
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
        extensionId: grltPackageId(record.manifest),
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
  manifest: GrltManifest;
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
export function validateExtensionForHost(manifest: GrltManifest, hostVersion: string): string[] {
  const problems: string[] = [];
  if (manifest.formatVersion !== GRLT_FORMAT_VERSION) {
    problems.push(`unsupported formatVersion ${manifest.formatVersion}`);
  }
  if (!satisfiesEngines(manifest.engines.grafalith, hostVersion)) {
    problems.push(`engines.grafalith "${manifest.engines.grafalith}" incompatible with host ${hostVersion}`);
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
    activityBarItems: manifest.contributes?.activityBarItems,
    statusBarItems: manifest.contributes?.statusBarItems,
    diagramNodes: manifest.contributes?.diagramNodes,
    toolbarItems: manifest.contributes?.toolbarItems?.map((tool) => ({
      id: tool.id,
      title: tool.title,
      icon: tool.icon,
    })),
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
  const plainSections: Record<string, readonly { id: string; title: string }[] | undefined> = {
    homeWidgets: manifest.contributes?.homeWidgets,
    modals: manifest.contributes?.modals,
    assetProviders: manifest.contributes?.assetProviders,
  };
  for (const [section, items] of Object.entries(plainSections)) {
    for (const item of items ?? []) {
      if (item.id === '') problems.push(`contributed ${section} id must not be empty`);
      if (item.title === '') problems.push(`contributed ${section} "${item.id}" needs a title`);
    }
  }
  for (const [kind, tools] of Object.entries(manifest.contributes?.editorTools ?? {})) {
    if (!['design', 'whiteboard', 'slides'].includes(kind)) {
      problems.push(`unknown editorTools kind "${kind}"`);
    }
    for (const tool of tools ?? []) {
      if (tool.id === '') problems.push(`contributed editorTools.${kind} id must not be empty`);
      if (tool.title === '') problems.push(`contributed editorTools.${kind} "${tool.id}" needs a title`);
    }
  }
  for (const template of manifest.contributes?.projectTemplates ?? []) {
    if (template.id === '') problems.push('contributed projectTemplates id must not be empty');
    if (!['design', 'whiteboard', 'slides'].includes(template.kind)) {
      problems.push(`unknown projectTemplates kind "${template.kind}" for "${template.id}"`);
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

/** Remove every menu row owned by one package (disable/uninstall/unload). */
export function removeExtensionMenuRows(packageId: string): void {
  for (let index = menuRows.length - 1; index >= 0; index--) {
    if (menuRows[index].extensionId === packageId) menuRows.splice(index, 1);
  }
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

/** Remove every view owned by one package (disable/uninstall/unload). */
export function removeExtensionViews(packageId: string): void {
  for (let index = viewContributions.length - 1; index >= 0; index--) {
    const view = viewContributions[index];
    if (view.extensionId === packageId) {
      viewContributions.splice(index, 1);
      statusTexts.delete(view.id);
      hiddenStatus.delete(view.id);
    }
  }
}

/** One per-kind editor tool contributed by a extension. */
export interface ExtensionEditorTool {
  kind: 'design' | 'whiteboard' | 'slides';
  id: string;
  title: string;
  command: string;
  extensionId: string;
  icon?: string;
}

const editorTools: ExtensionEditorTool[] = [];

/** Register per-kind editor tools (toolbar rendering per editor family). */
export function registerExtensionEditorTools(tools: readonly ExtensionEditorTool[]): void {
  for (const tool of tools) {
    if (editorTools.some((entry) => entry.kind === tool.kind && entry.id === tool.id)) {
      throw new Error(`duplicate extension editor tool "${tool.kind}:${tool.id}"`);
    }
    editorTools.push(tool);
  }
}

/** Editor tools for one kind in registration order. */
export function extensionEditorToolsFor(kind: ExtensionEditorTool['kind']): readonly ExtensionEditorTool[] {
  return editorTools.filter((tool) => tool.kind === kind);
}

/** Reset editor-tool state (tests and full host teardown). */
export function resetExtensionEditorTools(): void {
  editorTools.length = 0;
}

/** Remove every editor tool owned by one package (disable/uninstall/unload). */
export function removeExtensionEditorTools(packageId: string): void {
  for (let index = editorTools.length - 1; index >= 0; index--) {
    if (editorTools[index].extensionId === packageId) editorTools.splice(index, 1);
  }
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
export function trackInstalledExtension(packageId: string, manifest: GrltManifest): void {
  if (installed.has(packageId)) throw new Error(`extension already installed: ${packageId}`);
  installed.set(packageId, { packageId, manifest, active: false });
}

/** Mark one installed extension active or inactive. */
export function setExtensionActive(packageId: string, active: boolean): void {
  const record = installed.get(packageId);
  if (!record) throw new Error(`unknown extension: ${packageId}`);
  record.active = active;
}

/** Forget one installed extension package (uninstall path). */
export function untrackInstalledExtension(packageId: string): void {
  installed.delete(packageId);
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
  resetExtensionEditorTools();
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
