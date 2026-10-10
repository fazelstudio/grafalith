// Full `grafalith.*` surface: domain namespaces, disposables, output.
import { describe, expect, test } from "bun:test";
import { ExtensionCommandRegistry } from "./commands.js";
import { DisposableCollection, combineDisposables } from "./disposable.js";
import { ContextKeyService } from "./contextKeys.js";
import { GrafalithEventBus } from "./events.js";
import { resolveEnv } from "./env.js";
import { createMemoryClipboard, createMemoryFilesystem } from "./hostCapabilities.js";
import { KeybindingRegistry } from "./keybindings.js";
import { createGrafalithApi } from "./grafalith.js";
import { MemoryOutputChannel } from "./output.js";
import { createMemorySettings } from "./settings.js";
import { createMemoryStorage } from "./storage.js";
import { MemoryWindowApi } from "./window.js";
import { createMemoryWorkspace } from "./workspace.js";

function host() {
  return {
    commands: new ExtensionCommandRegistry(),
    events: new GrafalithEventBus(),
    context: new ContextKeyService(),
    window: new MemoryWindowApi(),
    workspace: createMemoryWorkspace(),
    storage: createMemoryStorage(),
    settings: createMemorySettings(),
    keybindings: new KeybindingRegistry(),
    env: resolveEnv({ appVersion: "0.1.0", platform: "web", locale: "en" }),
    clipboard: createMemoryClipboard(),
    fs: createMemoryFilesystem(),
    addMenuItem: () => ({ dispose: () => undefined }),
    addActivityBarItem: () => ({ dispose: () => undefined }),
    addStatusBarItem: () => ({ dispose: () => undefined }),
    addToolbarTool: () => ({ dispose: () => undefined }),
    registerPanel: () => ({ dispose: () => undefined }),
    showModal: async () => undefined,
    getCurrentProject: () => undefined,
    getActiveEditor: () => undefined,
    registerAssetProvider: () => ({ dispose: () => undefined }),
    registerDiagramNode: () => ({ dispose: () => undefined }),
    getExtension: () => undefined,
    getAllExtensions: () => [],
  };
}

describe("disposables", () => {
  test("collection disposes all and survives bad disposables", () => {
    const collection = new DisposableCollection();
    let calls = 0;
    collection.add({ dispose: () => void (calls += 1) });
    collection.add({ dispose: () => { throw new Error("bad"); } });
    collection.add({ dispose: () => void (calls += 10) });
    expect(collection.size).toBe(3);
    collection.disposeAll();
    expect(calls).toBe(11);
    expect(collection.size).toBe(0);
  });

  test("combined handle disposes every input", () => {
    let calls = 0;
    const combined = combineDisposables(
      { dispose: () => void (calls += 1) },
      { dispose: () => void (calls += 1) },
    );
    combined.dispose();
    expect(calls).toBe(2);
  });
});

describe("output channels", () => {
  test("memory channel buffers and fans out", () => {
    const channel = new MemoryOutputChannel("acme.tool");
    const seen: string[] = [];
    const subscription = channel.onDidAppend((line) => void seen.push(line));
    channel.appendLine("boot");
    channel.append("partial");
    expect(channel.lines()).toEqual(["bootpartial"]);
    expect(seen).toEqual(["boot", "partial"]);
    subscription.dispose();
    channel.clear();
    expect(channel.lines()).toEqual([]);
  });
});

describe("design domain namespaces", () => {  test("tools register per kind, activate, and notify", () => {
    const api = createGrafalithApi(host());
    const seen: string[] = [];
    const subscription = api.tools.onDidChangeTool((id) => void seen.push(id));
    const disposable = api.tools.registerTool({ id: "acme.pen", title: "Pen" }, "whiteboard");
    api.tools.setActiveTool("acme.pen");
    expect(api.tools.getActiveTool()).toBe("acme.pen");
    expect(seen).toEqual(["acme.pen"]);
    subscription.dispose();
    disposable.dispose();
    expect(() => api.tools.registerTool({ id: "", title: "Bad" })).toThrow(/must not be empty/);
  });

  test("shapes, diagram edges, inspector, styles, fonts, snap register", () => {
    const api = createGrafalithApi(host());
    api.shapes.registerShapeType({ id: "acme.star", title: "Star" });
    expect(api.shapes.getShapeTypes().map((shape) => shape.id)).toEqual(["acme.star"]);
    api.diagram.registerEdgeType({ id: "acme.flow", title: "Flow" });
    expect(api.diagram.getEdgeTypes().map((edge) => edge.id)).toEqual(["acme.flow"]);
    expect(api.diagram.getNodeTypes()).toEqual([]);
    const inspector = api.properties.registerInspectorSection({ id: "acme.fill", title: "Fill" });
    expect(() => api.properties.registerInspectorSection({ id: "acme.fill", title: "Dup" })).toThrow(/already registered/);
    inspector.dispose();
    api.styles.registerColorPalette({ id: "acme.brand", title: "Brand", colors: ["#ff0000"] });
    api.styles.registerGradientPreset({ id: "acme.sunset", title: "Sunset" });
    api.styles.registerStylePreset({ id: "acme.card", title: "Card" });
    api.fonts.registerFontProvider({ id: "acme.grotesk", title: "Grotesk" });
    api.snap.registerSnapBehavior({ id: "acme.grid", title: "Grid" });
  });

  test("format importers/exporters and home contributions register", () => {
    const api = createGrafalithApi(host());
    const importer = api.format.registerImporter({ format: "svg", label: "SVG", handler: async () => undefined });
    const exporter = api.format.registerExporter({ format: "svg", label: "SVG", handler: async () => undefined });
    expect(() => api.format.registerImporter({ format: "", label: "Bad", handler: async () => undefined })).toThrow();
    importer.dispose();
    exporter.dispose();
    const template = api.home.registerProjectTemplate({ id: "acme.poster", title: "Poster", kind: "design" });
    const widget = api.home.addHomeWidget({ id: "acme.recent", title: "Recent" });
    template.dispose();
    widget.dispose();
  });

  test("canvas viewport, overlays, and selection flow", () => {
    const api = createGrafalithApi(host());
    expect(api.canvas.getViewport()).toEqual({ zoom: 1, scrollX: 0, scrollY: 0 });
    expect(api.canvas.getSelectedObjects()).toEqual([]);
    const overlay = api.canvas.addOverlay({ id: "acme.grid" });
    overlay.dispose();
    const seen: string[] = [];
    const subscription = api.commands.onDidExecute((id) => void seen.push(id));
    api.commands.register("acme.ping", () => "pong");
    return api.commands.execute("acme.ping").then((value) => {
      expect(value).toBe("pong");
      expect(seen).toEqual(["acme.ping"]);
      expect(api.commands.has("acme.ping")).toBe(true);
      subscription.dispose();
    });
  });

  test("storage deletes and clears", async () => {
    const api = createGrafalithApi(host());
    await api.storage.set("a", 1);
    expect(api.storage.get("a", 0)).toBe(1);
    await api.storage.delete("a");
    expect(api.storage.get("a", 0)).toBe(0);
    await api.storage.set("b", 2);
    await api.storage.clear();
    expect(api.storage.get("b", 0)).toBe(0);
  });

  test("ui shell extras degrade without host hooks", async () => {
    const api = createGrafalithApi(host());
    api.ui.menuBar.addSeparator("file");
    api.ui.activityBar.removeItem("acme.rail");
    api.ui.activityBar.setBadge("acme.rail", "3");
    api.ui.statusBar.setText("acme.clock", "12:00");
    api.ui.statusBar.setTooltip("acme.clock", "Clock");
    api.ui.contextMenu.addSeparator("editor");
    api.ui.panel.showPanel("acme.panel");
    api.ui.panel.hidePanel("acme.panel");
    api.ui.panel.togglePanel("acme.panel");
    api.ui.commandPalette.addItem({ command: "acme.ping" });
    api.ui.commandPalette.removeItem("acme.ping");
    api.ui.notification.dismissAll();
    await api.ui.modal.showAlert("hi");
    await api.ui.modal.showConfirm("sure?");
    const modal = api.ui.modal.registerCustomModal("acme.dialog");
    modal.dispose();
    expect(api.workspace.getEditorType()).toBe(null);
    expect(api.assets.getAssets()).toEqual([]);
    const channel = api.output.createOutputChannel("acme.tool");
    channel.appendLine("hello");
    expect(channel.lines()).toEqual(["hello"]);
  });

  test("env carries dev flag", () => {
    expect(resolveEnv({ appVersion: "0.1.0", platform: "web", locale: "en" }).isDev).toBe(false);
    expect(resolveEnv({ appVersion: "0.1.0", platform: "web", locale: "en", isDev: true }).isDev).toBe(true);
  });

  test("events off removes the exact listener", () => {
    const api = createGrafalithApi(host());
    const seen: unknown[] = [];
    const listener = (payload: unknown): void => void seen.push(payload);
    api.events.on("grafalith.project.didOpen", listener);
    api.events.emit("grafalith.project.didOpen", { projectId: "p1" });
    api.events.off("grafalith.project.didOpen", listener);
    api.events.emit("grafalith.project.didOpen", { projectId: "p2" });
    expect(seen).toEqual([{ projectId: "p1" }]);
  });
});
