import {
  executeExtensionCommand,
  hasExtensionCommand,
  registerExtensionCommand,
  registerExtensionMenuRows,
  registerExtensionViews,
  resetExtensionState,
  setExtensionActive,
  trackInstalledExtension,
  validateExtensionForHost,
  type InstalledExtension,
  type ExtensionCommandHandler,
  type ExtensionMenuRow,
  type ExtensionViewContribution,
} from './extensionContributions';
import { onryPackageId, validateOnryManifest, type OnryManifest } from './extensionManifest';
import { extractOnryFiles, extractOnryManifest } from './onryArchive';
import { createExtensionContext, type ExtensionContext } from './extensionContext';
import { createStartupQueue, type StartupQueue, type StartupTask } from '../boot/startupQueue';

/** Host API version extensions target through `engines.opennary`. */
export const EXTENSION_HOST_VERSION = '0.1.0';

/** Activation trigger the host fires (startup, command, or view). */
export type ExtensionTrigger =
  | { readonly kind: 'startup' }
  | { readonly kind: 'command'; readonly commandId: string }
  | { readonly kind: 'view'; readonly viewId: string };

/** Code module behind one installed extension (JS entry after unzip). */
export interface ExtensionModule {
  activate?: (ctx: ExtensionContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

/** Pending install: validated manifest plus its code module. */
interface ExtensionRecord {
  manifest: OnryManifest;
  module: ExtensionModule;
  activated: boolean;
  context: ExtensionContext | null;
}

/**
 * Desktop extension host: installs `.onry` packages, validates manifests
 * and contributions, activates on triggers, and exposes the extension command
 * bus to palettes and menus. One instance per window; no globals.
 */
export class DesktopExtensionHost {
  private readonly extensions = new Map<string, ExtensionRecord>();
  private readonly queue: StartupQueue = createStartupQueue();

  constructor(private readonly hostVersion: string) {}

  /** Validate and stage one `.onry` package (manifest JSON + code module). */
  install(manifestJson: unknown, module: ExtensionModule): { packageId?: string; errors: string[] } {
    const { manifest, errors } = validateOnryManifest(manifestJson);
    if (!manifest) return { errors };
    const problems = [...errors, ...validateExtensionForHost(manifest, this.hostVersion)];
    if (problems.length > 0) return { errors: problems };
    const packageId = onryPackageId(manifest);
    if (this.extensions.has(packageId)) return { errors: [`extension already installed: ${packageId}`] };
    this.extensions.set(packageId, { manifest, module, activated: false, context: null });
    trackInstalledExtension(packageId, manifest);
    return { packageId, errors: [] };
  }

  /** Toast notifier injected by the shell (defaults to a no-op). */
  setNotifier(
    notify: (message: string, options?: { level?: 'info' | 'success' | 'error'; action?: { label: string; commandId: string } }) => void,
  ): void {
    this.notifier = notify;
  }

  private notifier: (
    message: string,
    options?: { level?: 'info' | 'success' | 'error'; action?: { label: string; commandId: string } },
  ) => void = () => undefined;

  /**
   * Install one `.onry` archive from raw bytes: extract the manifest,
   * validate it, then load the entry module (`main`, default `index.js`).
   * The loader is injectable so tests stage modules without blob imports.
   */
  async installFromBytes(
    bytes: Uint8Array,
    loadModule: (files: Map<string, string>, main: string) => Promise<ExtensionModule> = loadExtensionModule,
  ): Promise<{ packageId?: string; errors: string[] }> {
    let manifestJson: unknown;
    let files: Map<string, string>;
    try {
      manifestJson = await extractOnryManifest(bytes);
      files = await extractOnryFiles(bytes);
    } catch (error) {
      return { errors: [error instanceof Error ? error.message : String(error)] };
    }
    const { manifest, errors } = validateOnryManifest(manifestJson);
    if (!manifest) return { errors };
    const problems = [...errors, ...validateExtensionForHost(manifest, this.hostVersion)];
    if (problems.length > 0) return { errors: problems };
    const packageId = onryPackageId(manifest);
    if (this.extensions.has(packageId)) return { errors: [`extension already installed: ${packageId}`] };
    let module: ExtensionModule;
    try {
      module = await loadModule(files, manifest.main ?? 'index.js');
    } catch (error) {
      return { errors: [`extension entry failed to load: ${error instanceof Error ? error.message : String(error)}`] };
    }
    this.extensions.set(packageId, { manifest, module, activated: false, context: null });
    trackInstalledExtension(packageId, manifest);
    return { packageId, errors: [] };
  }

  /** Register one extension command handler during activation. */
  registerCommand(id: string, handler: ExtensionCommandHandler): void {
    registerExtensionCommand(id, handler);
  }

  /** Contribute menu rows during activation (validated locations). */
  contributeMenus(rows: readonly ExtensionMenuRow[]): void {
    registerExtensionMenuRows(rows);
  }

  /** Contribute view surfaces during activation (activity, panel, status, tool, view). */
  contributeViews(views: readonly ExtensionViewContribution[]): void {
    registerExtensionViews(views);
  }

  /** Whether a trigger fires one activation event. */
  private matches(event: string, trigger: ExtensionTrigger): boolean {
    if (event === '*' || event === 'onStartup') return trigger.kind === 'startup';
    if (event.startsWith('onCommand:')) {
      return trigger.kind === 'command' && event.slice('onCommand:'.length) === trigger.commandId;
    }
    if (event.startsWith('onView:')) {
      return trigger.kind === 'view' && event.slice('onView:'.length) === trigger.viewId;
    }
    return false;
  }

  private wantsActivation(manifest: OnryManifest, trigger: ExtensionTrigger): boolean {
    const events = manifest.activationEvents;
    if (!events || events.length === 0) return true;
    return events.some((event) => this.matches(event, trigger));
  }

  /** Activate every staged extension matching a trigger; returns package ids started. */
  async activateByTrigger(trigger: ExtensionTrigger): Promise<string[]> {
    const started: string[] = [];
    for (const [packageId, record] of this.extensions) {
      if (record.activated || !this.wantsActivation(record.manifest, trigger)) continue;
      const ctx = createExtensionContext({
        packageId,
        notify: this.notifier,
        executeHostCommand: (id, ...args) => this.executeCommand(id, ...args),
      });
      record.context = ctx;
      await record.module.activate?.(ctx);
      record.activated = true;
      setExtensionActive(packageId, true);
      started.push(packageId);
    }
    return started;
  }

  /** Execute one extension command (palette, menu, and keybinding path). */
  executeCommand(id: string, ...args: unknown[]): Promise<{ ok: boolean; value?: unknown; reason?: string }> {
    if (!hasExtensionCommand(id) && this.shouldLazyActivate(id)) {
      return this.activateByTrigger({ kind: 'command', commandId: id }).then(() =>
        executeExtensionCommand(id, ...args),
      );
    }
    return executeExtensionCommand(id, ...args);
  }

  private shouldLazyActivate(commandId: string): boolean {
    for (const record of this.extensions.values()) {
      if (!record.activated && (record.manifest.activationEvents ?? []).includes(`onCommand:${commandId}`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Enqueue extension activation on the shared startup queue (normal priority,
   * extension tag) so project entry pauses it and resumes after ready.
   */
  enqueueStartupActivation(): void {
    try {
      this.queue.enqueue({
        id: 'extensions.activate',
        priority: 'normal',
        tag: 'extension',
        run: () => this.activateByTrigger({ kind: 'startup' }).then(() => undefined),
      });
    } catch {
      // Already enqueued for this window lifetime; one task is enough.
    }
  }

  pauseExtensions(): void {
    this.queue.pause('extension');
  }

  resumeExtensions(): void {
    this.queue.resume('extension');
  }

  drainStartupQueue(filter?: (task: StartupTask) => boolean): Promise<{ completed: string[]; failed: { id: string; message: string }[] }> {
    return this.queue.drain(filter);
  }

  /** Fan out a selection change to every active extension workspace. */
  emitSelection(ids: readonly string[]): void {
    for (const record of this.extensions.values()) {
      if (record.activated) record.context?.workspace.events.onDidChangeSelection.fire(ids);
    }
  }

  /** Fan out a document change to every active extension workspace. */
  emitDocument(projectId: string): void {
    for (const record of this.extensions.values()) {
      if (record.activated) record.context?.workspace.events.onDidChangeDocument.fire({ projectId });
    }
  }

  /** Deactivate everything in reverse install order and clear registries. */
  async disposeAll(): Promise<void> {
    for (const [packageId, record] of [...this.extensions].reverse()) {
      try {
        await record.module.deactivate?.();
      } finally {
        setExtensionActive(packageId, false);
      }
    }
    this.extensions.clear();
    resetExtensionState();
  }

  installed(): string[] {
    return [...this.extensions.keys()];
  }
}

/**
 * Default entry loader: import the extension `main` file from extracted text
 * through a blob URL. The module must export `activate` (and optionally
 * `deactivate`); anything else is ignored.
 */
export async function loadExtensionModule(files: Map<string, string>, main: string): Promise<ExtensionModule> {
  const source = files.get(main);
  if (source === undefined) throw new Error(`archive misses entry module: ${main}`);
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const module = (await import(/* @vite-ignore */ url)) as Partial<ExtensionModule>;
    if (module.activate !== undefined && typeof module.activate !== 'function') {
      throw new Error('extension entry must export an activate function');
    }
    return { activate: module.activate, deactivate: module.deactivate };
  } finally {
    URL.revokeObjectURL(url);
  }
}

let sharedHost: DesktopExtensionHost | null = null;

/** Window-shared extension host (one install registry per window). */
export function getExtensionHost(): DesktopExtensionHost {
  if (!sharedHost) sharedHost = new DesktopExtensionHost(EXTENSION_HOST_VERSION);
  return sharedHost;
}

/** Drop the shared host (tests and full teardown). */
export async function resetExtensionHost(): Promise<void> {
  if (sharedHost) {
    await sharedHost.disposeAll();
    sharedHost = null;
  }
}

export type { InstalledExtension };
