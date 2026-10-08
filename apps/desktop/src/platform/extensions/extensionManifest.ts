/** File suffix for packaged OpenNary extensions. */
export const ONRY_EXTENSION = '.onry';

/** Manifest filename stored at the root of every .onry archive. */
export const ONRY_MANIFEST_FILENAME = 'opennary.extension.json';

/** Manifest format version carried inside the file content, not the suffix. */
export const ONRY_FORMAT_VERSION = 1;

/** Contribution section a extension may declare (mirrors the SDK surface). */
export interface OnryContributes {
  commands?: readonly { command: string; title: string; category?: string; icon?: string }[];
  menus?: Readonly<Record<string, readonly { command: string; group?: string; when?: string }[]>>;
  views?: readonly { id: string; title: string; icon?: string }[];
  activity?: readonly { id: string; title: string; icon?: string }[];
  panels?: readonly { id: string; title: string; icon?: string }[];
  status?: readonly { id: string; title: string; icon?: string }[];
  tools?: readonly { id: string; title: string; icon?: string }[];
  keybindings?: readonly { command: string; key: string; when?: string }[];
  configuration?: readonly { key: string; title: string; default: string | boolean | number }[];
}

/** Identity file for one extension package. */
export interface OnryManifest {
  formatVersion: number;
  id: string;
  publisher: string;
  name: string;
  version: string;
  engines: { opennary: string };
  main?: string;
  contributes?: OnryContributes;
  activationEvents?: readonly string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate an opennary.extension.json payload. Returns typed errors instead of
 * throwing so the installer can show every problem at once.
 */
export function validateOnryManifest(raw: unknown): { manifest?: OnryManifest; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { errors: ['manifest must be a JSON object'] };
  const get = (key: string): unknown => raw[key];

  if (get('formatVersion') !== ONRY_FORMAT_VERSION) {
    errors.push(`formatVersion must be ${ONRY_FORMAT_VERSION}`);
  }
  const id = get('id');
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) errors.push('id must be a lowercase dotted identifier');
  const publisher = get('publisher');
  if (typeof publisher !== 'string' || publisher.length === 0) errors.push('publisher is required');
  const name = get('name');
  if (typeof name !== 'string' || name.length === 0) errors.push('name is required');
  const version = get('version');
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    errors.push('version must be semver x.y.z');
  }
  const engines = get('engines');
  if (!isRecord(engines) || typeof engines['opennary'] !== 'string') {
    errors.push('engines.opennary is required');
  }
  const activationEvents = get('activationEvents');
  if (activationEvents !== undefined) {
    if (!Array.isArray(activationEvents) || activationEvents.some((entry) => typeof entry !== 'string')) {
      errors.push('activationEvents must be string[]');
    }
  }
  if (errors.length > 0) return { errors };
  return {
    manifest: {
      formatVersion: ONRY_FORMAT_VERSION,
      id: id as string,
      publisher: publisher as string,
      name: name as string,
      version: version as string,
      engines: { opennary: (engines as Record<string, string>)['opennary'] },
      main: typeof get('main') === 'string' ? (get('main') as string) : undefined,
      contributes: isRecord(get('contributes')) ? (get('contributes') as OnryContributes) : undefined,
      activationEvents: Array.isArray(activationEvents) ? (activationEvents as string[]) : undefined,
    },
    errors,
  };
}

/** Extension package id used for install folders and duplicate detection. */
export function onryPackageId(manifest: Pick<OnryManifest, 'publisher' | 'id'>): string {
  return `${manifest.publisher}.${manifest.id}`;
}
