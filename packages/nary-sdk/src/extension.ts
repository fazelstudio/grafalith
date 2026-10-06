import type { EngineClient } from "./client.js";
import type { DrawSnapshot } from "./client.js";

/** What an extension receives on activation (engine access only). */
export interface ExtensionContext {
  readonly engine: EngineClient;
}

/** One toolbar/menu contribution: an id, a title, and the behavior. */
export interface ToolContribution {
  readonly id: string;
  readonly title: string;
  run(ctx: ExtensionContext): void;
}

/** Static extension metadata (the `package.json`-side contract). */
export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly tools?: ToolContribution[];
}

/** A loaded extension module: manifest plus lifecycle. */
export interface ExtensionModule {
  readonly manifest: ExtensionManifest;
  activate(ctx: ExtensionContext): void;
  dispose?(): void;
}

/**
 * Host-side extension registry (VSCode activation model): extensions are
 * registered by id, activated against one shared engine client, and torn
 * down in reverse order. Duplicate ids and unknown ids are loud errors —
 * a half-wired toolbar is worse than none.
 */
export class ExtensionRegistry {
  private readonly modules = new Map<string, ExtensionModule>();
  private readonly active: string[] = [];

  constructor(private readonly engine: EngineClient) {}

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
    module.activate({ engine: this.engine });
    this.active.push(id);
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
    tool.run({ engine: this.engine });
  }

  disposeAll(): void {
    for (const id of [...this.active].reverse()) {
      this.modules.get(id)?.dispose?.();
    }
    this.active.length = 0;
    this.modules.clear();
  }

  get ids(): string[] {
    return [...this.modules.keys()];
  }
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
