import { describe, expect, test } from "bun:test";
import {
  ONRY_EXTENSION,
  ONRY_FORMAT_VERSION,
  onryPackageId,
  satisfiesEngines,
  validateOnryManifest,
} from "./manifest.js";
import { ExtensionCommandRegistry } from "./commands.js";
import { validateContributions } from "./contributions.js";
import { activationMatches, ExtensionRegistry, shouldActivate } from "./extension.js";
import { MemoryWindowApi } from "./window.js";
import { createMemoryWorkspace, ExtensionMemento } from "./workspace.js";

const HOST = { menuLocations: ["canvas.context", "menubar.file"], iconIds: ["star"] };

describe("onry manifest", () => {
  test("suffix and version are locked", () => {
    expect(ONRY_EXTENSION).toBe(".onry");
    expect(ONRY_FORMAT_VERSION).toBe(1);
  });

  test("valid manifests pass with package id", () => {
    const { manifest, errors } = validateOnryManifest({
      formatVersion: 1,
      id: "sticker",
      publisher: "acme",
      name: "Sticker",
      version: "1.2.3",
      engines: { opennary: "^0.1.0" },
    });
    expect(errors).toEqual([]);
    expect(onryPackageId(manifest!)).toBe("acme.sticker");
  });

  test("identity fields are enforced", () => {
    expect(validateOnryManifest(null).errors).toEqual(["manifest must be a JSON object"]);
    expect(validateOnryManifest({ formatVersion: 99 }).errors.length).toBeGreaterThan(0);
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
    expect(activationMatches("onCommand:acme.ping", { kind: "command", commandId: "acme.ping" })).toBe(true);
    expect(activationMatches("onCommand:acme.ping", { kind: "command", commandId: "other" })).toBe(false);
    expect(activationMatches("onView:acme.view", { kind: "view", viewId: "acme.view" })).toBe(true);
    expect(activationMatches("onView:acme.view", { kind: "startup" })).toBe(false);
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
