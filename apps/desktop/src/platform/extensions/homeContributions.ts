// Home-screen contributions: widgets and project templates.
//
// Extensions extend Home declaratively (no shell patching): widgets render
// as cards on the Home screen, templates appear in the create-new flow,
// and interceptors run before the built-in creation path.

/** One Home widget card contributed by a extension. */
export interface HomeWidgetContribution {
  id: string;
  title: string;
  /** Extension package that owns the widget (`publisher.id`). */
  extensionId: string;
}

/** One project template for the create-new flow. */
export interface ProjectTemplateContribution {
  id: string;
  title: string;
  kind: 'design' | 'whiteboard' | 'diagram';
  /** Extension package that owns the template. */
  extensionId: string;
}

/** Interceptor running before built-in project creation (may redirect). */
export type ProjectCreateInterceptor = (kind: string) => string | void;

const widgets: HomeWidgetContribution[] = [];
const templates: ProjectTemplateContribution[] = [];
const interceptors: ProjectCreateInterceptor[] = [];

/** Register Home widgets (duplicate ids are loud errors). */
export function registerHomeWidgets(entries: readonly HomeWidgetContribution[]): void {
  for (const entry of entries) {
    if (widgets.some((widget) => widget.id === entry.id)) {
      throw new Error(`duplicate home widget "${entry.id}"`);
    }
    widgets.push(entry);
  }
}

/** Home widgets in registration order. */
export function homeWidgets(): readonly HomeWidgetContribution[] {
  return [...widgets];
}

/** Register project templates for the create-new flow. */
export function registerProjectTemplates(entries: readonly ProjectTemplateContribution[]): void {
  for (const entry of entries) {
    if (!['design', 'whiteboard', 'diagram'].includes(entry.kind)) {
      throw new Error(`unknown template kind "${entry.kind}" for "${entry.id}"`);
    }
    if (templates.some((template) => template.id === entry.id)) {
      throw new Error(`duplicate project template "${entry.id}"`);
    }
    templates.push(entry);
  }
}

/** Project templates, optionally filtered by editor kind. */
export function projectTemplates(kind?: 'design' | 'whiteboard' | 'diagram'): readonly ProjectTemplateContribution[] {
  return templates.filter((template) => !kind || template.kind === kind);
}

/** Register a create-new interceptor (runs before built-in creation). */
export function registerProjectCreateInterceptor(interceptor: ProjectCreateInterceptor): { dispose(): void } {
  interceptors.push(interceptor);
  return { dispose: () => void interceptors.splice(interceptors.indexOf(interceptor), 1) };
}

/** Run interceptors; the first non-empty return wins (template redirect). */
export function interceptProjectCreate(kind: string): string | undefined {
  for (const interceptor of interceptors) {
    const redirect = interceptor(kind);
    if (typeof redirect === 'string' && redirect !== '') return redirect;
  }
  return undefined;
}

/** Remove every widget owned by one extension (unload path). */
export function removeHomeContributions(extensionId: string): void {
  for (let index = widgets.length - 1; index >= 0; index--) {
    if (widgets[index].extensionId === extensionId) widgets.splice(index, 1);
  }
  for (let index = templates.length - 1; index >= 0; index--) {
    if (templates[index].extensionId === extensionId) templates.splice(index, 1);
  }
}

/** Reset all Home contributions (tests and full teardown). */
export function resetHomeContributions(): void {
  widgets.length = 0;
  templates.length = 0;
  interceptors.length = 0;
}
