/** File suffix for packaged Grafalith extensions. */
export const GRLT_EXTENSION = ".grlt";

/** Manifest filename stored at the root of every .grlt archive. */
export const GRLT_MANIFEST_FILENAME = "grafalith.extension.json";

/** Manifest format version carried inside the file content. */
export const GRLT_FORMAT_VERSION = 1;

/** One contributed command: palette row plus menu/keybinding target. */
export interface GrltCommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
  readonly icon?: string;
}

/** One menu placement for a contributed command. */
export interface GrltMenuPlacement {
  readonly command: string;
  readonly group?: string;
  readonly when?: string;
}

/** One view/activity/panel/status/tool contribution. */
export interface GrltViewContribution {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

/** One keybinding for a contributed command. */
export interface GrltKeybindingContribution {
  readonly command: string;
  readonly key: string;
  readonly when?: string;
}

/** One configuration setting a extension owns. */
export interface GrltConfigContribution {
  readonly key: string;
  readonly title: string;
  readonly default: string | boolean | number;
}

/** One toolbar item contributed to an editor toolbar. */
export interface GrltToolbarContribution {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  /** Editor kinds this tool targets; absent means all kinds. */
  readonly when?: string;
  readonly icon?: string;
}

/** One per-kind editor tool (design | whiteboard | slides). */
export interface GrltEditorToolContribution {
  readonly id: string;
  readonly title: string;
  readonly command: string;
  readonly icon?: string;
}

/** One theme contributed by a extension. */
export interface GrltThemeContribution {
  readonly id: string;
  readonly label: string;
  readonly kind?: "light" | "dark";
}

/** One diagram node/edge type contributed by a extension. */
export interface GrltDiagramContribution {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

/** One asset provider (sticker pack, template library, …). */
export interface GrltAssetProviderContribution {
  readonly id: string;
  readonly title: string;
}

/** One home-screen widget contributed by a extension. */
export interface GrltHomeWidgetContribution {
  readonly id: string;
  readonly title: string;
}

/** One project template contributed to the create-new flow. */
export interface GrltProjectTemplateContribution {
  readonly id: string;
  readonly title: string;
  /** Editor kind the template creates. */
  readonly kind: "design" | "whiteboard" | "slides";
}

/** One modal/dialog contribution. */
export interface GrltModalContribution {
  readonly id: string;
  readonly title: string;
}

/** Manifest permission (OS/host capability gate). */
export type GrltPermission =
  | "filesystem:read"
  | "filesystem:write"
  | "network"
  | "clipboard"
  | "notifications";

/** Contribution sections of an grafalith.extension.json file. */
export interface GrltContributes {
  readonly commands?: readonly GrltCommandContribution[];
  readonly menus?: Readonly<Record<string, readonly GrltMenuPlacement[]>>;
  readonly views?: readonly GrltViewContribution[];
  readonly activity?: readonly GrltViewContribution[];
  readonly panels?: readonly GrltViewContribution[];
  readonly status?: readonly GrltViewContribution[];
  readonly tools?: readonly GrltViewContribution[];
  readonly keybindings?: readonly GrltKeybindingContribution[];
  readonly configuration?: readonly GrltConfigContribution[];
  readonly activityBarItems?: readonly GrltViewContribution[];
  readonly statusBarItems?: readonly GrltViewContribution[];
  readonly toolbarItems?: readonly GrltToolbarContribution[];
  readonly editorTools?: Readonly<{
    design?: readonly GrltEditorToolContribution[];
    whiteboard?: readonly GrltEditorToolContribution[];
    diagram?: readonly GrltEditorToolContribution[];
  }>;
  readonly themes?: readonly GrltThemeContribution[];
  readonly diagramNodes?: readonly GrltDiagramContribution[];
  readonly assetProviders?: readonly GrltAssetProviderContribution[];
  readonly homeWidgets?: readonly GrltHomeWidgetContribution[];
  readonly projectTemplates?: readonly GrltProjectTemplateContribution[];
  readonly modals?: readonly GrltModalContribution[];
}

/** Identity file for one extension package. */
export interface GrltManifest {
  readonly formatVersion: number;
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly license?: string;
  readonly categories?: readonly string[];
  readonly keywords?: readonly string[];
  readonly engines: { readonly grafalith: string };
  readonly main?: string;
  /** Load priority: "high" runs first (core/built-in extensions). */
  readonly priority?: "high" | "normal";
  /** Other extensions that must activate first (package id → range, `*` ok). */
  readonly dependencies?: Readonly<Record<string, string>>;
  /** Host capabilities the extension may use. */
  readonly permissions?: readonly GrltPermission[];
  readonly contributes?: GrltContributes;
  readonly activationEvents?: readonly string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate an grafalith.extension.json payload. Returns typed errors instead of
 * throwing so installers show every problem at once. Each message names the
 * field, the rule, and the received value so authors fix manifests without
 * reading host source.
 */
export function validateGrltManifest(raw: unknown): { manifest?: GrltManifest; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { errors: ["manifest must be a JSON object"] };
  if (raw["formatVersion"] !== GRLT_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${GRLT_FORMAT_VERSION} (received ${String(raw["formatVersion"])})`);
  }
  if (typeof raw["id"] !== "string" || !ID_PATTERN.test(raw["id"])) {
    errors.push(
      `id must be a lowercase dotted identifier "publisher.extension-name" (letters, digits, dot, dash, underscore; received ${String(raw["id"])})`,
    );
  }
  if (typeof raw["publisher"] !== "string" || raw["publisher"].length === 0) {
    errors.push("publisher is required (non-empty string, e.g. \"acme\")");
  }
  if (typeof raw["name"] !== "string" || raw["name"].length === 0) {
    errors.push("name is required (non-empty display name)");
  }
  if (typeof raw["version"] !== "string" || !VERSION_PATTERN.test(raw["version"])) {
    errors.push(`version must be semver x.y.z (received ${String(raw["version"])})`);
  }
  const engines = raw["engines"];
  if (!isRecord(engines) || typeof engines["grafalith"] !== "string" || engines["grafalith"].length === 0) {
    errors.push("engines.grafalith is required (semver range, e.g. \"^0.1.0\" or \"*\")");
  }
  if (raw["main"] !== undefined && (typeof raw["main"] !== "string" || raw["main"].length === 0)) {
    errors.push("main must be a non-empty entry-point path string (e.g. \"./dist/index.js\")");
  }
  if (
    raw["activationEvents"] !== undefined &&
    (!Array.isArray(raw["activationEvents"]) ||
      raw["activationEvents"].some((entry) => typeof entry !== "string"))
  ) {
    errors.push("activationEvents must be string[]");
  }
  const KNOWN_EVENTS = [
    "onStartup",
    "onHome",
    "onProject",
    "onEditor:*",
    "onEditor:design",
    "onEditor:whiteboard",
    "onEditor:slides",
  ];
  if (Array.isArray(raw["activationEvents"])) {
    for (const entry of raw["activationEvents"] as unknown[]) {
      if (typeof entry !== "string") continue;
      const known =
        KNOWN_EVENTS.includes(entry) ||
        entry.startsWith("onCommand:") ||
        entry.startsWith("onView:");
      if (!known) errors.push(`unknown activationEvent "${entry}"`);
    }
  }
  const permissions = raw["permissions"];
  const KNOWN_PERMISSIONS = ["filesystem:read", "filesystem:write", "network", "clipboard", "notifications"];
  if (permissions !== undefined) {
    if (
      !Array.isArray(permissions) ||
      permissions.some(
        (entry) => typeof entry !== "string" || !KNOWN_PERMISSIONS.includes(entry),
      )
    ) {
      errors.push("permissions must use known values: filesystem:read, filesystem:write, network, clipboard, notifications");
    }
  }
  if (errors.length > 0) return { errors };
  const record = raw as Record<string, unknown>;
  return {
    manifest: {
      formatVersion: GRLT_FORMAT_VERSION,
      id: raw["id"] as string,
      publisher: raw["publisher"] as string,
      name: raw["name"] as string,
      version: raw["version"] as string,
      description: typeof record["description"] === "string" ? (record["description"] as string) : undefined,
      license: typeof record["license"] === "string" ? (record["license"] as string) : undefined,
      categories: Array.isArray(record["categories"])
        ? (record["categories"] as string[])
        : undefined,
      keywords: Array.isArray(record["keywords"]) ? (record["keywords"] as string[]) : undefined,
      engines: { grafalith: (engines as Record<string, string>)["grafalith"] },
      main: typeof raw["main"] === "string" ? (raw["main"] as string) : undefined,
      priority: record["priority"] === "high" ? "high" : undefined,
      dependencies: isRecord(record["dependencies"])
        ? (record["dependencies"] as Record<string, string>)
        : undefined,
      permissions: Array.isArray(permissions) ? (permissions as GrltPermission[]) : undefined,
      contributes: isRecord(raw["contributes"]) ? (raw["contributes"] as GrltContributes) : undefined,
      activationEvents: Array.isArray(raw["activationEvents"])
        ? (raw["activationEvents"] as string[])
        : undefined,
    },
    errors,
  };
}

/** Install-folder id for one manifest (`publisher.id`). */
export function grltPackageId(manifest: Pick<GrltManifest, "publisher" | "id">): string {
  return `${manifest.publisher}.${manifest.id}`;
}

/**
 * Minimal engine-range check (`*` or `^x.y.z`). The host refuses extensions
 * outside its range instead of half-loading them.
 */
export function satisfiesEngines(range: string, hostVersion: string): boolean {
  if (range === "*") return true;
  const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  const host = /^(\d+)\.(\d+)\.(\d+)/.exec(hostVersion.trim());
  if (!caret || !host) return false;
  const [, rMajor, rMinor, rPatch] = caret.map(Number);
  const [, hMajor, hMinor, hPatch] = host.map(Number);
  // Caret semantics: ^1.2.3 is >=1.2.3 <2.0.0; ^0.2.3 is >=0.2.3 <0.3.0;
  // ^0.0.3 is exactly 0.0.3.
  if (rMajor > 0) {
    if (hMajor !== rMajor) return false;
    if (hMinor < rMinor) return false;
    if (hMinor === rMinor && hPatch < rPatch) return false;
    return true;
  }
  if (rMinor > 0) {
    if (hMajor !== 0 || hMinor !== rMinor) return false;
    return hPatch >= rPatch;
  }
  return hMajor === 0 && hMinor === 0 && hPatch === rPatch;
}
