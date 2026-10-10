/**
 * Toolbar extension example: a custom UI built from scratch on the
 * TypeScript SDK, running against the real wasm-pack `nodejs` artifact.
 *
 * Run after `bun run build:wasm:node`:
 *   bun --filter @fazelstudio/grafalith-sdk example
 * (or from this directory: `bun example/toolbar-extension.ts`)
 */
import { JsEngine } from "../../../pkg/node/grafalith.js";
import {
  EngineClient,
  ExtensionRegistry,
  OverlayRegistry,
  type DrawCalls,
  type DrawSnapshot,
  type ExtensionModule,
} from "../src/index.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

/** Recording draw surface (node has no canvas; the host provides one). */
class RecordingSurface implements DrawCalls {
  readonly calls: Array<{ x: number; y: number; width: number; height: number; style: string }> = [];

  rect(x: number, y: number, width: number, height: number, style: string): void {
    this.calls.push({ x, y, width, height, style });
  }
}

/** The extension: two toolbar buttons plus one overlay painter. */
const toolbarExtension: ExtensionModule = {
  manifest: {
    id: "example.toolbar",
    name: "Example Toolbar",
    version: "0.1.0",
    tools: [
      {
        id: "rectangle",
        title: "Rectangle",
        run: ({ engine }) => {
          const accepted = engine.activateTool("rectangle");
          assert(accepted === true, "rectangle tool accepted");
        },
      },
      {
        id: "undo",
        title: "Undo",
        run: ({ engine }) => {
          assert(engine.undo() === true, "undo did something");
        },
      },
    ],
  },

  activate: ({ engine }) => {
    // Draw one rectangle through pointer ops (a canvas gesture).
    engine.batch([
      { op: "pointerDown", x: 10, y: 10, button: "left" },
      { op: "pointerMove", x: 110, y: 60 },
      { op: "pointerUp", x: 110, y: 60, button: "left" },
    ]);
    const state = engine.sessionState();
    assert(state.selection.length === 1, "gesture selected the rectangle");
    assert(state.canUndo === true, "gesture is undoable");
  },
};

/** Overlay: dimension boxes around every entry (custom canvas layer). */
const dimensionsOverlay = {
  name: "selection-dimensions",
  render(calls: DrawCalls, entries: DrawSnapshot[]): void {
    for (const entry of entries) {
      const { minX, minY, maxX, maxY } = entry.bounds;
      calls.rect(minX, minY, maxX - minX, maxY - minY, "dimensions");
    }
  },
};

const engine = new EngineClient(new JsEngine());
const registry = new ExtensionRegistry(engine);
const overlays = new OverlayRegistry();

registry.register(toolbarExtension);
overlays.register(dimensionsOverlay);
assert(registry.ids.join() === "example.toolbar", "extension registered");

registry.runTool("example.toolbar", "rectangle");
registry.activate("example.toolbar");

const surface = new RecordingSurface();
overlays.renderAll(surface, engine.renderEntries(800, 600));
assert(surface.calls.length === 1, "overlay painted one box");
assert(surface.calls[0].width === 100, "overlay box matches the rectangle");

registry.runTool("example.toolbar", "undo");
// Undo removes the element; the selection mirror keeps the dead id until
// the host re-selects (pruning happens on delete paths, not undo).
assert(engine.renderEntries(800, 600).length === 0, "undo cleared the scene");

registry.disposeAll();
assert(registry.ids.length === 0, "dispose clears the registry");
console.log("toolbar extension scenario complete (bun + real wasm artifact)");
