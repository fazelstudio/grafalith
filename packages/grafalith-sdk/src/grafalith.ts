// Full `grafalith.*` facade extensions program against (design domain).
//
// One facade, many namespaces: infrastructure (commands, events,
// keybindings, settings, context, storage, env, extensions), UI shell
// (menuBar, activityBar, statusBar, commandPalette, panel, modal,
// contextMenu, notification, quickInput), and the design domain (canvas,
// tools, shapes, diagram, properties, assets, styles, fonts, snap, format,
// workspace, home, output).
//
// Every registration returns a `Disposable` for `subscriptions` cleanup.
// Methods degrade to an in-memory registry when the host leaves a hook
// unimplemented, so extensions run on desktop, in tests, and on headless
// hosts without branching.
import type { Disposable, ExtensionCommandHandler } from "./commands.js";
import { ExtensionCommandRegistry } from "./commands.js";
import { ContextKeyService, evaluateWhen } from "./contextKeys.js";
import { GrafalithEventBus } from "./events.js";
import type { EnvInfo } from "./env.js";
import type { ClipboardApi, FilesystemApi } from "./hostCapabilities.js";
import { KeybindingRegistry } from "./keybindings.js";
import { MemoryOutputChannel, type OutputChannel } from "./output.js";
import type { SettingsApi } from "./settings.js";
import type { ExtensionStorage } from "./storage.js";
import type { WindowApi } from "./window.js";
import type { WorkspaceApi } from "./workspace.js";

/** Editor kinds supported by the host (Home offers all three). */
export type EditorKind = "design" | "whiteboard" | "diagram";

/** Any editor kind plus the cross-kind wildcard. */
export type ToolEditorScope = EditorKind | "all";

/** One menu item contributed to any menu location. */
export interface MenuItem {
  readonly command: string;
  readonly group?: string;
  readonly when?: string;
}

/** One activity-bar item (rail icon switching panels/views). */
export interface ActivityBarItem {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

/** One status-bar item (dynamic text, optional click command). */
export interface StatusBarItem {
  readonly id: string;
  text: string;
  tooltip?: string;
  command?: string;
}

/** One toolbar tool (per editor kind or global). */
export interface ToolbarTool {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly kinds?: readonly EditorKind[];
}

/** One panel contributed to the editor dock or Home. */
export interface PanelContribution {
  readonly id: string;
  readonly title: string;
}

/** One design-editor tool (`grafalith.tools.registerTool`). */
export interface DesignTool {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly when?: string;
}

/** One shape type for the Design editor (`grafalith.shapes.*`). */
export interface ShapeType {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

/** One diagram node or edge type (`grafalith.diagram.*`). */
export interface DiagramType {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

/** One inspector section in the properties panel. */
export interface InspectorSection {
  readonly id: string;
  readonly title: string;
  readonly when?: string;
}

/** One asset entry served by a provider. */
export interface Asset {
  readonly id: string;
  readonly title: string;
  readonly type?: string;
}

/** One color palette contribution. */
export interface ColorPalette {
  readonly id: string;
  readonly title: string;
  readonly colors: readonly string[];
}

/** One gradient preset contribution. */
export interface GradientPreset {
  readonly id: string;
  readonly title: string;
}

/** One style preset contribution. */
export interface StylePreset {
  readonly id: string;
  readonly title: string;
}

/** One font provider contribution. */
export interface FontProvider {
  readonly id: string;
  readonly title: string;
}

/** One canvas snap behavior. */
export interface SnapBehavior {
  readonly id: string;
  readonly title: string;
}

/** One file importer (`grafalith.format.registerImporter`). */
export interface Importer {
  readonly format: string;
  readonly label: string;
  readonly handler: (file: unknown) => Promise<unknown>;
}

/** One file exporter (`grafalith.format.registerExporter`). */
export interface Exporter {
  readonly format: string;
  readonly label: string;
  readonly handler: (doc: unknown) => Promise<unknown>;
}

/** One project template for the Home create-new flow. */
export interface ProjectTemplate {
  readonly id: string;
  readonly title: string;
  readonly kind: EditorKind;
}

/** One Home-screen widget card. */
export interface HomeWidget {
  readonly id: string;
  readonly title: string;
}

/** Viewport snapshot (`grafalith.canvas.getViewport`). */
export interface Viewport {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/** One canvas overlay layer (`grafalith.canvas.addOverlay`). */
export interface CanvasOverlay {
  readonly id: string;
  readonly onRender?: (viewport: Viewport) => void;
}

/** Toast request (`ui.notification.showToast`). */
export interface ToastRequest {
  readonly type: "info" | "success" | "warning" | "error";
  readonly message: string;
  readonly detail?: string;
  readonly duration?: number;
  readonly actions?: ReadonlyArray<{ label: string; command: string; args?: unknown[] }>;
  readonly source?: string;
}

/** Host backends the facade delegates to (desktop injects registries). */
export interface GrafalithHost {
  readonly commands: ExtensionCommandRegistry;
  readonly events: GrafalithEventBus;
  readonly context: ContextKeyService;
  readonly window: WindowApi;
  readonly workspace: WorkspaceApi;
  readonly storage: ExtensionStorage;
  readonly settings: SettingsApi;
  readonly keybindings: KeybindingRegistry;
  readonly env: EnvInfo;
  readonly clipboard: ClipboardApi;
  readonly fs: FilesystemApi;
  addMenuItem(location: string, item: MenuItem): Disposable;
  addActivityBarItem(item: ActivityBarItem): Disposable;
  addStatusBarItem(item: StatusBarItem): Disposable;
  addToolbarTool(tool: ToolbarTool): Disposable;
  registerPanel(panel: PanelContribution): Disposable;
  showModal(id: string): Promise<unknown>;
  getCurrentProject(): { id: string; kind: EditorKind } | undefined;
  getActiveEditor(): { kind: EditorKind } | undefined;
  registerAssetProvider(id: string, title: string): Disposable;
  registerDiagramNode(id: string, title: string): Disposable;
  getExtension(id: string): { id: string } | undefined;
  getAllExtensions(): readonly { id: string }[];
  // Optional hooks below: the facade falls back to memory when absent.
  unregisterCommand?(id: string): boolean;
  hasCommand?(id: string): boolean;
  onDidExecuteCommand?(listener: (id: string) => void): Disposable;
  onDidChangeContext?(listener: (key: string) => void): Disposable;
  onDidActivateExtension?(listener: (id: string) => void): Disposable;
  onDidDeactivateExtension?(listener: (id: string) => void): Disposable;
  onDidFailExtension?(listener: (id: string, reason: string) => void): Disposable;
  addMenuSeparator?(location: string): Disposable;
  removeActivityBarItem?(id: string): void;
  setActivityBadge?(id: string, badge: string | undefined): void;
  removeStatusBarItem?(id: string): void;
  setStatusText?(id: string, text: string): void;
  setStatusTooltip?(id: string, tooltip: string): void;
  addCommandPaletteItem?(item: MenuItem): Disposable;
  removeCommandPaletteItem?(command: string): void;
  showPanel?(id: string): void;
  hidePanel?(id: string): void;
  togglePanel?(id: string): void;
  showAlert?(message: string): Promise<void>;
  showConfirm?(message: string): Promise<boolean>;
  registerCustomModal?(id: string): Disposable;
  addContextMenuSeparator?(target: string): Disposable;
  dismissAllNotifications?(): void;
  getViewport?(): Viewport;
  getSelectedObjects?(): readonly { id: string }[];
  getEditorType?(): EditorKind | null;
  createOutputChannel?(name: string): OutputChannel;
}

/** Local fallback registries used when the host leaves a hook out. */
interface DomainState {
  tools: Map<string, { tool: DesignTool; scope: ToolEditorScope }>;
  activeTool: string;
  toolListeners: Set<(toolId: string) => void>;
  shapes: Map<string, ShapeType>;
  nodes: Map<string, DiagramType>;
  edges: Map<string, DiagramType>;
  inspectors: Map<string, InspectorSection>;
  selectionListeners: Set<(ids: readonly string[]) => void>;
  viewportListeners: Set<(viewport: Viewport) => void>;
  overlays: Map<string, CanvasOverlay>;
  assets: Map<string, { title: string }>;
  palettes: Map<string, ColorPalette>;
  gradients: Map<string, GradientPreset>;
  stylePresets: Map<string, StylePreset>;
  fonts: Map<string, FontProvider>;
  snaps: Map<string, SnapBehavior>;
  importers: Map<string, Importer>;
  exporters: Map<string, Exporter>;
  templates: Map<string, ProjectTemplate>;
  widgets: Map<string, HomeWidget>;
  viewport: Viewport;
  selection: string[];
  executeListeners: Set<(id: string) => void>;
}

function createDomainState(): DomainState {
  return {
    tools: new Map(),
    activeTool: "select",
    toolListeners: new Set(),
    shapes: new Map(),
    nodes: new Map(),
    edges: new Map(),
    inspectors: new Map(),
    selectionListeners: new Set(),
    viewportListeners: new Set(),
    overlays: new Map(),
    assets: new Map(),
    palettes: new Map(),
    gradients: new Map(),
    stylePresets: new Map(),
    fonts: new Map(),
    snaps: new Map(),
    importers: new Map(),
    exporters: new Map(),
    templates: new Map(),
    widgets: new Map(),
    viewport: { zoom: 1, scrollX: 0, scrollY: 0 },
    selection: [],
    executeListeners: new Set(),
  };
}

function track<T extends Disposable>(disposables: Set<T>, disposable: T): T {
  disposables.add(disposable);
  return disposable;
}

/**
 * Create the `grafalith.*` facade extensions program against.
 *
 * Every namespace below is documented with what it does, when to use it,
 * and a short example. All registrations return a `Disposable` pushed to
 * `subscriptions` for automatic cleanup on deactivate.
 *
 * @param host - Host backends (real registries on desktop, memory in tests).
 * @returns Namespaced API surface for one extension.
 *
 * @example
 * ```ts
 * export function activate(grafalith: GrafalithApi) {
 *   grafalith.commands.register("acme.hello", () =>
 *     grafalith.ui.notification.showToast({ type: "info", message: "Hello" }));
 * }
 * ```
 */
export function createGrafalithApi(host: GrafalithHost): GrafalithApi {
  const push = (disposable: Disposable): Disposable => disposable;
  const domain = createDomainState();
  const memoryDisposables = new Set<Disposable>();
  const idOf = (kind: string, id: string): string => `${kind}:${id}`;

  const forget = (disposable: Disposable): void => {
    memoryDisposables.add(disposable);
  };

  return {
    commands: {
      /**
       * Register a command (`grafalith.<scope>.<section>.<action>`).
       * Use for every user intent so palettes, menus, and keybindings share one path.
       */
      register: (id: string, handler: ExtensionCommandHandler): Disposable =>
        push(host.commands.registerCommand(id, handler)),
      /** Execute any registered command (built-in or extension). */
      execute: async (id: string, ...args: unknown[]): Promise<unknown> => {
        const value = await host.commands.executeCommand(id, ...args);
        for (const listener of [...domain.executeListeners]) listener(id);
        return value;
      },
      /** Every registered command id. */
      getAll: (): string[] => host.commands.getCommands(),
      /** Remove a command registered by this extension. */
      unregister: (id: string): boolean => {
        if (host.unregisterCommand) return host.unregisterCommand(id);
        return false;
      },
      /** Whether a command id is registered. */
      has: (id: string): boolean => {
        if (host.hasCommand) return host.hasCommand(id);
        return host.commands.getCommands().includes(id);
      },
      /** Subscribe to post-execution (automation, telemetry). */
      onDidExecute: (listener: (id: string) => void): Disposable => {
        if (host.onDidExecuteCommand) return push(host.onDidExecuteCommand(listener));
        domain.executeListeners.add(listener);
        return push({ dispose: () => void domain.executeListeners.delete(listener) });
      },
    },
    events: {
      /** Subscribe to a built-in lifecycle event; returns a disposable. */
      on: (event: string, listener: (payload: unknown) => void): Disposable =>
        push(host.events.on(event, listener)),
      /** Emit is host-only; extensions receive it here for completeness. */
      emit: (event: string, payload?: unknown): void => void host.events.emit(event, payload),
      /** Remove one listener added via `on`. */
      off: (event: string, listener: (payload: unknown) => void): void => {
        if (typeof host.events.off === 'function') host.events.off(event, listener);
      },
    },
    context: {
      /** Set a context key for `when`-clause gating. */
      setContext: (key: string, value: string | boolean | number): void => void host.context.set(key, value),
      /** Read a context key. */
      getContext: <T>(key: string, fallback: T): T => host.context.get(key, fallback),
      /** Subscribe to any context-key change. */
      onDidChange: (listener: (key: string) => void): Disposable => {
        if (host.onDidChangeContext) return push(host.onDidChangeContext(listener));
        return push(host.context.onDidChange(listener));
      },
      /** Evaluate a `when` clause against current context. */
      matches: (when: string | undefined): boolean =>
        evaluateWhen(when, host.context.snapshot() as Record<string, string | boolean | number | undefined>),
    },
    ui: {
      menuBar: {
        /** Add a menubar item. Use for File/Edit/View-level intents. */
        addMenu: (menu: string): Disposable => push(host.addMenuItem(menu, { command: menu })),
        /** Add a menubar item. Use for File/Edit/View-level intents. */
        addMenuItem: (menu: string, item: MenuItem): Disposable => push(host.addMenuItem(menu, item)),
        /** Add a separator row to a menubar menu. */
        addSeparator: (menu: string): Disposable => {
          if (host.addMenuSeparator) return push(host.addMenuSeparator(menu));
          return push({ dispose: () => undefined });
        },
      },
      activityBar: {
        /** Add a rail icon. Use to switch panels or open views. */
        addItem: (item: ActivityBarItem): Disposable => push(host.addActivityBarItem(item)),
        /** Remove a rail icon added by this extension. */
        removeItem: (id: string): void => void host.removeActivityBarItem?.(id),
        /** Set a count badge on a rail icon. */
        setBadge: (id: string, badge: string | undefined): void => void host.setActivityBadge?.(id, badge),
      },
      statusBar: {
        /** Add a status item. Use for contextual info with optional click command. */
        addItem: (item: StatusBarItem): Disposable => push(host.addStatusBarItem(item)),
        /** Remove a status item added by this extension. */
        removeItem: (id: string): void => void host.removeStatusBarItem?.(id),
        /** Update a status item's text. */
        setText: (id: string, text: string): void => void host.setStatusText?.(id, text),
        /** Update a status item's tooltip. */
        setTooltip: (id: string, tooltip: string): void => void host.setStatusTooltip?.(id, tooltip),
      },
      contextMenu: {
        /** Add a right-click row (`contextMenu/editor`, `contextMenu/layers`). */
        addItem: (location: string, item: MenuItem): Disposable => push(host.addMenuItem(location, item)),
        /** Add a separator row to a context menu. */
        addSeparator: (target: string): Disposable => {
          if (host.addContextMenuSeparator) return push(host.addContextMenuSeparator(target));
          return push({ dispose: () => undefined });
        },
      },
      toolbar: {
        /** Add a toolbar tool, optionally scoped to editor kinds. */
        addTool: (tool: ToolbarTool): Disposable => push(host.addToolbarTool(tool)),
      },
      panel: {
        /** Register a dock panel shown in the editor or Home. */
        registerPanel: (panel: PanelContribution): Disposable => push(host.registerPanel(panel)),
        /** Show a registered panel by id. */
        showPanel: (id: string): void => void host.showPanel?.(id),
        /** Hide a registered panel by id. */
        hidePanel: (id: string): void => void host.hidePanel?.(id),
        /** Toggle a registered panel. */
        togglePanel: (id: string): void => {
          if (host.togglePanel) host.togglePanel(id);
          else host.showPanel?.(id);
        },
      },
      modal: {
        /** Show a contributed modal by id. */
        showModal: (id: string): Promise<unknown> => host.showModal(id),
        /** Show a simple alert dialog. */
        showAlert: (message: string): Promise<void> => {
          if (host.showAlert) return host.showAlert(message);
          return host.showModal(message).then(() => undefined);
        },
        /** Show a confirm dialog resolving to the user's choice. */
        showConfirm: (message: string): Promise<boolean> => {
          if (host.showConfirm) return host.showConfirm(message);
          return host.showModal(message).then(() => false);
        },
        /** Show a custom modal registered by id. */
        showCustomModal: (id: string, props?: unknown): Promise<unknown> => {
          void props;
          return host.showModal(id);
        },
        /** Register a custom modal surface rendered by the host. */
        registerCustomModal: (id: string): Disposable => {
          if (host.registerCustomModal) return push(host.registerCustomModal(id));
          return push({ dispose: () => undefined });
        },
      },
      notification: {
        /** Show a toast. Use for transient info/warning/error with actions. */
        showToast: (request: ToastRequest): void =>
          void host.window.showNotification(request.message, {
            level: request.type,
            actions: request.actions?.map((action) => ({ label: action.label, command: action.command, args: action.args })),
            duration: request.duration,
            source: request.source,
          }),
        /** Run a cancellable task with progress UI. */
        showProgress: (title: string, task: (fraction: (value: number) => void) => Promise<void>): Promise<void> =>
          host.window.showProgress(title, async (progress) => {
            await task((value: number) => void progress.report(value));
          }),
        /** Show a transient status message. */
        showStatusMessage: (message: string, duration?: number): Disposable =>
          host.window.showStatusMessage(message, duration),
        /** Dismiss every visible toast. */
        dismissAll: (): void => void host.dismissAllNotifications?.(),
      },
      quickInput: {
        /** Pick from a list. Use for quick actions and template choosers. */
        showQuickPick: (items: ReadonlyArray<{ id: string; label: string }>, placeholder?: string) =>
          host.window.showQuickPick(items, placeholder),
        /** Collect one line of text. Use for names and rename flows. */
        showInputBox: (prompt: string, initialValue?: string) => host.window.showInputBox(prompt, initialValue),
      },
      commandPalette: {
        /** Palette rows come from the command registry; this lists them. */
        getAll: (): string[] => host.commands.getCommands(),
        /** Add one palette row for a registered command. */
        addItem: (item: MenuItem): Disposable => {
          if (host.addCommandPaletteItem) return push(host.addCommandPaletteItem(item));
          return push({ dispose: () => undefined });
        },
        /** Remove one palette row by command id. */
        removeItem: (command: string): void => void host.removeCommandPaletteItem?.(command),
      },
    },
    settings: {
      /** Read a namespaced setting. */
      get: <T>(key: string, fallback: T): T => host.settings.get(key, fallback),
      /** Write a namespaced setting. */
      set: (key: string, value: string | boolean | number): Promise<void> => host.settings.set(key, value),
      /** Subscribe to settings changes. */
      onDidChange: (listener: (key: string) => void): Disposable => push(host.settings.onDidChange(listener)),
      /** Register a settings section rendered in settings UI. */
      registerSection: (section: { id: string; title: string }): Disposable =>
        push(host.settings.registerSection(section)),
    },
    keybindings: {
      /** Register a keybinding for a command with an optional `when` clause. */
      register: (binding: { command: string; key: string; when?: string }): Disposable =>
        push(host.keybindings.register(binding)),
      /** Every registered keybinding. */
      getAll: () => host.keybindings.getAll(),
    },
    workspace: {
      /** Current project, if an editor is open. */
      getCurrentProject: () => host.getCurrentProject(),
      /** Active editor kind, or null outside the editor. */
      getEditorType: (): EditorKind | null => {
        if (host.getEditorType) return host.getEditorType();
        return host.getActiveEditor()?.kind ?? null;
      },
      /** Subscribe to project open/close. */
      onDidOpenProject: (listener: (event: { projectId: string }) => void): Disposable =>
        push(host.workspace.events.onDidOpenProject.on(listener)),
      onDidCloseProject: (listener: (event: { projectId: string }) => void): Disposable =>
        push(host.workspace.events.onDidCloseProject.on(listener)),
    },
    editor: {
      /** Active editor kind, if an editor is mounted. */
      getActiveEditor: () => host.getActiveEditor(),
      /** Subscribe to editor switches (design/whiteboard/diagram). */
      onDidChangeActiveEditor: (listener: (event: { editorType: string }) => void): Disposable =>
        push(host.workspace.events.onDidChangeActiveEditor.on(listener)),
    },
    canvas: {
      /** Current viewport (zoom + scroll). */
      getViewport: (): Viewport => host.getViewport?.() ?? { ...domain.viewport },
      /** Add a canvas overlay layer (minimap, guides, custom chrome). */
      addOverlay: (overlay: CanvasOverlay): Disposable => {
        domain.overlays.set(overlay.id, overlay);
        const disposable = { dispose: () => void domain.overlays.delete(overlay.id) };
        forget(disposable);
        return disposable;
      },
      /** Currently selected object ids. */
      getSelectedObjects: (): readonly { id: string }[] =>
        host.getSelectedObjects?.() ?? domain.selection.map((id) => ({ id })),
      /** Subscribe to selection changes (design/whiteboard overlays). */
      onDidChangeSelection: (listener: (ids: readonly string[]) => void): Disposable => {
        const disposable = host.workspace.events.onDidChangeSelection.on(listener);
        domain.selectionListeners.add(listener);
        return push(track(memoryDisposables, { dispose: () => {
          disposable.dispose();
          void domain.selectionListeners.delete(listener);
        } }));
      },
      /** Subscribe to viewport changes (pan/zoom). */
      onDidChangeViewport: (listener: (viewport: Viewport) => void): Disposable => {
        const forward = (payload: { readonly zoom: number }): void => {
          listener({ ...domain.viewport, zoom: payload.zoom });
        };
        const disposable = host.workspace.events.onDidChangeViewport.on(forward);
        domain.viewportListeners.add(listener);
        return push(track(memoryDisposables, { dispose: () => {
          disposable.dispose();
          void domain.viewportListeners.delete(listener);
        } }));
      },
    },
    tools: {
      /** Register a tool for one editor kind (or every kind with `"all"`). */
      registerTool: (tool: DesignTool, editorType: ToolEditorScope = "all"): Disposable => {
        if (!tool || tool.id === "") throw new Error("tool id must not be empty");
        const key = idOf(editorType, tool.id);
        if (domain.tools.has(key)) throw new Error(`tool already registered: ${key}`);
        domain.tools.set(key, { tool, scope: editorType });
        const disposable = { dispose: () => void domain.tools.delete(key) };
        forget(disposable);
        return disposable;
      },
      /** Activate a tool by id. */
      setActiveTool: (toolId: string): void => {
        domain.activeTool = toolId;
        for (const listener of [...domain.toolListeners]) listener(toolId);
      },
      /** Currently active tool id. */
      getActiveTool: (): string => domain.activeTool,
      /** Subscribe to tool switches. */
      onDidChangeTool: (listener: (toolId: string) => void): Disposable => {
        domain.toolListeners.add(listener);
        return push({ dispose: () => void domain.toolListeners.delete(listener) });
      },
    },
    shapes: {
      /** Register a shape type for the Design editor. */
      registerShapeType: (shape: ShapeType): Disposable => {
        if (!shape || shape.id === "") throw new Error("shape id must not be empty");
        if (domain.shapes.has(shape.id)) throw new Error(`shape already registered: ${shape.id}`);
        domain.shapes.set(shape.id, shape);
        const disposable = { dispose: () => void domain.shapes.delete(shape.id) };
        forget(disposable);
        return disposable;
      },
      /** Every registered shape type. */
      getShapeTypes: (): ShapeType[] => [...domain.shapes.values()],
    },
    diagram: {
      /** Register a diagram node type. */
      registerNodeType: (id: string, title: string): Disposable => push(host.registerDiagramNode(id, title)),
      /** Register a diagram edge type. */
      registerEdgeType: (edge: DiagramType): Disposable => {
        if (!edge || edge.id === "") throw new Error("edge id must not be empty");
        if (domain.edges.has(edge.id)) throw new Error(`edge already registered: ${edge.id}`);
        domain.edges.set(edge.id, edge);
        const disposable = { dispose: () => void domain.edges.delete(edge.id) };
        forget(disposable);
        return disposable;
      },
      /** Every registered diagram node type. */
      getNodeTypes: (): DiagramType[] => [...domain.nodes.values()],
      /** Every registered diagram edge type. */
      getEdgeTypes: (): DiagramType[] => [...domain.edges.values()],
    },
    properties: {
      /** Register an inspector section in the properties panel. */
      registerInspectorSection: (section: InspectorSection): Disposable => {
        if (!section || section.id === "") throw new Error("inspector section id must not be empty");
        if (domain.inspectors.has(section.id)) throw new Error(`inspector already registered: ${section.id}`);
        domain.inspectors.set(section.id, section);
        const disposable = { dispose: () => void domain.inspectors.delete(section.id) };
        forget(disposable);
        return disposable;
      },
      /** Subscribe to selection changes for inspector refresh. */
      onDidChangeSelection: (listener: (ids: readonly string[]) => void): Disposable =>
        push(host.workspace.events.onDidChangeSelection.on(listener)),
    },
    assets: {
      /** Register an asset provider (sticker pack, template library). */
      registerAssetProvider: (id: string, title: string): Disposable =>
        push(host.registerAssetProvider(id, title)),
      /** Every asset, optionally filtered by type. */
      getAssets: (type?: string): Asset[] => {
        void type;
        return [...domain.assets.entries()].map(([id, entry]) => ({ id, title: entry.title }));
      },
    },
    styles: {
      /** Register a color palette for pickers. */
      registerColorPalette: (palette: ColorPalette): Disposable => {
        if (!palette || palette.id === "") throw new Error("palette id must not be empty");
        domain.palettes.set(palette.id, palette);
        const disposable = { dispose: () => void domain.palettes.delete(palette.id) };
        forget(disposable);
        return disposable;
      },
      /** Register a gradient preset. */
      registerGradientPreset: (preset: GradientPreset): Disposable => {
        domain.gradients.set(preset.id, preset);
        const disposable = { dispose: () => void domain.gradients.delete(preset.id) };
        forget(disposable);
        return disposable;
      },
      /** Register a style preset (fill + stroke bundle). */
      registerStylePreset: (preset: StylePreset): Disposable => {
        domain.stylePresets.set(preset.id, preset);
        const disposable = { dispose: () => void domain.stylePresets.delete(preset.id) };
        forget(disposable);
        return disposable;
      },
    },
    fonts: {
      /** Register a font provider (system, webfont, bundled). */
      registerFontProvider: (provider: FontProvider): Disposable => {
        domain.fonts.set(provider.id, provider);
        const disposable = { dispose: () => void domain.fonts.delete(provider.id) };
        forget(disposable);
        return disposable;
      },
    },
    snap: {
      /** Register a canvas snap behavior (grid, edges, centers). */
      registerSnapBehavior: (behavior: SnapBehavior): Disposable => {
        domain.snaps.set(behavior.id, behavior);
        const disposable = { dispose: () => void domain.snaps.delete(behavior.id) };
        forget(disposable);
        return disposable;
      },
    },
    format: {
      /** Register a file importer (`fig`, `svg`, …). */
      registerImporter: (options: Importer): Disposable => {
        if (!options || options.format === "") throw new Error("importer format must not be empty");
        domain.importers.set(options.format, options);
        const disposable = { dispose: () => void domain.importers.delete(options.format) };
        forget(disposable);
        return disposable;
      },
      /** Register a file exporter (`svg`, `png`, `pdf`, …). */
      registerExporter: (options: Exporter): Disposable => {
        if (!options || options.format === "") throw new Error("exporter format must not be empty");
        domain.exporters.set(options.format, options);
        const disposable = { dispose: () => void domain.exporters.delete(options.format) };
        forget(disposable);
        return disposable;
      },
    },
    home: {
      /** Register a project template for the Home create-new flow. */
      registerProjectTemplate: (template: ProjectTemplate): Disposable => {
        domain.templates.set(template.id, template);
        const disposable = { dispose: () => void domain.templates.delete(template.id) };
        forget(disposable);
        return disposable;
      },
      /** Add a widget card to the Home screen. */
      addHomeWidget: (widget: HomeWidget): Disposable => {
        domain.widgets.set(widget.id, widget);
        const disposable = { dispose: () => void domain.widgets.delete(widget.id) };
        forget(disposable);
        return disposable;
      },
    },
    storage: {
      /** Persistent per-extension storage (survives restarts). */
      get: <T>(key: string, fallback: T): T => host.storage.get(key, fallback),
      set: (key: string, value: unknown): Promise<void> => host.storage.set(key, value),
      /** Remove one key. */
      delete: (key: string): Promise<void> => host.storage.delete(key),
      /** Remove every key in this extension's scope. */
      clear: (): Promise<void> => host.storage.clear(),
    },
    output: {
      /** Create a named output channel for this extension's logs. */
      createOutputChannel: (name: string): OutputChannel => {
        if (host.createOutputChannel) return host.createOutputChannel(name);
        return new MemoryOutputChannel(name);
      },
    },
    extensions: {
      /** Look up one installed extension. */
      getExtension: (id: string) => host.getExtension(id),
      /** Every installed extension. */
      getAll: () => host.getAllExtensions(),
      /** Subscribe to activations. */
      onDidActivate: (listener: (id: string) => void): Disposable => {
        if (host.onDidActivateExtension) return push(host.onDidActivateExtension(listener));
        return push({ dispose: () => undefined });
      },
      /** Subscribe to deactivations. */
      onDidDeactivate: (listener: (id: string) => void): Disposable => {
        if (host.onDidDeactivateExtension) return push(host.onDidDeactivateExtension(listener));
        return push({ dispose: () => undefined });
      },
      /** Subscribe to activation failures. */
      onDidFail: (listener: (id: string, reason: string) => void): Disposable => {
        void listener;
        if (host.onDidFailExtension) return push(host.onDidFailExtension(listener));
        return push({ dispose: () => undefined });
      },
    },
    env: host.env,
    clipboard: host.clipboard,
    fs: host.fs,
  };
}

/** Full namespaced API extensions program against (see `createGrafalithApi`). */
export interface GrafalithApi {
  readonly commands: {
    register(id: string, handler: ExtensionCommandHandler): Disposable;
    execute(id: string, ...args: unknown[]): Promise<unknown>;
    getAll(): string[];
    unregister(id: string): boolean;
    has(id: string): boolean;
    onDidExecute(listener: (id: string) => void): Disposable;
  };
  readonly events: {
    on(event: string, listener: (payload: unknown) => void): Disposable;
    emit(event: string, payload?: unknown): void;
    off(event: string, listener: (payload: unknown) => void): void;
  };
  readonly context: {
    setContext(key: string, value: string | boolean | number): void;
    getContext<T>(key: string, fallback: T): T;
    onDidChange(listener: (key: string) => void): Disposable;
    matches(when: string | undefined): boolean;
  };
  readonly ui: {
    readonly menuBar: {
      addMenu(menu: string): Disposable;
      addMenuItem(menu: string, item: MenuItem): Disposable;
      addSeparator(menu: string): Disposable;
    };
    readonly activityBar: {
      addItem(item: ActivityBarItem): Disposable;
      removeItem(id: string): void;
      setBadge(id: string, badge: string | undefined): void;
    };
    readonly statusBar: {
      addItem(item: StatusBarItem): Disposable;
      removeItem(id: string): void;
      setText(id: string, text: string): void;
      setTooltip(id: string, tooltip: string): void;
    };
    readonly contextMenu: {
      addItem(location: string, item: MenuItem): Disposable;
      addSeparator(target: string): Disposable;
    };
    readonly toolbar: { addTool(tool: ToolbarTool): Disposable };
    readonly panel: {
      registerPanel(panel: PanelContribution): Disposable;
      showPanel(id: string): void;
      hidePanel(id: string): void;
      togglePanel(id: string): void;
    };
    readonly modal: {
      showModal(id: string): Promise<unknown>;
      showAlert(message: string): Promise<void>;
      showConfirm(message: string): Promise<boolean>;
      showCustomModal(id: string, props?: unknown): Promise<unknown>;
      registerCustomModal(id: string): Disposable;
    };
    readonly notification: {
      showToast(request: ToastRequest): void;
      showProgress(title: string, task: (fraction: (value: number) => void) => Promise<void>): Promise<void>;
      showStatusMessage(message: string, duration?: number): Disposable;
      dismissAll(): void;
    };
    readonly quickInput: {
      showQuickPick(items: ReadonlyArray<{ id: string; label: string }>, placeholder?: string): Promise<{ id: string; label: string } | undefined>;
      showInputBox(prompt: string, initialValue?: string): Promise<string | undefined>;
    };
    readonly commandPalette: {
      getAll(): string[];
      addItem(item: MenuItem): Disposable;
      removeItem(command: string): void;
    };
  };
  readonly settings: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: string | boolean | number): Promise<void>;
    onDidChange(listener: (key: string) => void): Disposable;
    registerSection(section: { id: string; title: string }): Disposable;
  };
  readonly keybindings: {
    register(binding: { command: string; key: string; when?: string }): Disposable;
    getAll(): readonly { command: string; key: string; when?: string }[];
  };
  readonly workspace: {
    getCurrentProject(): { id: string; kind: EditorKind } | undefined;
    getEditorType(): EditorKind | null;
    onDidOpenProject(listener: (event: { projectId: string }) => void): Disposable;
    onDidCloseProject(listener: (event: { projectId: string }) => void): Disposable;
  };
  readonly editor: {
    getActiveEditor(): { kind: EditorKind } | undefined;
    onDidChangeActiveEditor(listener: (event: { editorType: string }) => void): Disposable;
  };
  readonly canvas: {
    getViewport(): Viewport;
    addOverlay(overlay: CanvasOverlay): Disposable;
    getSelectedObjects(): readonly { id: string }[];
    onDidChangeSelection(listener: (ids: readonly string[]) => void): Disposable;
    onDidChangeViewport(listener: (viewport: Viewport) => void): Disposable;
  };
  readonly tools: {
    registerTool(tool: DesignTool, editorType?: ToolEditorScope): Disposable;
    setActiveTool(toolId: string): void;
    getActiveTool(): string;
    onDidChangeTool(listener: (toolId: string) => void): Disposable;
  };
  readonly shapes: {
    registerShapeType(shape: ShapeType): Disposable;
    getShapeTypes(): ShapeType[];
  };
  readonly diagram: {
    registerNodeType(id: string, title: string): Disposable;
    registerEdgeType(edge: DiagramType): Disposable;
    getNodeTypes(): DiagramType[];
    getEdgeTypes(): DiagramType[];
  };
  readonly properties: {
    registerInspectorSection(section: InspectorSection): Disposable;
    onDidChangeSelection(listener: (ids: readonly string[]) => void): Disposable;
  };
  readonly assets: {
    registerAssetProvider(id: string, title: string): Disposable;
    getAssets(type?: string): Asset[];
  };
  readonly styles: {
    registerColorPalette(palette: ColorPalette): Disposable;
    registerGradientPreset(preset: GradientPreset): Disposable;
    registerStylePreset(preset: StylePreset): Disposable;
  };
  readonly fonts: { registerFontProvider(provider: FontProvider): Disposable };
  readonly snap: { registerSnapBehavior(behavior: SnapBehavior): Disposable };
  readonly format: {
    registerImporter(options: Importer): Disposable;
    registerExporter(options: Exporter): Disposable;
  };
  readonly home: {
    registerProjectTemplate(template: ProjectTemplate): Disposable;
    addHomeWidget(widget: HomeWidget): Disposable;
  };
  readonly storage: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };
  readonly output: { createOutputChannel(name: string): OutputChannel };
  readonly extensions: {
    getExtension(id: string): { id: string } | undefined;
    getAll(): readonly { id: string }[];
    onDidActivate(listener: (id: string) => void): Disposable;
    onDidDeactivate(listener: (id: string) => void): Disposable;
    onDidFail(listener: (id: string, reason: string) => void): Disposable;
  };
  readonly env: EnvInfo;
  readonly clipboard: ClipboardApi;
  readonly fs: FilesystemApi;
}
