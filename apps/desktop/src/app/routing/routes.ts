/** Route descriptor; the table below is the authority for paths and titles. */
export interface RouteDefinition {
  id: string;
  /** Hash path such as `#/settings/appearance`. */
  path: string;
  /** Locale key for the screen title. */
  titleKey: string;
  /** Locale key for navigation labels. */
  navigationKey: string;
  layout: 'home' | 'editor' | 'settings';
}

const ROUTES: readonly RouteDefinition[] = [
  {
    id: 'home',
    path: '#/',
    titleKey: 'navigation.projects',
    navigationKey: 'navigation.projects',
    layout: 'home',
  },
  {
    id: 'trash',
    path: '#/trash',
    titleKey: 'navigation.trash',
    navigationKey: 'navigation.trash',
    layout: 'home',
  },
  {
    id: 'editor',
    path: '#/editor',
    titleKey: 'navigation.editor',
    navigationKey: 'navigation.editor',
    layout: 'editor',
  },
  {
    id: 'settings',
    path: '#/settings',
    titleKey: 'navigation.settings',
    navigationKey: 'navigation.settings',
    layout: 'settings',
  },
  {
    id: 'settings-appearance',
    path: '#/settings/appearance',
    titleKey: 'settings.appearance.title',
    navigationKey: 'settings.appearance.title',
    layout: 'settings',
  },
  {
    id: 'settings-general',
    path: '#/settings/general',
    titleKey: 'settings.general.title',
    navigationKey: 'settings.general.title',
    layout: 'settings',
  },
  {
    id: 'settings-editor',
    path: '#/settings/editor',
    titleKey: 'settings.editor.title',
    navigationKey: 'settings.editor.title',
    layout: 'settings',
  },
  {
    id: 'settings-shortcuts',
    path: '#/settings/shortcuts',
    titleKey: 'settings.shortcuts.title',
    navigationKey: 'settings.shortcuts.title',
    layout: 'settings',
  },
  {
    id: 'settings-extensions',
    path: '#/settings/extensions',
    titleKey: 'settings.extensions.title',
    navigationKey: 'settings.extensions.title',
    layout: 'settings',
  },
];

function validate(routes: readonly RouteDefinition[]): void {  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const route of routes) {
    if (route.id === '' || ids.has(route.id)) {
      throw new Error(`route registry is invalid: duplicate or empty id "${route.id}"`);
    }
    ids.add(route.id);
    if (paths.has(route.path)) {
      throw new Error(`route registry is invalid: duplicate path "${route.path}"`);
    }
    paths.add(route.path);
    if (route.titleKey === '' || route.navigationKey === '') {
      throw new Error(`route registry is invalid: missing title key for "${route.id}"`);
    }
  }
}

validate(ROUTES);

/** Hash prefix for project-scoped editor locations (`#/editor/<id>`). */
export const EDITOR_PATH_PREFIX = '#/editor/';

/** Editor location for a project id. */
export function editorPath(id: string): string {
  return `${EDITOR_PATH_PREFIX}${encodeURIComponent(id)}`;
}

/** Project id from an editor location, or null when absent/unparseable. */
export function parseEditorProjectId(hash: string): string | null {
  if (!hash.startsWith(EDITOR_PATH_PREFIX)) return null;
  const raw = hash.slice(EDITOR_PATH_PREFIX.length);
  if (raw === '') return null;
  try {
    const id = decodeURIComponent(raw);
    return id === '' ? null : id;
  } catch {
    return null;
  }
}

/** All routes in navigation order. */
export const routeRegistry = {
  all: (): readonly RouteDefinition[] => ROUTES,
  get: (id: string): RouteDefinition | undefined => ROUTES.find((route) => route.id === id),
  fromPath: (hash: string): RouteDefinition => {
    const path = hash === '' ? '#/' : hash;
    const direct = ROUTES.find((route) => route.path === path);
    if (direct) return direct;
    if (path.startsWith(EDITOR_PATH_PREFIX) && parseEditorProjectId(path) !== null) {
      return ROUTES.find((route) => route.id === 'editor')!;
    }
    return ROUTES.find((route) => route.id === 'home')!;
  },
};

/** Primary navigation items rendered by the shell header. */
export const primaryNav: readonly RouteDefinition[] = [routeRegistry.get('home')!];
