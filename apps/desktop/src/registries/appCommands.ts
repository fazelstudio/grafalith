import { createRegistry, type Descriptor } from './core';

/** Host scope a host command operates in. Engine intents stay in commands.ts. */
export type AppCommandScope =
  | 'application'
  | 'navigation'
  | 'project'
  | 'panel'
  | 'dialog'
  | 'notification'
  | 'window'
  | 'tool'
  | 'view';

/** Palette grouping for host commands. */
export type AppCommandCategory =
  | 'navigation'
  | 'project'
  | 'panel'
  | 'dialog'
  | 'notification'
  | 'window'
  | 'tool'
  | 'view';

/** Where a host command may render. Mirrors engine surfaces plus app chrome. */
export type AppCommandSurface = 'menu' | 'contextMenu' | 'palette' | 'activityBar' | 'statusBar';

/** Enablement verdict shared with the engine command model. */
export type AppCommandVerdict = { executable: true } | { executable: false; reason: string };

/** Execution outcome shared with the engine command model. */
export type AppCommandResult =
  | { status: 'ok' }
  | { status: 'disabled'; reason: string }
  | { status: 'notApplicable'; reason?: string };

/**
 * Host capabilities injected by the shell. Every field is optional so a
 * command degrades to disabled instead of throwing when its owner is absent.
 * This keeps home, editor, and tests on one execution path.
 */
export interface AppCommandContext {
  navigate?: (path: string) => void;
  openProject?: (id: string) => void;
  newProject?: (kind: string) => void;
  saveProject?: () => void | Promise<void>;
  duplicateProject?: () => void | Promise<void>;
  requestClose?: () => void;
  openPanels?: readonly string[];
  togglePanel?: (id: string) => void;
  openDialog?: (id: 'settings' | 'quickSwitcher' | 'createProject' | 'closeConfirm') => void;
  closeDialog?: () => void;
  notify?: (message: string) => void;
  toggleSidebar?: () => void;
  windowAction?: (action: 'minimize' | 'maximizeRestore' | 'close') => void | Promise<void>;
  activateTool?: (id: string) => void;
  runViewCommand?: (id: string) => void | Promise<void>;
  /** Targeted project for card-scoped commands (home menu, editor duplicate). */
  targetProjectId?: string;
  /** Targeted kind for project creation (design, whiteboard, diagram). */
  targetKind?: string;
  /** Targeted name for creation and rename dialogs. */
  targetName?: string;
  /** Refresh the home list after a store mutation. */
  refreshHome?: () => void | Promise<void>;
  /** Open a settings section page (`#/settings/<section>`). */
  openSettingsSection?: (section: string) => void;
  /** Pick one `.onry` package file (host file dialog or hidden input). */
  pickExtensionFile?: () => Promise<File | undefined>;
  /** Install one picked package from raw bytes. */
  installExtensionBytes?: (bytes: Uint8Array, name: string) => Promise<{ packageId?: string; errors: string[] }>;
  /**
   * Store-backed project operations. Home and the editor inject the same
   * project-store calls here so every CRUD path shares one command.
   */
  createProject?: (name: string, kind: string) => Promise<{ id: string } | void>;
  renameProject?: (id: string, name: string) => Promise<void>;
  deleteProject?: (id: string) => Promise<void>;
  toggleFavorite?: (id: string) => Promise<void>;
}

/** Declarative description of one host action. */
export interface AppCommandDefinition extends Descriptor {
  scope: AppCommandScope;
  category: AppCommandCategory;
  surfaces: readonly AppCommandSurface[];
  keywords?: readonly string[];
  icon?: string;
  descriptionKey?: string;
  defaultDescription?: string;
  canExecute: (ctx: AppCommandContext) => AppCommandVerdict;
  execute: (ctx: AppCommandContext) => unknown;
}

function enabled(): AppCommandVerdict {
  return { executable: true };
}

function disabled(reason: string): AppCommandVerdict {
  return { executable: false, reason };
}

function needsCallback(ctx: AppCommandContext, key: keyof AppCommandContext): AppCommandVerdict {
  return ctx[key] !== undefined ? enabled() : disabled('unavailable');
}

const APP_COMMANDS: readonly AppCommandDefinition[] = [
  {
    id: 'navigation.goHome',
    labelKey: 'navigation.projects',
    defaultLabel: 'Go to Projects',
    descriptionKey: 'navigation.goHomeDescription',
    defaultDescription: 'Open the projects home',
    scope: 'navigation',
    category: 'navigation',
    surfaces: ['menu', 'palette'],
    keywords: ['home', 'projects', 'go'],
    icon: 'projects',
    canExecute: (ctx) => needsCallback(ctx, 'navigate'),
    execute: (ctx) => ctx.navigate?.('#/'),
  },
  {
    id: 'navigation.goTrash',
    labelKey: 'navigation.trash',
    defaultLabel: 'Go to Trash',
    descriptionKey: 'navigation.goTrashDescription',
    defaultDescription: 'Open the trash',
    scope: 'navigation',
    category: 'navigation',
    surfaces: ['menu', 'palette'],
    keywords: ['trash', 'deleted', 'go'],
    icon: 'trash',
    canExecute: (ctx) => needsCallback(ctx, 'navigate'),
    execute: (ctx) => ctx.navigate?.('#/trash'),
  },
  {
    id: 'navigation.goSettings',
    labelKey: 'navigation.settings',
    defaultLabel: 'Go to Settings',
    descriptionKey: 'navigation.goSettingsDescription',
    defaultDescription: 'Open settings',
    scope: 'navigation',
    category: 'navigation',
    surfaces: ['menu', 'palette'],
    keywords: ['settings', 'preferences', 'go'],
    icon: 'settings',
    canExecute: (ctx) => needsCallback(ctx, 'navigate'),
    execute: (ctx) => ctx.navigate?.('#/settings'),
  },
  {
    id: 'navigation.backToHome',
    labelKey: 'navigation.backToHome',
    defaultLabel: 'Back to home',
    descriptionKey: 'navigation.backToHomeDescription',
    defaultDescription: 'Leave the editor and return home',
    scope: 'navigation',
    category: 'navigation',
    surfaces: ['menu', 'palette'],
    keywords: ['back', 'home', 'close editor'],
    icon: 'back',
    canExecute: (ctx) =>
      ctx.navigate !== undefined || ctx.requestClose !== undefined ? enabled() : disabled('unavailable'),
    execute: (ctx) => {
      if (ctx.requestClose) ctx.requestClose();
      else ctx.navigate?.('#/');
    },
  },
  {
    id: 'project.new',
    labelKey: 'editor.menu.new',
    defaultLabel: 'New project',
    descriptionKey: 'editor.menu.newDescription',
    defaultDescription: 'Create a new project',
    scope: 'project',
    category: 'project',
    surfaces: ['menu', 'palette'],
    keywords: ['new', 'create', 'project', 'design', 'whiteboard', 'diagram'],
    icon: 'plus',
    canExecute: (ctx) => needsCallback(ctx, 'newProject'),
    execute: (ctx) => ctx.newProject?.(ctx.targetKind ?? 'design'),
  },
  {
    id: 'project.create',
    labelKey: 'editor.menu.new',
    defaultLabel: 'Create project',
    descriptionKey: 'editor.menu.newDescription',
    defaultDescription: 'Create and open a new project',
    scope: 'project',
    category: 'project',
    surfaces: ['menu', 'palette', 'contextMenu'],
    keywords: ['create', 'new', 'project'],
    icon: 'plus',
    canExecute: (ctx) =>
      ctx.createProject !== undefined && ctx.targetName !== undefined
        ? enabled()
        : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.createProject || ctx.targetName === undefined) {
        return { status: 'disabled', reason: 'unavailable' };
      }
      const created = await ctx.createProject(ctx.targetName, ctx.targetKind ?? 'design');
      if (created && typeof created.id === 'string') ctx.openProject?.(created.id);
      await ctx.refreshHome?.();
      return { status: 'ok' };
    },
  },
  {
    id: 'project.open',
    labelKey: 'projects.actions.open',
    defaultLabel: 'Open project',
    scope: 'project',
    category: 'project',
    surfaces: ['contextMenu', 'palette'],
    keywords: ['open', 'project'],
    icon: 'open',
    canExecute: (ctx) =>
      ctx.openProject !== undefined && ctx.targetProjectId !== undefined
        ? enabled()
        : disabled('unavailable'),
    execute: (ctx) => {
      if (!ctx.openProject || ctx.targetProjectId === undefined) {
        return { status: 'disabled', reason: 'unavailable' };
      }
      ctx.openProject(ctx.targetProjectId);
      return { status: 'ok' };
    },
  },
  {
    id: 'project.rename',
    labelKey: 'projects.actions.rename',
    defaultLabel: 'Rename project',
    scope: 'project',
    category: 'project',
    surfaces: ['contextMenu', 'palette'],
    keywords: ['rename', 'project'],
    icon: 'rename',
    canExecute: (ctx) =>
      ctx.renameProject !== undefined &&
      ctx.targetProjectId !== undefined &&
      ctx.targetName !== undefined
        ? enabled()
        : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.renameProject || ctx.targetProjectId === undefined || ctx.targetName === undefined) {
        return { status: 'disabled', reason: 'unavailable' };
      }
      await ctx.renameProject(ctx.targetProjectId, ctx.targetName);
      await ctx.refreshHome?.();
      return { status: 'ok' };
    },
  },
  {
    id: 'project.delete',
    labelKey: 'projects.actions.delete',
    defaultLabel: 'Delete project',
    scope: 'project',
    category: 'project',
    surfaces: ['contextMenu', 'palette'],
    keywords: ['delete', 'trash', 'project'],
    icon: 'trash',
    canExecute: (ctx) =>
      ctx.deleteProject !== undefined && ctx.targetProjectId !== undefined
        ? enabled()
        : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.deleteProject || ctx.targetProjectId === undefined) {
        return { status: 'disabled', reason: 'unavailable' };
      }
      await ctx.deleteProject(ctx.targetProjectId);
      await ctx.refreshHome?.();
      return { status: 'ok' };
    },
  },
  {
    id: 'project.toggleFavorite',
    labelKey: 'projects.actions.favorite',
    defaultLabel: 'Toggle favorite',
    scope: 'project',
    category: 'project',
    surfaces: ['contextMenu', 'palette'],
    keywords: ['favorite', 'star', 'project'],
    icon: 'star',
    canExecute: (ctx) =>
      ctx.toggleFavorite !== undefined && ctx.targetProjectId !== undefined
        ? enabled()
        : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.toggleFavorite || ctx.targetProjectId === undefined) {
        return { status: 'disabled', reason: 'unavailable' };
      }
      await ctx.toggleFavorite(ctx.targetProjectId);
      await ctx.refreshHome?.();
      return { status: 'ok' };
    },
  },
  {
    id: 'settings.openSection',
    labelKey: 'navigation.settings',
    defaultLabel: 'Open settings section',
    descriptionKey: 'navigation.goSettingsDescription',
    defaultDescription: 'Open settings',
    scope: 'application',
    category: 'dialog',
    surfaces: ['palette'],
    keywords: ['settings', 'section', 'preferences'],
    icon: 'settings',
    canExecute: (ctx) =>
      ctx.openSettingsSection !== undefined || ctx.navigate !== undefined
        ? enabled()
        : disabled('unavailable'),
    execute: (ctx) => {
      const section = ctx.targetName ?? 'general';
      if (ctx.openSettingsSection) ctx.openSettingsSection(section);
      else ctx.navigate?.(`#/settings/${section}`);
      return { status: 'ok' };
    },
  },
  {
    id: 'extension.installFromFile',
    labelKey: 'editor.menu.installExtension',
    defaultLabel: 'Install extension package',
    descriptionKey: 'editor.menu.installExtensionDescription',
    defaultDescription: 'Install a extension from an .onry package file',
    scope: 'application',
    category: 'dialog',
    surfaces: ['palette'],
    keywords: ['extension', 'install', 'onry', 'package'],
    icon: 'plus',
    canExecute: (ctx) =>
      ctx.pickExtensionFile !== undefined && ctx.installExtensionBytes !== undefined
        ? enabled()
        : disabled('unavailable'),
    execute: async (ctx) => {
      if (!ctx.pickExtensionFile || !ctx.installExtensionBytes) {
        return { status: 'disabled', reason: 'unavailable' };
      }
      const file = await ctx.pickExtensionFile();
      if (!file) return { status: 'notApplicable', reason: 'cancelled' };
      const buffer = new Uint8Array(await file.arrayBuffer());
      const { packageId, errors } = await ctx.installExtensionBytes(buffer, file.name);
      if (errors.length > 0) {
        ctx.notify?.(`Install failed: ${errors.join('; ')}`);
        return { status: 'notApplicable', reason: errors.join('; ') };
      }
      if (packageId) ctx.notify?.(`Extension installed: ${packageId}`);
      return { status: 'ok' };
    },
  },
  {
    id: 'project.save',
    labelKey: 'editor.menu.save',
    defaultLabel: 'Save',
    descriptionKey: 'editor.menu.saveDescription',
    defaultDescription: 'Save the open project',
    scope: 'project',
    category: 'project',
    surfaces: ['menu', 'palette'],
    keywords: ['save', 'persist', 'write'],
    icon: 'save',
    canExecute: (ctx) => needsCallback(ctx, 'saveProject'),
    execute: async (ctx) => {
      await ctx.saveProject?.();
      return { status: 'ok' };
    },
  },
  {
    id: 'project.duplicate',
    labelKey: 'editor.menu.duplicateProject',
    defaultLabel: 'Duplicate project',
    descriptionKey: 'editor.menu.duplicateProjectDescription',
    defaultDescription: 'Duplicate the open project',
    scope: 'project',
    category: 'project',
    surfaces: ['menu', 'palette', 'contextMenu'],
    keywords: ['duplicate', 'copy', 'clone', 'project'],
    icon: 'duplicate',
    canExecute: (ctx) => needsCallback(ctx, 'duplicateProject'),
    execute: async (ctx) => {
      await ctx.duplicateProject?.();
      return { status: 'ok' };
    },
  },
  {
    id: 'panel.toggleLayers',
    labelKey: 'editor.panels.layersToggle',
    defaultLabel: 'Toggle layers panel',
    scope: 'panel',
    category: 'panel',
    surfaces: ['palette', 'activityBar'],
    keywords: ['layers', 'panel', 'toggle', 'sidebar'],
    icon: 'layers',
    canExecute: (ctx) => needsCallback(ctx, 'togglePanel'),
    execute: (ctx) => ctx.togglePanel?.('layers'),
  },
  {
    id: 'panel.toggleInspector',
    labelKey: 'editor.panels.inspectorToggle',
    defaultLabel: 'Toggle inspector panel',
    scope: 'panel',
    category: 'panel',
    surfaces: ['palette', 'activityBar'],
    keywords: ['inspector', 'panel', 'toggle', 'properties'],
    icon: 'inspector',
    canExecute: (ctx) => needsCallback(ctx, 'togglePanel'),
    execute: (ctx) => ctx.togglePanel?.('inspector'),
  },
  {
    id: 'dialog.openSettings',
    labelKey: 'navigation.settings',
    defaultLabel: 'Open settings dialog',
    scope: 'dialog',
    category: 'dialog',
    surfaces: ['palette', 'activityBar'],
    keywords: ['settings', 'preferences', 'dialog'],
    icon: 'settings',
    canExecute: (ctx) => needsCallback(ctx, 'openDialog'),
    execute: (ctx) => ctx.openDialog?.('settings'),
  },
  {
    id: 'dialog.openQuickSwitcher',
    labelKey: 'editor.quickSwitcher.title',
    defaultLabel: 'Open quick switcher',
    scope: 'dialog',
    category: 'dialog',
    surfaces: ['palette'],
    keywords: ['quick', 'switcher', 'open', 'command'],
    icon: 'search',
    canExecute: (ctx) => needsCallback(ctx, 'openDialog'),
    execute: (ctx) => ctx.openDialog?.('quickSwitcher'),
  },
  {
    id: 'notification.dismissAll',
    labelKey: 'common.actions.close',
    defaultLabel: 'Dismiss notifications',
    scope: 'notification',
    category: 'notification',
    surfaces: ['palette'],
    keywords: ['dismiss', 'toast', 'notification', 'clear'],
    canExecute: () => enabled(),
    execute: () => ({ status: 'ok' }),
  },
  {
    id: 'window.minimize',
    labelKey: 'navigation.minimize',
    defaultLabel: 'Minimize window',
    scope: 'window',
    category: 'window',
    surfaces: ['palette'],
    keywords: ['window', 'minimize'],
    canExecute: (ctx) => needsCallback(ctx, 'windowAction'),
    execute: (ctx) => ctx.windowAction?.('minimize'),
  },
  {
    id: 'window.toggleMaximize',
    labelKey: 'navigation.toggleMaximize',
    defaultLabel: 'Toggle maximize',
    scope: 'window',
    category: 'window',
    surfaces: ['palette'],
    keywords: ['window', 'maximize', 'restore', 'fullscreen'],
    canExecute: (ctx) => needsCallback(ctx, 'windowAction'),
    execute: (ctx) => ctx.windowAction?.('maximizeRestore'),
  },
  {
    id: 'window.close',
    labelKey: 'common.actions.close',
    defaultLabel: 'Close window',
    scope: 'window',
    category: 'window',
    surfaces: ['palette'],
    keywords: ['window', 'close', 'quit'],
    canExecute: (ctx) => needsCallback(ctx, 'windowAction'),
    execute: (ctx) => ctx.windowAction?.('close'),
  },
  {
    id: 'tool.activateSelect',
    labelKey: 'editor.tools.select',
    defaultLabel: 'Activate select tool',
    scope: 'tool',
    category: 'tool',
    surfaces: ['palette'],
    keywords: ['tool', 'select', 'activate'],
    icon: 'select',
    canExecute: (ctx) => needsCallback(ctx, 'activateTool'),
    execute: (ctx) => ctx.activateTool?.('select'),
  },
  {
    id: 'view.fitContent',
    labelKey: 'editor.commands.fitContent',
    defaultLabel: 'Fit content (host)',
    descriptionKey: 'editor.commands.fitContentDescription',
    defaultDescription: 'Fit all content to view',
    scope: 'view',
    category: 'view',
    surfaces: ['statusBar', 'palette'],
    keywords: ['fit', 'zoom', 'view', 'status'],
    icon: 'fit',
    canExecute: (ctx) => needsCallback(ctx, 'runViewCommand'),
    execute: (ctx) => ctx.runViewCommand?.('fitContent'),
  },
  {
    id: 'view.resetZoom',
    labelKey: 'editor.commands.resetZoom',
    defaultLabel: 'Reset zoom (host)',
    descriptionKey: 'editor.commands.resetZoomDescription',
    defaultDescription: 'Reset zoom to 100%',
    scope: 'view',
    category: 'view',
    surfaces: ['statusBar', 'palette'],
    keywords: ['zoom', 'reset', '100%', 'status'],
    icon: 'resetZoom',
    canExecute: (ctx) => needsCallback(ctx, 'runViewCommand'),
    execute: (ctx) => ctx.runViewCommand?.('resetZoom'),
  },
];

/** Validated lookup over host commands shared by every chrome surface. */
export const appCommandRegistry = createRegistry('appCommand', APP_COMMANDS, {
  validateItem: (command) => {
    const keyed = command.descriptionKey !== undefined;
    const described = command.defaultDescription !== undefined;
    if (keyed !== described) {
      return `descriptionKey and defaultDescription must both be present or absent for id "${command.id}"`;
    }
    if (!command.id.includes('.')) {
      return `app command id "${command.id}" must be namespaced (scope.action)`;
    }
    return undefined;
  },
});

/** Host commands for one surface in registration order. */
export function appCommandsForSurface(surface: AppCommandSurface): readonly AppCommandDefinition[] {
  return appCommandRegistry.all().filter((command) => command.surfaces.includes(surface));
}

/** Search host commands by label and keywords. */
export function searchAppCommands(query: string): readonly AppCommandDefinition[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return appCommandRegistry.all();
  return appCommandRegistry.all().filter((command) => {
    const haystacks = [
      command.defaultLabel.toLowerCase(),
      command.defaultDescription?.toLowerCase() ?? '',
      command.id.toLowerCase(),
      ...(command.keywords ?? []).map((keyword) => keyword.toLowerCase()),
    ];
    return haystacks.some((haystack) => haystack.includes(needle));
  });
}

/** Enablement probe shared by chrome buttons, menu rows, and palette rows. */
export function canExecuteAppCommand(id: string, ctx: AppCommandContext): AppCommandVerdict {
  const command = appCommandRegistry.get(id);
  if (!command) return disabled('unavailable');
  return command.canExecute(ctx);
}

/**
 * Single execution source for host chrome. Checks enablement first so menu,
 * palette, activity bar, and status bar share one gating path.
 */
export async function executeAppCommand(id: string, ctx: AppCommandContext): Promise<AppCommandResult> {
  const command = appCommandRegistry.get(id);
  if (!command) return { status: 'notApplicable', reason: 'unknown-command' };
  const verdict = command.canExecute(ctx);
  if (!verdict.executable) return { status: 'disabled', reason: verdict.reason };
  try {
    const outcome = (await command.execute(ctx)) as AppCommandResult | void | undefined;
    if (
      outcome !== null &&
      typeof outcome === 'object' &&
      'status' in outcome &&
      (outcome.status === 'ok' || outcome.status === 'disabled' || outcome.status === 'notApplicable')
    ) {
      return outcome;
    }
    return { status: 'ok' };
  } catch (error) {
    return {
      status: 'notApplicable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
