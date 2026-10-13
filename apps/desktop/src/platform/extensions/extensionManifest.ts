/** File suffix for packaged Grafalith extensions. */
export const GRLT_EXTENSION = '.grlt';

/** Manifest filename stored at the root of every .grlt archive. */
export const GRLT_MANIFEST_FILENAME = 'grafalith.extension.json';

/** Manifest format version carried inside the file content, not the suffix. */
export const GRLT_FORMAT_VERSION = 1;

/** Manifest permission (host capability gate). */
export type GrltPermission =
  | 'filesystem:read'
  | 'filesystem:write'
  | 'network'
  | 'clipboard'
  | 'notifications';

/** Contribution section a extension may declare (mirrors the SDK surface). */
export interface GrltContributes {
  commands?: readonly { command: string; title: string; category?: string; icon?: string }[];
  menus?: Readonly<Record<string, readonly { command: string; group?: string; when?: string }[]>>;
  views?: readonly { id: string; title: string; icon?: string }[];
  activity?: readonly { id: string; title: string; icon?: string }[];
  panels?: readonly { id: string; title: string; icon?: string }[];
  status?: readonly { id: string; title: string; icon?: string }[];
  tools?: readonly { id: string; title: string; icon?: string }[];
  keybindings?: readonly { command: string; key: string; when?: string }[];
  configuration?: readonly { key: string; title: string; default: string | boolean | number }[];
  activityBarItems?: readonly { id: string; title: string; icon?: string }[];
  statusBarItems?: readonly { id: string; title: string; icon?: string }[];
  toolbarItems?: readonly { id: string; title: string; command: string; when?: string; icon?: string }[];
  editorTools?: Readonly<{
    design?: readonly { id: string; title: string; command: string; icon?: string }[];
    whiteboard?: readonly { id: string; title: string; command: string; icon?: string }[];
    diagram?: readonly { id: string; title: string; command: string; icon?: string }[];
  }>;
  themes?: readonly { id: string; label: string; kind?: 'light' | 'dark' }[];
  diagramNodes?: readonly { id: string; title: string; icon?: string }[];
  assetProviders?: readonly { id: string; title: string }[];
  homeWidgets?: readonly { id: string; title: string }[];
  projectTemplates?: readonly { id: string; title: string; kind: 'design' | 'whiteboard' | 'slides' }[];
  modals?: readonly { id: string; title: string }[];
}

/** Identity file for one extension package. */
export interface GrltManifest {
  formatVersion: number;
  id: string;
  publisher: string;
  name: string;
  version: string;
  description?: string;
  license?: string;
  categories?: readonly string[];
  keywords?: readonly string[];
  engines: { grafalith: string };
  main?: string;
  priority?: 'high' | 'normal';
  dependencies?: Readonly<Record<string, string>>;
  permissions?: readonly GrltPermission[];
  contributes?: GrltContributes;
  activationEvents?: readonly string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate a grafalith.extension.json payload. Returns typed errors instead of
 * throwing so the installer can show every problem at once. Each message
 * names the field, the rule, and the received value (mirrors the SDK).
 */
export function validateGrltManifest(raw: unknown): { manifest?: GrltManifest; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { errors: ['manifest must be a JSON object'] };
  const get = (key: string): unknown => raw[key];

  if (get('formatVersion') !== GRLT_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${GRLT_FORMAT_VERSION} (received ${String(get('formatVersion'))})`);
  }
  const id = get('id');
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    errors.push(
      'id must be a lowercase dotted identifier "publisher.extension-name" (letters, digits, dot, dash, underscore)',
    );
  }
  const publisher = get('publisher');
  if (typeof publisher !== 'string' || publisher.length === 0) {
    errors.push('publisher is required (non-empty string, e.g. "acme")');
  }
  const name = get('name');
  if (typeof name !== 'string' || name.length === 0) errors.push('name is required (non-empty display name)');
  const version = get('version');
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    errors.push(`version must be semver x.y.z (received ${String(version)})`);
  }
  const engines = get('engines');
  if (!isRecord(engines) || typeof engines['grafalith'] !== 'string' || engines['grafalith'].length === 0) {
    errors.push('engines.grafalith is required (semver range, e.g. "^0.1.0" or "*")');
  }
  if (get('main') !== undefined && (typeof get('main') !== 'string' || (get('main') as string).length === 0)) {
    errors.push('main must be a non-empty entry-point path string (e.g. "./dist/index.js")');
  }
  const activationEvents = get('activationEvents');
  if (activationEvents !== undefined) {
    if (!Array.isArray(activationEvents) || activationEvents.some((entry) => typeof entry !== 'string')) {
      errors.push('activationEvents must be string[]');
    } else {
      const known = [
        'onStartup',
        'onHome',
        'onProject',
        'onEditor:*',
        'onEditor:design',
        'onEditor:whiteboard',
        'onEditor:slides',
      ];
      for (const entry of activationEvents as string[]) {
        const eventKnown =
          known.includes(entry) || entry.startsWith('onCommand:') || entry.startsWith('onView:');
        if (!eventKnown) errors.push(`unknown activationEvent "${entry}"`);
      }
    }
  }
  const permissions = get('permissions');
  if (permissions !== undefined) {
    const knownPermissions = ['filesystem:read', 'filesystem:write', 'network', 'clipboard', 'notifications'];
    if (
      !Array.isArray(permissions) ||
      (permissions as unknown[]).some(
        (entry) => typeof entry !== 'string' || !knownPermissions.includes(entry),
      )
    ) {
      errors.push('permissions must use known values: filesystem:read, filesystem:write, network, clipboard, notifications');
    }
  }
  if (errors.length > 0) return { errors };
  return {
    manifest: {
      formatVersion: GRLT_FORMAT_VERSION,
      id: id as string,
      publisher: publisher as string,
      name: name as string,
      version: version as string,
      description: typeof get('description') === 'string' ? (get('description') as string) : undefined,
      license: typeof get('license') === 'string' ? (get('license') as string) : undefined,
      categories: Array.isArray(get('categories')) ? (get('categories') as string[]) : undefined,
      keywords: Array.isArray(get('keywords')) ? (get('keywords') as string[]) : undefined,
      engines: { grafalith: (engines as Record<string, string>)['grafalith'] },
      main: typeof get('main') === 'string' ? (get('main') as string) : undefined,
      priority: get('priority') === 'high' ? 'high' : undefined,
      dependencies: isRecord(get('dependencies')) ? (get('dependencies') as Record<string, string>) : undefined,
      permissions: Array.isArray(permissions) ? (permissions as GrltPermission[]) : undefined,
      contributes: isRecord(get('contributes')) ? (get('contributes') as GrltContributes) : undefined,
      activationEvents: Array.isArray(activationEvents) ? (activationEvents as string[]) : undefined,
    },
    errors,
  };
}

/** Extension package id used for install folders and duplicate detection. */
export function grltPackageId(manifest: Pick<GrltManifest, 'publisher' | 'id'>): string {
  return `${manifest.publisher}.${manifest.id}`;
}
