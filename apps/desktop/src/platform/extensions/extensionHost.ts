// Desktop extension host: phased lifecycle with per-extension isolation.
//
// Phases: Core Bootstrap (registries, events, context keys — owned by the
// shell before this host runs) -> Discovery & Validation (install +
// installFromBytes) -> Home Ready (onStartup/onHome) -> Editor Bootstrap
// (onProject/onEditor:*) -> Deactivation (editor scope, then full dispose).
//
// Every failure is per-extension: toast the reason, mark the status,
// write detail to the extension and system output channels, and keep the
// app and every other extension running. One bad activate() never blocks
// the rest of the phase.
import {
  executeExtensionCommand,
  hasExtensionCommand,
  registerExtensionCommand,
  registerExtensionMenuRows,
  registerExtensionViews,
  resetExtensionState,
  setExtensionActive,
  trackInstalledExtension,
  untrackInstalledExtension,
  validateExtensionForHost,
  type InstalledExtension,
  type ExtensionCommandHandler,
  type ExtensionMenuRow,
  type ExtensionViewContribution,
} from './extensionContributions';
import {
  registerManifestContributions,
  resetManifestCatalog,
  unregisterManifestContributions,
} from './manifestContributions';
import { resetHomeContributions } from './homeContributions';
import { grltPackageId, validateGrltManifest, type GrltManifest } from './extensionManifest';
import { extractGrltFiles, extractGrltManifest } from './grltArchive';
import { createExtensionContext, type ExtensionContext } from './extensionContext';
import { createStartupQueue, type StartupQueue, type StartupTask } from '../boot/startupQueue';
import { resolveDependencies } from './dependencyResolver';
import { formatExtensionMessage } from './extensionMessages';
import { getExtensionStatuses, type ExtensionStatus } from './extensionStatus';
import { getOutputChannels } from './outputChannel';

/** Host API version extensions target through `engines.grafalith`. */
export const EXTENSION_HOST_VERSION = '0.1.0';

/** Activation timeout: slow extensions fail alone instead of blocking boot. */
export const ACTIVATION_TIMEOUT_MS = 5000;

/** Deactivation timeout: teardown always converges. */
export const DEACTIVATION_TIMEOUT_MS = 3000;

/** Activation trigger the host fires (startup, home, project, editor, command, view). */
export type ExtensionTrigger =
  | { readonly kind: 'startup' }
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly projectId?: string }
  | { readonly kind: 'editor'; readonly editorType: 'design' | 'whiteboard' | 'slides' | '*' }
  | { readonly kind: 'command'; readonly commandId: string }
  | { readonly kind: 'view'; readonly viewId: string };

/** Code module behind one installed extension (JS entry after unzip). */
export interface ExtensionModule {
  activate?: (ctx: ExtensionContext) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

/** Pending install: validated manifest plus its code module. */
interface ExtensionRecord {
  manifest: GrltManifest;
  module: ExtensionModule;
  activated: boolean;
  /** Editor-scoped activations unload when the editor closes. */
  editorScoped: boolean;
  context: ExtensionContext | null;
}

export type NotifyOptions = {
  level?: 'info' | 'success' | 'warning' | 'error';
  action?: { label: string; commandId: string };
  actions?: readonly { label: string; commandId: string }[];
  duration?: number;
  source?: string;
};

/** Run a promise with a timeout; rejects with a typed timeout error. */
async function withTimeout<T>(work: Promise<T>, millis: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${millis}ms`)), millis);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
  * Desktop extension host: installs `.grlt` packages, validates manifests
 * and contributions, activates on triggers, and exposes the extension command
 * bus to palettes and menus. One instance per window; no globals.
 */
export class DesktopExtensionHost {
  private readonly extensions = new Map<string, ExtensionRecord>();
  private readonly queue: StartupQueue = createStartupQueue();
  private readonly devWatchers = new Map<string, () => void>();
  /** Packages whose manifest contributions are currently registered. */
  private readonly contributionsRegistered = new Set<string>();

  constructor(private readonly hostVersion: string) {}

  private statuses() {
    return getExtensionStatuses();
  }

  private system() {
    return getOutputChannels().system();
  }

  private channelFor(packageId: string) {
    return getOutputChannels().channel(packageId);
  }

  private toast(message: string, options?: NotifyOptions): void {
    try {
      this.notifier(message, options);
    } catch {
      // Toasts never break activation.
    }
  }

  /** Register one package's manifest contributions (install/enable path). */
  private stageContributions(packageId: string, manifest: GrltManifest): void {
    if (this.contributionsRegistered.has(packageId)) return;
    const problems = registerManifestContributions(packageId, manifest);
    this.contributionsRegistered.add(packageId);
    for (const problem of problems) {
      this.system().appendLine(`[contributes] ${packageId}: skipped contribution — ${problem}`);
      this.channelFor(packageId).appendLine(`[WARN] invalid contribution skipped — ${problem}`);
    }
    if (problems.length > 0) {
      this.toast(
        formatExtensionMessage('notifications.extensions.contributionsSkipped', {
          id: packageId,
          count: problems.length,
        }),
        { level: 'warning', source: packageId },
      );
    }
  }

  /** Remove one package's manifest contributions (disable/uninstall/unload). */
  private unstageContributions(packageId: string): void {
    if (!this.contributionsRegistered.has(packageId)) return;
    this.contributionsRegistered.delete(packageId);
    unregisterManifestContributions(packageId);
  }

  /** Validate and stage one `.grlt` package (manifest JSON + code module). */
  install(manifestJson: unknown, module: ExtensionModule): { packageId?: string; errors: string[] } {
    const { manifest, errors } = validateGrltManifest(manifestJson);
    if (!manifest) {
      this.system().appendLine(`[discovery] skipped package: manifest invalid — ${errors.join('; ')}`);
      return { errors };
    }
    const packageId = grltPackageId(manifest);
    this.statuses().set(packageId, 'DISCOVERED');
    this.statuses().set(packageId, 'VALIDATING');
    const problems = [...errors, ...validateExtensionForHost(manifest, this.hostVersion)];
    if (problems.length > 0) {
      const incompatible = problems.some((problem) => problem.includes('incompatible'));
      const status: ExtensionStatus = incompatible ? 'INCOMPATIBLE_VERSION' : 'INVALID_MANIFEST';
      this.statuses().set(packageId, status, problems.join('; '));
      this.system().appendLine(`[validation] ${packageId}: ${status} — ${problems.join('; ')}`);
      if (incompatible) {
        this.toast(formatExtensionMessage('notifications.extensions.engineIncompatible', { id: packageId }), {
          level: 'warning',
          source: packageId,
        });
      } else {
        this.toast(
          formatExtensionMessage('notifications.extensions.manifestInvalid', {
            id: packageId,
            detail: problems[0],
          }),
          {
            level: 'error',
            source: packageId,
          },
        );
      }
      return { errors: problems };
    }
    if (this.extensions.has(packageId)) return { errors: [`extension already installed: ${packageId}`] };
    if (this.statuses().isDisabled(packageId)) {
      this.system().appendLine(`[discovery] ${packageId}: disabled by user — staged but not activated`);
    } else {
      this.statuses().set(packageId, 'VALID');
      this.stageContributions(packageId, manifest);
    }
    this.extensions.set(packageId, { manifest, module, activated: false, editorScoped: false, context: null });
    try {
      trackInstalledExtension(packageId, manifest);
    } catch {
      // Already tracked (re-enable path): staging above is enough.
    }
    this.system().appendLine(`[discovery] ${packageId}@${manifest.version}: valid, staged`);
    return { packageId, errors: [] };
  }

  /** Push a toast through the shell notifier (manager/watcher path). */
  notifyToast(message: string, options?: NotifyOptions): void {
    this.toast(message, options);
  }

  /** Toast notifier injected by the shell (defaults to a no-op). */
  setNotifier(notify: (message: string, options?: NotifyOptions) => void): void {
    this.notifier = notify;
  }

  private notifier: (message: string, options?: NotifyOptions) => void = () => undefined;

  /**
   * Install one `.grlt` archive from raw bytes: extract the manifest,
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
      manifestJson = await extractGrltManifest(bytes);
      files = await extractGrltFiles(bytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.system().appendLine(`[discovery] skipped archive: no manifest — ${message}`);
      this.toast(formatExtensionMessage('notifications.extensions.archiveNoManifest'), { level: 'warning' });
      return { errors: [message] };
    }
    const { manifest, errors } = validateGrltManifest(manifestJson);
    if (!manifest) {
      this.system().appendLine(`[validation] skipped archive: invalid manifest — ${errors.join('; ')}`);
      this.toast(
        formatExtensionMessage('notifications.extensions.archiveManifestInvalid', {
          detail: errors[0] ?? 'unknown',
        }),
        { level: 'error' },
      );
      return { errors };
    }
    const packageId = grltPackageId(manifest);
    this.statuses().set(packageId, 'DISCOVERED');
    this.statuses().set(packageId, 'VALIDATING');
    const problems = [...errors, ...validateExtensionForHost(manifest, this.hostVersion)];
    if (problems.length > 0) {
      const incompatible = problems.some((problem) => problem.includes('incompatible'));
      this.statuses().set(packageId, incompatible ? 'INCOMPATIBLE_VERSION' : 'INVALID_MANIFEST', problems.join('; '));
      this.system().appendLine(`[validation] ${packageId}: skipped — ${problems.join('; ')}`);
      this.toast(
        incompatible
          ? formatExtensionMessage('notifications.extensions.engineIncompatible', { id: packageId })
          : formatExtensionMessage('notifications.extensions.manifestInvalid', {
              id: packageId,
              detail: problems[0],
            }),
        { level: incompatible ? 'warning' : 'error', source: packageId },
      );
      return { errors: problems };
    }
    if (this.extensions.has(packageId)) return { errors: [`extension already installed: ${packageId}`] };
    let module: ExtensionModule;
    try {
      module = await loadModule(files, manifest.main ?? 'index.js');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.statuses().set(packageId, 'LOAD_FAILED', message);
      this.system().appendLine(`[loading] ${packageId}: entry point missing — ${message}`);
      this.channelFor(packageId).appendLine(`[ERROR] entry point failed to load: ${message}`);
      this.toast(formatExtensionMessage('notifications.extensions.entryMissing', { id: packageId }), {
        level: 'error',
        source: packageId,
      });
      return { errors: [`extension entry failed to load: ${message}`] };
    }
    if (module.activate !== undefined && typeof module.activate !== 'function') {
      this.statuses().set(packageId, 'INVALID_ENTRY', 'activate() is missing or not a function');
      this.toast(formatExtensionMessage('notifications.extensions.invalidEntry', { id: packageId }), {
        level: 'error',
        source: packageId,
      });
      return { errors: ['extension entry must export an activate function'] };
    }
    this.statuses().set(packageId, this.statuses().isDisabled(packageId) ? 'DISABLED' : 'VALID');
    if (!this.statuses().isDisabled(packageId)) this.stageContributions(packageId, manifest);
    this.extensions.set(packageId, { manifest, module, activated: false, editorScoped: false, context: null });
    try {
      trackInstalledExtension(packageId, manifest);
    } catch {
      // Already tracked (re-enable path).
    }
    this.system().appendLine(`[discovery] ${packageId}@${manifest.version}: valid, staged`);
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

  /** Current status of one extension (Extension Manager renders this). */
  statusOf(packageId: string): ExtensionStatus {
    if (this.extensions.has(packageId)) {
      const record = this.extensions.get(packageId);
      if (record?.activated) return 'ACTIVE';
    }
    return this.statuses().get(packageId);
  }

  /** Every installed extension with its status and failure reason. */
  allStatuses(): { packageId: string; status: ExtensionStatus; reason?: string }[] {
    return this.installed().map((packageId) => ({
      packageId,
      status: this.statusOf(packageId),
      reason: this.statuses().reason(packageId),
    }));
  }

  /** Open the output channel of one extension (Extension Manager action). */
  showOutput(packageId: string): void {
    this.channelFor(packageId).show();
  }

  /** Open the system channel (palette: `grafalith.output.showSystem`). */
  showSystemOutput(): void {
    this.system().show();
  }

  /** Whether a trigger fires one activation event. */
  private matches(event: string, trigger: ExtensionTrigger): boolean {
    if (event === '*' || event === 'onStartup') return trigger.kind === 'startup';
    if (event === 'onHome') return trigger.kind === 'home';
    if (event === 'onProject') return trigger.kind === 'project';
    if (event === 'onEditor:*') return trigger.kind === 'editor';
    if (event.startsWith('onEditor:')) {
      return trigger.kind === 'editor' && event.slice('onEditor:'.length) === trigger.editorType;
    }
    if (event.startsWith('onCommand:')) {
      return trigger.kind === 'command' && event.slice('onCommand:'.length) === trigger.commandId;
    }
    if (event.startsWith('onView:')) {
      return trigger.kind === 'view' && event.slice('onView:'.length) === trigger.viewId;
    }
    return false;
  }

  private wantsActivation(manifest: GrltManifest, trigger: ExtensionTrigger): boolean {
    const events = manifest.activationEvents;
    if (!events || events.length === 0) return true;
    return events.some((event) => this.matches(event, trigger));
  }

  /** Phase order: high priority first, then dependency-free, then dependents. */
  private phaseOrder(ids: readonly string[]): string[] {
    return [...ids].sort((a, b) => {
      const manifestA = this.extensions.get(a)?.manifest;
      const manifestB = this.extensions.get(b)?.manifest;
      const priorityA = manifestA?.priority === 'high' ? 0 : 1;
      const priorityB = manifestB?.priority === 'high' ? 0 : 1;
      if (priorityA !== priorityB) return priorityA - priorityB;
      const depsA = Object.keys(manifestA?.dependencies ?? {}).length;
      const depsB = Object.keys(manifestB?.dependencies ?? {}).length;
      return depsA - depsB;
    });
  }

  private async activateOne(packageId: string, trigger: ExtensionTrigger): Promise<boolean> {
    const record = this.extensions.get(packageId);
    if (!record || record.activated) return false;
    if (this.statuses().isDisabled(packageId)) {
      this.system().appendLine(`[activation] ${packageId}: disabled — skipped`);
      return false;
    }
    const output = this.channelFor(packageId);
    this.statuses().set(packageId, 'LOADING');
    this.system().appendLine(`[activation] ${packageId}: loading (${trigger.kind})`);
    this.stageContributions(packageId, record.manifest);
    const ctx = createExtensionContext({
      packageId,
      version: record.manifest.version,
      permissions: record.manifest.permissions ?? [],
      notify: this.notifier,
      executeHostCommand: (id, ...args) => this.executeCommand(id, ...args),
    });
    // Permission misuse is a runtime deny: log it where the author looks.
    const guarded = new Proxy(ctx, {
      get(target, property, receiver) {
        return Reflect.get(target, property, receiver);
      },
    });
    record.context = guarded;
    try {
      if (record.module.activate === undefined) {
        this.statuses().set(packageId, 'INVALID_ENTRY', 'activate() is missing or not a function');
        output.appendLine('[ERROR] activate() is missing or not a function');
        this.toast(formatExtensionMessage('notifications.extensions.invalidEntry', { id: packageId }), {
          level: 'error',
          source: packageId,
        });
        record.context = null;
        return false;
      }
      await withTimeout(Promise.resolve().then(() => record.module.activate?.(guarded)), ACTIVATION_TIMEOUT_MS, `activate ${packageId}`);
      record.activated = true;
      record.editorScoped = trigger.kind === 'editor' || trigger.kind === 'project';
      setExtensionActive(packageId, true);
      this.statuses().set(packageId, 'ACTIVE');
      this.system().appendLine(`[activation] ${packageId}: active`);
      output.appendLine('[INFO] extension activated successfully');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timedOut = message.includes('timed out');
      // Run partial cleanup: disposables registered before the throw.
      for (const subscription of guarded.subscriptions.splice(0)) {
        try {
          subscription.dispose();
        } catch {
          // One bad disposable never blocks the rest of teardown.
        }
      }
      record.context = null;
      this.statuses().set(packageId, timedOut ? 'ACTIVATION_TIMEOUT' : 'ACTIVATION_FAILED', message);
      output.appendLine(`[ERROR] activation failed: ${message}`);
      this.system().appendLine(`[activation] ${packageId}: failed — ${message}`);
      if (message.includes('lacks permission')) {
        this.toast(
          formatExtensionMessage('notifications.extensions.permissionDenied', { id: packageId }),
          { level: 'warning', source: packageId },
        );
      } else if (timedOut) {
        this.toast(
          formatExtensionMessage('notifications.extensions.activationTimeout', { id: packageId }),
          { level: 'warning', source: packageId },
        );
      } else {
        this.toast(
          formatExtensionMessage('notifications.extensions.activationFailed', {
            id: packageId,
            message,
          }),
          { level: 'error', source: packageId },
        );
      }
      return false;
    }
  }

  /** Activate every staged extension matching a trigger; returns package ids started. */
  async activateByTrigger(trigger: ExtensionTrigger): Promise<string[]> {
    const started: string[] = [];
    const candidates = this.phaseOrder(
      [...this.extensions]
        .filter(([, record]) => !record.activated && this.wantsActivation(record.manifest, trigger))
        .map(([packageId]) => packageId),
    );
    if (candidates.length === 0) return started;
    const failed = new Set(
      this.installed().filter((id) => {
        const status = this.statuses().get(id);
        return status === 'INVALID_MANIFEST' || status === 'INCOMPATIBLE_VERSION' || status === 'ACTIVATION_FAILED' || status === 'ACTIVATION_TIMEOUT' || status === 'LOAD_FAILED' || status === 'INVALID_ENTRY';
      }),
    );
    const resolution = resolveDependencies(
      candidates.map((packageId) => ({
        packageId,
        dependencies: this.extensions.get(packageId)?.manifest.dependencies,
      })),
      new Map(candidates.map((packageId) => [packageId, this.extensions.get(packageId)?.manifest.version ?? '0.0.0'])),
      failed,
    );
    for (const { packageId, dependency } of resolution.missing) {
      this.statuses().set(packageId, 'MISSING_DEPENDENCY', `dependency ${dependency} is not installed`);
      this.system().appendLine(`[validation] ${packageId}: skipped — dependency ${dependency} is not installed`);
      this.toast(
        formatExtensionMessage('notifications.extensions.missingDependency', {
          id: packageId,
          dependency,
        }),
        { level: 'warning', source: packageId },
      );
    }
    for (const { packageId, dependency } of resolution.blocked) {
      this.statuses().set(packageId, 'MISSING_DEPENDENCY', `dependency ${dependency} failed`);
      this.system().appendLine(`[validation] ${packageId}: skipped — dependency ${dependency} failed`);
      this.toast(
        formatExtensionMessage('notifications.extensions.blockedDependency', {
          id: packageId,
          dependency,
        }),
        { level: 'warning', source: packageId },
      );
    }
    for (const cycle of resolution.cycles) {
      for (const packageId of cycle) {
        this.statuses().set(packageId, 'CIRCULAR_DEPENDENCY', `circular: ${cycle.join(' → ')}`);
      }
      this.system().appendLine(`[validation] circular dependency detected: ${cycle.join(' → ')} — skipped`);
      this.toast(
        formatExtensionMessage('notifications.extensions.circularDependency', {
          cycle: cycle.join(' → '),
        }),
        { level: 'error' },
      );
    }
    for (const { packageId, dependency, range, installed } of resolution.versionMismatch) {
      this.statuses().set(packageId, 'INCOMPATIBLE_VERSION', `${dependency} ${installed} does not satisfy ${range}`);
      this.system().appendLine(`[validation] ${packageId}: dependency ${dependency} ${installed} does not satisfy ${range}`);
      this.toast(
        formatExtensionMessage('notifications.extensions.dependencyIncompatible', {
          id: packageId,
          dependency,
        }),
        { level: 'warning', source: packageId },
      );
    }
    const skipped = new Set([
      ...resolution.missing.map((entry) => entry.packageId),
      ...resolution.blocked.map((entry) => entry.packageId),
      ...resolution.cycles.flat(),
      ...resolution.versionMismatch.map((entry) => entry.packageId),
    ]);
    for (const packageId of this.phaseOrder(resolution.ordered)) {
      if (skipped.has(packageId)) continue;
      if (await this.activateOne(packageId, trigger)) started.push(packageId);
    }
    return started;
  }

  /** Phase 3: Home ready — `onStartup` already ran, now `onHome`. */
  activateHome(): Promise<string[]> {
    return this.activateByTrigger({ kind: 'home' });
  }

  /** Phase 4: a project opened — `onProject` before editor-kind triggers. */
  async activateProject(projectId: string): Promise<string[]> {
    return this.activateByTrigger({ kind: 'project', projectId });
  }

  /** Phase 4: editor mounted — `onEditor:*` plus the concrete kind. */
  activateEditor(editorType: 'design' | 'whiteboard' | 'slides'): Promise<string[]> {
    return this.activateByTrigger({ kind: 'editor', editorType });
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
      if (record.activated) {
        try {
          record.context?.workspace.events.onDidChangeSelection.fire(ids);
        } catch {
          // One bad listener never breaks selection for the rest.
        }
      }
    }
  }

  /** Fan out a document change to every active extension workspace. */
  emitDocument(projectId: string): void {
    for (const record of this.extensions.values()) {
      if (record.activated) {
        try {
          record.context?.workspace.events.onDidChangeDocument.fire({ projectId });
          record.context?.workspace.events.onDidOpenProject.fire({ projectId });
        } catch {
          // Listener isolation: keep fanning out.
        }
      }
    }
  }

  /** Fan out editor-close so extensions persist and release editor state. */
  emitProjectClosed(projectId: string): void {
    for (const record of this.extensions.values()) {
      if (record.activated) {
        try {
          record.context?.workspace.events.onDidCloseProject.fire({ projectId });
        } catch {
          // Listener isolation.
        }
      }
    }
  }

  /** Fan out active-editor switches (design/whiteboard/slides). */
  emitActiveEditor(editorType: string): void {
    for (const record of this.extensions.values()) {
      if (record.activated) {
        try {
          record.context?.workspace.events.onDidChangeActiveEditor.fire({ editorType });
        } catch {
          // Listener isolation.
        }
      }
    }
  }

  private async deactivateOne(packageId: string): Promise<void> {
    const record = this.extensions.get(packageId);
    if (!record || !record.activated) return;
    const output = this.channelFor(packageId);
    try {
      await withTimeout(
        Promise.resolve().then(() => record.module.deactivate?.()),
        DEACTIVATION_TIMEOUT_MS,
        `deactivate ${packageId}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[WARN] deactivate() failed: ${message} — forced cleanup ran`);
      this.system().appendLine(`[deactivation] ${packageId}: deactivate error — ${message}`);
    } finally {
      for (const subscription of record.context?.subscriptions.splice(0) ?? []) {
        try {
          subscription.dispose();
        } catch {
          // One bad disposable never blocks the rest of teardown.
        }
      }
      record.activated = false;
      record.editorScoped = false;
      record.context = null;
      try {
        setExtensionActive(packageId, false);
      } catch {
        // Untracked in contributions (enable/disable path): skip.
      }
      if (this.statuses().get(packageId) === 'ACTIVE') this.statuses().set(packageId, 'DEACTIVATED');
    }
  }

  /**
   * Unload editor-scoped extensions when returning Home: deactivate in
   * reverse order and dispose subscriptions so canvas state never leaks.
   */
  async deactivateEditorScope(): Promise<string[]> {
    const stopped: string[] = [];
    for (const [packageId, record] of [...this.extensions].reverse()) {
      if (!record.activated || !record.editorScoped) continue;
      await this.deactivateOne(packageId);
      this.unstageContributions(packageId);
      stopped.push(packageId);
    }
    return stopped;
  }

  /** Disable one extension without restarting: deactivate + drop contributions. */
  async disable(packageId: string): Promise<boolean> {
    if (!this.extensions.has(packageId)) return false;
    await this.deactivateOne(packageId);
    this.unstageContributions(packageId);
    this.statuses().set(packageId, 'DISABLED');
    this.system().appendLine(`[manager] ${packageId}: disabled by user`);
    this.toast(formatExtensionMessage('notifications.extensions.disabled', { id: packageId }), {
      level: 'info',
      source: packageId,
    });
    return true;
  }

  /** Enable one extension without restarting: re-run validation + activation. */
  async enable(packageId: string): Promise<boolean> {
    const record = this.extensions.get(packageId);
    if (!record) return false;
    this.statuses().set(packageId, 'VALID');
    this.stageContributions(packageId, record.manifest);
    this.system().appendLine(`[manager] ${packageId}: enabled by user — activating`);
    const trigger = record.manifest.activationEvents?.[0]?.startsWith('onEditor:')
      ? { kind: 'editor' as const, editorType: 'design' as const }
      : { kind: 'startup' as const };
    const started = await this.activateByTrigger(trigger);
    return started.includes(packageId) || this.statusOf(packageId) === 'ACTIVE';
  }

  /** Reload one extension without restarting (disable then enable). */
  async reload(packageId: string): Promise<boolean> {
    if (!this.extensions.has(packageId)) return false;
    await this.deactivateOne(packageId);
    this.unstageContributions(packageId);
    this.statuses().set(packageId, 'VALID');
    const record = this.extensions.get(packageId);
    if (record) this.stageContributions(packageId, record.manifest);
    this.system().appendLine(`[manager] ${packageId}: reloaded`);
    this.toast(formatExtensionMessage('notifications.extensions.reloaded', { id: packageId }), {
      level: 'info',
      source: packageId,
    });
    return this.activateOne(packageId, { kind: 'startup' });
  }

  /** Uninstall one extension: deactivate, drop state, remove its channel. */
  async uninstall(packageId: string): Promise<boolean> {
    if (!this.extensions.has(packageId)) return false;
    await this.deactivateOne(packageId);
    this.unstageContributions(packageId);
    untrackInstalledExtension(packageId);
    this.extensions.delete(packageId);
    getOutputChannels().remove(packageId);
    this.system().appendLine(`[manager] ${packageId}: uninstalled`);
    this.toast(formatExtensionMessage('notifications.extensions.uninstalled', { id: packageId }), {
      level: 'info',
      source: packageId,
    });
    return true;
  }

  /**
   * Development hot-reload: watch a callback that fires on file change.
   * The host deactivates, then re-activates the extension; failures leave
   * it disabled with a toast until the next successful reload.
   */
  watchForDevReload(packageId: string, subscribe: (reload: () => void) => () => void): boolean {
    if (!this.extensions.has(packageId)) return false;
    this.devWatchers.get(packageId)?.();
    const unsubscribe = subscribe(() => {
      void this.reload(packageId).then((ok) => {
        if (!ok) {
          this.toast(formatExtensionMessage('notifications.extensions.reloadFailed', { id: packageId }), {
            level: 'error',
            source: packageId,
          });
        }
      });
    });
    this.devWatchers.set(packageId, unsubscribe);
    return true;
  }

  /** Deactivate everything in reverse install order and clear registries. */
  async disposeAll(): Promise<void> {
    for (const [packageId] of [...this.extensions].reverse()) {
      await this.deactivateOne(packageId);
    }
    for (const unsubscribe of this.devWatchers.values()) {
      try {
        unsubscribe();
      } catch {
        // Watcher teardown never blocks dispose.
      }
    }
    this.devWatchers.clear();
    this.extensions.clear();
    this.contributionsRegistered.clear();
    resetExtensionState();
    resetManifestCatalog();
    resetHomeContributions();
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
