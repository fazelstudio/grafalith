import { createRegistry, type Descriptor } from '../../registries/core';
import { buildBlankSceneEnvelope } from '../../platform/projects/documentEnvelope';
import { isProjectKind, type ProjectKind } from '../../platform/projects/types';

/** Declarative description of one project starting point. */
export interface ProjectTemplateDefinition extends Descriptor {
  /** Localization key for the template description. */
  descriptionKey: string;
  /** English description rendered until the key resolves. */
  defaultDescription: string;
  /** Editor family new projects from this template belong to. */
  kind: ProjectKind;
  /** Initial scene payload stored verbatim by the backend. */
  buildScene: () => string;
}

/** Empty scene envelope matching the engine export shape. */
export function buildBlankScene(): string {
  return buildBlankSceneEnvelope();
}

// Both editor families start from the same blank scene for now; the
// template identity only decides the stored project kind, which selects
// the workspace shell used when the project opens.
const TEMPLATES: readonly ProjectTemplateDefinition[] = [
  {
    id: 'blank',
    labelKey: 'projects.templates.blank',
    defaultLabel: 'Blank canvas',
    descriptionKey: 'projects.templates.blankDescription',
    defaultDescription: 'An empty canvas with default settings.',
    kind: 'design',
    buildScene: buildBlankScene,
  },
  {
    id: 'whiteboard',
    labelKey: 'projects.templates.whiteboard',
    defaultLabel: 'Whiteboard',
    descriptionKey: 'projects.templates.whiteboardDescription',
    defaultDescription: 'An empty whiteboard canvas.',
    kind: 'whiteboard',
    buildScene: buildBlankScene,
  },
  {
    id: 'slides',
    labelKey: 'projects.templates.slides',
    defaultLabel: 'Slides',
    descriptionKey: 'projects.templates.slidesDescription',
    defaultDescription: 'An empty 16:9 slide canvas.',
    kind: 'slides',
    buildScene: buildBlankScene,
  },
];

/** Validated lookup over project templates; the create UI renders this list. */
export const projectTemplateRegistry = createRegistry<ProjectTemplateDefinition>(
  'projectTemplate',
  TEMPLATES,
  {
    validateItem: (template) => {
      if (template.descriptionKey === '') {
        return `missing descriptionKey for id "${template.id}"`;
      }
      if (template.defaultDescription === '') {
        return `missing defaultDescription for id "${template.id}"`;
      }
      if (!isProjectKind(template.kind)) {
        return `unknown kind "${template.kind}" for id "${template.id}"`;
      }
      return undefined;
    },
  },
);
