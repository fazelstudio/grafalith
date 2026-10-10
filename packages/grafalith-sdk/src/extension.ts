import type { EngineClient } from "./client.js";
import type { DrawSnapshot } from "./client.js";
import type { Disposable, ExtensionCommandRegistry } from "./commands.js";
import type { GrltContributes } from "./manifest.js";
import type { OutputChannel } from "./output.js";
import type { WindowApi } from "./window.js";
import type { WorkspaceApi } from "./workspace.js";

/**
 * What a extension receives on activation. Engine access is always
 * present; commands, window, and workspace are injected by the host
 * (desktop wires the real registries, tests inject memory adapters).
 */
export interface ExtensionContext {
  readonly engine: EngineClient;
  readonly commands?: ExtensionCommandRegistry;
  readonly window?: WindowApi;
  readonly workspace?: WorkspaceApi;
  /** Pushed disposables are torn down when the extension deactivates. */
  readonly subscriptions: Disposable[];
  /** Package id (`publisher.id`). */
  readonly id?: string;
  /** Manifest version. */
  readonly version?: string;
  /** Display name of the publisher. */
  readonly publisherDisplayName?: string;
  /** Isolated storage for this extension. */
  readonly storage?: WorkspaceApi["memento"];
  /** Create a named output channel for this extension's logs. */
  readonly createOutputChannel?: (name: string) => OutputChannel;
  /** Install directory of this extension (for its own bundled files). */
  readonly extensionPath?: string;
  /** Whether the host runs in development mode (hot-reload armed). */
  readonly isDevelopment?: boolean;
}

/** One toolbar/menu contribution: an id, a title, and the behavior. */
export interface ToolContribution {
  readonly id: string;
  readonly title: string;
  run(ctx: ExtensionContext): void;
}

/**
 * Static extension metadata. `publisher`, `engines`, `contributes`, and
 * `activationEvents` mirror grafalith.extension.json; older manifests carrying
 * only id/name/version/tools keep working. `priority` and `dependencies`
 * order activation inside each lifecycle phase.
 */
export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher?: string;
  readonly engines?: { readonly grafalith: string };
  readonly tools?: ToolContribution[];
  readonly contributes?: GrltContributes;
  readonly activationEvents?: readonly string[];
  readonly priority?: "high" | "normal";
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly permissions?: readonly string[];
}

/** A loaded extension module: manifest plus lifecycle. */
export interface ExtensionModule {
  readonly manifest: ExtensionManifest;
  activate(ctx: ExtensionContext): void | Promise<void> | Disposable | void;
  deactivate?(): void | Promise<void>;
  dispose?(): void;
}

/** Activation trigger the host fires (startup, home, project, editor, command, view). */
export type ActivationTrigger =
  | { readonly kind: "startup" }
  | { readonly kind: "home" }
  | { readonly kind: "project" }
  | { readonly kind: "editor"; readonly editorType: "design" | "whiteboard" | "diagram" | "*" }
  | { readonly kind: "command"; readonly commandId: string }
  | { readonly kind: "view"; readonly viewId: string };

/**
 * Whether one activation event fires for a trigger. `*` and `onStartup`
 * fire at boot; `onHome` fires when Home renders; `onProject` fires when a
 * project opens; `onEditor:*` and `onEditor:<kind>` fire per editor kind;
 * `onCommand:<id>` and `onView:<id>` fire lazily.
 */
export function activationMatches(event: string, trigger: ActivationTrigger): boolean {
  if (event === "*" || event === "onStartup") return trigger.kind === "startup";
  if (event === "onHome") return trigger.kind === "home";
  if (event === "onProject") return trigger.kind === "project";
  if (event === "onEditor:*") return trigger.kind === "editor";
  if (event.startsWith("onEditor:")) {
    return trigger.kind === "editor" && event.slice("onEditor:".length) === trigger.editorType;
  }
  if (event.startsWith("onCommand:")) {
    return trigger.kind === "command" && event.slice("onCommand:".length) === trigger.commandId;
  }
  if (event.startsWith("onView:")) {
    return trigger.kind === "view" && event.slice("onView:".length) === trigger.viewId;
  }
  return false;
}

/** Whether a module activates for a trigger (no events = eager). */
export function shouldActivate(module: ExtensionModule, trigger: ActivationTrigger): boolean {
  const events = module.manifest.activationEvents;
  if (!events || events.length === 0) return true;
  return events.some((event) => activationMatches(event, trigger));
}

/**
 * Order modules for one activation phase: `priority: "high"` first, then
 * dependency-free modules, then dependents (dependencies first).
 */
export function orderForActivation(modules: readonly ExtensionModule[]): ExtensionModule[] {
  const ordered = [...modules];
  ordered.sort((a, b) => {
    const priority = (module: ExtensionModule): number => (module.manifest.priority === "high" ? 0 : 1);
    if (priority(a) !== priority(b)) return priority(a) - priority(b);
    const aDeps = Object.keys(a.manifest.dependencies ?? {}).length;
    const bDeps = Object.keys(b.manifest.dependencies ?? {}).length;
    return aDeps - bDeps;
  });
  return ordered;
}

/**
 * Host-side extension registry: extensions are registered by id, activated
 * against one shared context factory, and torn down in reverse order.
 * Duplicate ids and unknown ids are loud errors — a half-wired toolbar
 * is worse than none.
 */
export class ExtensionRegistry {
  private readonly modules = new Map<string, ExtensionModule>();
  private readonly contexts = new Map<string, ExtensionContext>();
  private readonly active: string[] = [];
  private readonly contextFactory: () => ExtensionContext;

  constructor(engineOrFactory: EngineClient | (() => ExtensionContext)) {
    if (typeof engineOrFactory === "function") {
      this.contextFactory = engineOrFactory;
    } else {
      const engine = engineOrFactory;
      this.contextFactory = () => ({ engine, subscriptions: [] });
    }
  }

  register(module: ExtensionModule): void {
    if (this.modules.has(module.manifest.id)) {
      throw new Error(`extension already registered: ${module.manifest.id}`);
    }
    this.modules.set(module.manifest.id, module);
  }

  activate(id: string): void {
    const module = this.modules.get(id);
    if (!module) {
      throw new Error(`unknown extension: ${id}`);
    }
    const ctx = this.contextFactory();
    this.contexts.set(id, ctx);
    void module.activate(ctx);
    if (!this.active.includes(id)) this.active.push(id);
  }

  /** Activate every module matching a trigger; returns the ids started. */
  activateByTrigger(trigger: ActivationTrigger): string[] {
    const started: string[] = [];
    for (const [id, module] of orderForActivation([...this.modules.values()]).map(
      (module) => [module.manifest.id, module] as const,
    )) {
      if (!this.active.includes(id) && shouldActivate(module, trigger)) {
        const ctx = this.contextFactory();
        this.contexts.set(id, ctx);
        void module.activate(ctx);
        this.active.push(id);
        started.push(id);
      }
    }
    return started;
  }

  runTool(extensionId: string, toolId: string): void {
    const module = this.modules.get(extensionId);
    if (!module) {
      throw new Error(`unknown extension: ${extensionId}`);
    }
    const tool = module.manifest.tools?.find((candidate) => candidate.id === toolId);
    if (!tool) {
      throw new Error(`unknown tool ${toolId} in extension ${extensionId}`);
    }
    tool.run(this.contextFactory());
  }

  disposeAll(): void {
    for (const id of [...this.active].reverse()) {
      try {
        this.modules.get(id)?.dispose?.();
      } finally {
        for (const subscription of this.contexts.get(id)?.subscriptions.splice(0) ?? []) {
          try {
            subscription.dispose();
          } catch {
            // One bad disposable never blocks the rest of teardown.
          }
        }
        this.contexts.delete(id);
      }
    }
    this.active.length = 0;
    this.modules.clear();
  }

  get ids(): string[] {
    return [...this.modules.keys()];
  }
}

/** Legacy factory: engine-only contexts for the minimal extension SDK. */
export function createEngineOnlyRegistry(engine: EngineClient): ExtensionRegistry {
  return new ExtensionRegistry(() => ({ engine, subscriptions: [] }));
}

/** Minimal draw surface an overlay renderer paints into (host-provided). */
export interface DrawCalls {
  rect(x: number, y: number, width: number, height: number, style: string): void;
}

/** A named overlay painter over render-model snapshots. */
export interface OverlayRenderer {
  readonly name: string;
  render(calls: DrawCalls, entries: DrawSnapshot[]): void;
}

/** Registry of overlay painters (custom canvas layers, minimaps, guides). */
export class OverlayRegistry {
  private readonly renderers = new Map<string, OverlayRenderer>();

  register(renderer: OverlayRenderer): void {
    if (this.renderers.has(renderer.name)) {
      throw new Error(`overlay already registered: ${renderer.name}`);
    }
    this.renderers.set(renderer.name, renderer);
  }

  renderAll(calls: DrawCalls, entries: DrawSnapshot[]): void {
    for (const renderer of this.renderers.values()) {
      renderer.render(calls, entries);
    }
  }

  get names(): string[] {
    return [...this.renderers.keys()];
  }
}
