/** File suffix for packaged OpenNary extensions. */
export const ONRY_EXTENSION = ".onry";

/** Manifest filename stored at the root of every .onry archive. */
export const ONRY_MANIFEST_FILENAME = "opennary.extension.json";

/** Manifest format version carried inside the file content. */
export const ONRY_FORMAT_VERSION = 1;

/** One contributed command: palette row plus menu/keybinding target. */
export interface OnryCommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
  readonly icon?: string;
}

/** One menu placement for a contributed command. */
export interface OnryMenuPlacement {
  readonly command: string;
  readonly group?: string;
  readonly when?: string;
}

/** One view/activity/panel/status/tool contribution. */
export interface OnryViewContribution {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
}

/** One keybinding for a contributed command. */
export interface OnryKeybindingContribution {
  readonly command: string;
  readonly key: string;
  readonly when?: string;
}

/** One configuration setting a extension owns. */
export interface OnryConfigContribution {
  readonly key: string;
  readonly title: string;
  readonly default: string | boolean | number;
}

/** Contribution sections of an opennary.extension.json file. */
export interface OnryContributes {
  readonly commands?: readonly OnryCommandContribution[];
  readonly menus?: Readonly<Record<string, readonly OnryMenuPlacement[]>>;
  readonly views?: readonly OnryViewContribution[];
  readonly activity?: readonly OnryViewContribution[];
  readonly panels?: readonly OnryViewContribution[];
  readonly status?: readonly OnryViewContribution[];
  readonly tools?: readonly OnryViewContribution[];
  readonly keybindings?: readonly OnryKeybindingContribution[];
  readonly configuration?: readonly OnryConfigContribution[];
}

/** Identity file for one extension package. */
export interface OnryManifest {
  readonly formatVersion: number;
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly engines: { readonly opennary: string };
  readonly main?: string;
  readonly contributes?: OnryContributes;
  readonly activationEvents?: readonly string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validate an opennary.extension.json payload. Returns typed errors instead of
 * throwing so installers show every problem at once.
 */
export function validateOnryManifest(raw: unknown): { manifest?: OnryManifest; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { errors: ["manifest must be a JSON object"] };
  if (raw["formatVersion"] !== ONRY_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${ONRY_FORMAT_VERSION}`);
  }
  if (typeof raw["id"] !== "string" || !ID_PATTERN.test(raw["id"])) {
    errors.push("id must be a lowercase dotted identifier");
  }
  if (typeof raw["publisher"] !== "string" || raw["publisher"].length === 0) {
    errors.push("publisher is required");
  }
  if (typeof raw["name"] !== "string" || raw["name"].length === 0) {
    errors.push("name is required");
  }
  if (typeof raw["version"] !== "string" || !VERSION_PATTERN.test(raw["version"])) {
    errors.push("version must be semver x.y.z");
  }
  const engines = raw["engines"];
  if (!isRecord(engines) || typeof engines["opennary"] !== "string") {
    errors.push("engines.opennary is required");
  }
  if (
    raw["activationEvents"] !== undefined &&
    (!Array.isArray(raw["activationEvents"]) ||
      raw["activationEvents"].some((entry) => typeof entry !== "string"))
  ) {
    errors.push("activationEvents must be string[]");
  }
  if (errors.length > 0) return { errors };
  return {
    manifest: {
      formatVersion: ONRY_FORMAT_VERSION,
      id: raw["id"] as string,
      publisher: raw["publisher"] as string,
      name: raw["name"] as string,
      version: raw["version"] as string,
      engines: { opennary: (engines as Record<string, string>)["opennary"] },
      main: typeof raw["main"] === "string" ? (raw["main"] as string) : undefined,
      contributes: isRecord(raw["contributes"]) ? (raw["contributes"] as OnryContributes) : undefined,
      activationEvents: Array.isArray(raw["activationEvents"])
        ? (raw["activationEvents"] as string[])
        : undefined,
    },
    errors,
  };
}

/** Install-folder id for one manifest (`publisher.id`). */
export function onryPackageId(manifest: Pick<OnryManifest, "publisher" | "id">): string {
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
