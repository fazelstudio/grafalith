import { describe, expect, test } from "bun:test";
import {
  GRLT_EXTENSION,
  GRLT_FORMAT_VERSION,
  grltPackageId,
  satisfiesEngines,
  validateGrltManifest,
} from "./manifest.js";
import { ExtensionCommandRegistry } from "./commands.js";
import { validateContributions } from "./contributions.js";
import { activationMatches, ExtensionRegistry, orderForActivation, shouldActivate } from "./extension.js";
import { MemoryWindowApi } from "./window.js";
import { createMemoryWorkspace, ExtensionMemento } from "./workspace.js";
import { ContextKeyService, evaluateWhen } from "./contextKeys.js";
import { GrafalithEventBus } from "./events.js";
import { createGrafalithApi } from "./grafalith.js";
import { ExtensionCommandRegistry as CommandBus } from "./commands.js";
import { createMemoryStorage } from "./storage.js";
import { createMemorySettings } from "./settings.js";
import { KeybindingRegistry } from "./keybindings.js";
import { createMemoryClipboard, createMemoryFilesystem } from "./hostCapabilities.js";

const HOST = { menuLocations: ["canvas.context", "menubar.file"], iconIds: ["star"] };

describe("grlt manifest", () => {
  test("suffix and version are locked", () => {
    expect(GRLT_EXTENSION).toBe(".grlt");
    expect(GRLT_FORMAT_VERSION).toBe(1);
  });

  test("valid manifests pass with package id", () => {
    const { manifest, errors } = validateGrltManifest({
      formatVersion: 1,
      id: "sticker",
      publisher: "acme",
      name: "Sticker",
      version: "1.2.3",
      engines: { grafalith: "^0.1.0" },
    });
    expect(errors).toEqual([]);
    expect(grltPackageId(manifest!)).toBe("acme.sticker");
  });

  test("identity fields are enforced", () => {
    expect(validateGrltManifest(null).errors).toEqual(["manifest must be a JSON object"]);
    expect(validateGrltManifest({ formatVersion: 99 }).errors.length).toBeGreaterThan(0);
  });

  test("engine ranges gate compatibility", () => {
    expect(satisfiesEngines("*", "0.3.0")).toBe(true);
    expect(satisfiesEngines("^0.1.0", "0.1.5")).toBe(true);
    expect(satisfiesEngines("^0.1.0", "0.2.0")).toBe(false);
    expect(satisfiesEngines("^0.1.0", "1.0.0")).toBe(false);
  });
});

describe("extension commands", () => {
  test("register, gate, execute, dispose", async () => {
    const registry = new ExtensionCommandRegistry();
    let calls = 0;
    const disposable = registry.registerCommand("acme.ping", () => {
      calls += 1;
      return "pong";
    });
    expect(registry.getCommands()).toEqual(["acme.ping"]);
    expect(await registry.executeCommand("acme.ping")).toBe("pong");
    expect(calls).toBe(1);
    disposable.dispose();
    expect(registry.getCommands()).toEqual([]);
  });

  test("duplicates and unknown ids are loud", async () => {
    const registry = new ExtensionCommandRegistry();
    registry.registerCommand("acme.ping", () => undefined);
    expect(() => registry.registerCommand("acme.ping", () => undefined)).toThrow(/already registered/);
    await expect(registry.executeCommand("missing")).rejects.toThrow(/unknown command/);
  });

  test("predicates gate execution", async () => {
    const registry = new ExtensionCommandRegistry();
    registry.registerCommand("acme.gated", () => "yes", { canExecute: () => false });
    expect(registry.canExecute("acme.gated")).toBe(false);
    await expect(registry.executeCommand("acme.gated")).rejects.toThrow(/disabled/);
  });
});

describe("contributions", () => {
  test("valid contributions pass", () => {
    expect(
      validateContributions(
        {
          commands: [{ command: "acme.ping", title: "Ping", icon: "star" }],
          menus: { "canvas.context": [{ command: "acme.ping" }] },
        },
        HOST,
      ),
    ).toEqual([]);
  });

  test("unknown surfaces and dangling targets fail", () => {
    const problems = validateContributions(
      {
        commands: [{ command: "acme.ping", title: "Ping", icon: "nope" }],
        menus: {
          "nowhere.menu": [{ command: "acme.ping" }],
          "canvas.context": [{ command: "acme.ghost" }],
        },
        keybindings: [{ command: "acme.ghost", key: "ctrl+p" }],
      },
      HOST,
    );
    expect(problems.length).toBe(4);
  });
});

describe("activation", () => {
  test("events match triggers", () => {
    expect(activationMatches("onStartup", { kind: "startup" })).toBe(true);
    expect(activationMatches("onHome", { kind: "home" })).toBe(true);
    expect(activationMatches("onProject", { kind: "project" })).toBe(true);
    expect(activationMatches("onEditor:*", { kind: "editor", editorType: "design" })).toBe(true);
    expect(activationMatches("onEditor:whiteboard", { kind: "editor", editorType: "whiteboard" })).toBe(true);
    expect(activationMatches("onEditor:whiteboard", { kind: "editor", editorType: "design" })).toBe(false);
    expect(activationMatches("onCommand:acme.ping", { kind: "command", commandId: "acme.ping" })).toBe(true);
    expect(activationMatches("onCommand:acme.ping", { kind: "command", commandId: "other" })).toBe(false);
    expect(activationMatches("onView:acme.view", { kind: "view", viewId: "acme.view" })).toBe(true);
    expect(activationMatches("onView:acme.view", { kind: "startup" })).toBe(false);
  });

  test("priority orders activation phases", () => {
    const normal = { manifest: { id: "b", name: "B", version: "1.0.0" }, activate: () => undefined };
    const high = {
      manifest: { id: "a", name: "A", version: "1.0.0", priority: "high" as const },
      activate: () => undefined,
    };
    expect(orderForActivation([normal, high]).map((module) => module.manifest.id)).toEqual(["a", "b"]);
  });

  test("modules without events are eager", () => {
    expect(shouldActivate({ manifest: { id: "a", name: "A", version: "1.0.0" }, activate: () => undefined }, { kind: "command", commandId: "x" })).toBe(true);
  });

  test("registry activates lazily by trigger", () => {
    const engine = { apply_batch: () => "{}", element_count: () => 0 };
    const registry = new ExtensionRegistry(engine as never);
    const started: string[] = [];
    registry.register({
      manifest: { id: "lazy", name: "Lazy", version: "1.0.0", activationEvents: ["onCommand:acme.ping"] },
      activate: () => void started.push("lazy"),
    });
    expect(registry.activateByTrigger({ kind: "startup" })).toEqual([]);
    expect(registry.activateByTrigger({ kind: "command", commandId: "acme.ping" })).toEqual(["lazy"]);
    expect(started).toEqual(["lazy"]);
  });
});

describe("window and workspace", () => {
  test("memory window records notifications and status items", () => {
    const windowApi = new MemoryWindowApi();
    windowApi.showNotification("hello", { level: "success" });
    expect(windowApi.notifications).toEqual([{ message: "hello", options: { level: "success" } }]);
    const item = windowApi.createStatusBarItem("acme.status");
    item.text = "Hi";
    item.show();
    expect(windowApi.statusItems.get("acme.status")).toEqual({ text: "Hi", visible: true });
    item.dispose();
    expect(windowApi.statusItems.has("acme.status")).toBe(false);
  });

  test("memory workspace stores config and fires events", async () => {
    const workspace = createMemoryWorkspace();
    expect(workspace.config.get("acme.key", "fallback")).toBe("fallback");
    let changed = "";
    const disposable = workspace.config.onDidChange((key) => void (changed = key));
    workspace.config.set("acme.key", true);
    expect(workspace.config.get("acme.key", false)).toBe(true);
    expect(changed).toBe("acme.key");
    disposable.dispose();
    const memento = new ExtensionMemento();
    await memento.update("last", 3);
    expect(memento.get("last", 0)).toBe(3);
  });
});

describe("context keys and events", () => {
  test("when clauses gate on screen and selection", () => {
    const keys = new ContextKeyService();
    keys.set("grafalith.context.screen", "editor");
    keys.set("grafalith.context.selectedCount", 2);
    expect(evaluateWhen("grafalith.context.screen == editor", keys.snapshot())).toBe(true);
    expect(evaluateWhen("grafalith.context.screen == home", keys.snapshot())).toBe(false);
    expect(evaluateWhen("grafalith.context.selectedCount != 0", keys.snapshot())).toBe(true);
  });

  test("event bus delivers and disposes", () => {
    const bus = new GrafalithEventBus();
    const seen: unknown[] = [];
    const subscription = bus.on("grafalith.project.didOpen", (payload) => void seen.push(payload));
    bus.emit("grafalith.project.didOpen", { projectId: "p1" });
    expect(seen).toEqual([{ projectId: "p1" }]);
    subscription.dispose();
    bus.emit("grafalith.project.didOpen", { projectId: "p2" });
    expect(seen).toEqual([{ projectId: "p1" }]);
  });
});

describe("grafalith facade", () => {
  test("commands, toasts, and context flow through the host", async () => {
    const commands = new CommandBus();
    const windowApi = new MemoryWindowApi();
    const api = createGrafalithApi({
      commands,
      events: new GrafalithEventBus(),
      context: new ContextKeyService(),
      window: windowApi,
      workspace: createMemoryWorkspace(),
      storage: createMemoryStorage(),
      settings: createMemorySettings(),
      keybindings: new KeybindingRegistry(),
      env: { appVersion: "0.1.0", platform: "web", locale: "en", isMac: false, isWindows: false, isLinux: false },
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
    });
    api.commands.register("acme.ping", () => "pong");
    expect(await api.commands.execute("acme.ping")).toBe("pong");
    api.ui.notification.showToast({ type: "warning", message: "heads up", duration: 0, source: "acme.ping" });
    expect(windowApi.notifications[0]).toEqual({
      message: "heads up",
      options: { level: "warning", actions: undefined, duration: 0, source: "acme.ping" },
    });
    api.context.setContext("grafalith.context.screen", "editor");
    expect(api.context.matches("grafalith.context.screen == editor")).toBe(true);
    await api.storage.set("last", 1);
    expect(api.storage.get("last", 0)).toBe(1);
  });
});

describe("extended manifest", () => {
  test("home/editor events, permissions, and priority validate", () => {
    const { manifest, errors } = validateGrltManifest({
      formatVersion: 1,
      id: "hello",
      publisher: "acme",
      name: "Hello",
      version: "1.0.0",
      engines: { grafalith: "^0.1.0" },
      priority: "high",
      permissions: ["notifications"],
      activationEvents: ["onStartup", "onHome", "onEditor:whiteboard"],
      contributes: {
        toolbarItems: [{ id: "acme.tool", title: "Tool", command: "acme.run" }],
        editorTools: { whiteboard: [{ id: "acme.node", title: "Node", command: "acme.run" }] },
        projectTemplates: [{ id: "acme.poster", title: "Poster", kind: "design" }],
      },
    });
    expect(errors).toEqual([]);
    expect(manifest?.priority).toBe("high");
  });

  test("unknown events and permissions fail", () => {
    const { errors } = validateGrltManifest({
      formatVersion: 1,
      id: "hello",
      publisher: "acme",
      name: "Hello",
      version: "1.0.0",
      engines: { grafalith: "^0.1.0" },
      activationEvents: ["onLaunch"],
      permissions: ["root"],
    });
    expect(errors.length).toBe(2);
  });
});
