import { createRegistry, type Descriptor } from '../../registries/core';
import { isProjectKind, type ProjectKind } from '../../platform/projects/types';
import { projectTemplateRegistry, type ProjectTemplateDefinition } from './templateRegistry';

/** Declarative description of one editor family (design, whiteboard, diagram). */
export interface ProjectKindDefinition extends Descriptor {
  /** English label rendered until `labelKey` resolves. */
  defaultLabel: string;
  /** Locale key for the empty-canvas hint of this family. */
  hintKey: string;
  /** English hint rendered until `hintKey` resolves. */
  defaultHint: string;
}

// Single source for everything that varies per editor family: display
// label, empty-canvas hint, and starting template. Menus, home, cards,
// and editors consume this registry instead of branching on kind ids or
// repeating label keys, so adding a family means adding one entry here
// plus its template, locale strings, and thin editor wrapper.
//
// The `default*` strings below are registry metadata required by the
// shared Descriptor contract (and used by tests); interface text always
// renders through `t(labelKey)` / `t(hintKey)`, never from these fields.
const KINDS: readonly ProjectKindDefinition[] = [
  {
    id: 'design',
    labelKey: 'projects.kinds.design',
    defaultLabel: 'Design',
    hintKey: 'editor.hint.text',
    defaultHint:
      'Drag to select · scroll to pan · Ctrl+scroll to zoom · V selects, R draws, Ctrl+Shift+P commands',
  },
  {
    id: 'whiteboard',
    labelKey: 'projects.kinds.whiteboard',
    defaultLabel: 'Whiteboard',
    hintKey: 'editor.hint.textWhiteboard',
    defaultHint: 'Draw freely · scroll to pan the board · Ctrl+scroll to zoom',
  },
  {
    id: 'diagram',
    labelKey: 'projects.kinds.diagram',
    defaultLabel: 'Diagram',
    hintKey: 'editor.hint.textDiagram',
    defaultHint: 'Click to place shapes · drag between shapes to connect · Ctrl+scroll to zoom',
  },
];

/** Validated lookup over the editor families in creation-menu order. */
export const projectKindRegistry = createRegistry<ProjectKindDefinition>('projectKind', KINDS, {
  validateItem: (kind) => {
    if (!isProjectKind(kind.id)) {
      return `unknown kind id "${kind.id}"`;
    }
    if (kind.hintKey === '') {
      return `missing hintKey for id "${kind.id}"`;
    }
    if (kind.defaultHint === '') {
      return `missing defaultHint for id "${kind.id}"`;
    }
    return undefined;
  },
});

/** Display label key for a family; menus, home, and cards share this. */
export function projectKindLabelKey(kind: ProjectKind): string {
  return projectKindRegistry.get(kind)?.labelKey ?? 'projects.kinds.design';
}

/** Empty-canvas hint key for a family. */
export function projectKindHintKey(kind: ProjectKind): string {
  return projectKindRegistry.get(kind)?.hintKey ?? 'editor.hint.text';
}

/**
 * Starting template for a family. The template owns the kind mapping
 * (each template declares its `kind`); this derives the reverse lookup
 * so the mapping is stored once, never mirrored.
 */
export function templateForKind(kind: ProjectKind): ProjectTemplateDefinition {
  return (
    projectTemplateRegistry.all().find((template) => template.kind === kind) ??
    projectTemplateRegistry.get('blank') ??
    projectTemplateRegistry.all()[0]
  );
}
