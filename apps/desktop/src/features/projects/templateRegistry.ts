import { createRegistry, type Descriptor } from '../../registries/core';
import { buildBlankSceneEnvelope } from '../../platform/projects/documentEnvelope';

/** Declarative description of one project starting point. */
export interface ProjectTemplateDefinition extends Descriptor {
  /** Localization key for the template description. */
  descriptionKey: string;
  /** English description rendered until the key resolves. */
  defaultDescription: string;
  /** Initial scene payload stored verbatim by the backend. */
  buildScene: () => string;
}

/** Empty scene envelope matching the engine export shape. */
export function buildBlankScene(): string {
  return buildBlankSceneEnvelope();
}

const TEMPLATES: readonly ProjectTemplateDefinition[] = [
  {
    id: 'blank',
    labelKey: 'projects.templates.blank',
    defaultLabel: 'Blank canvas',
    descriptionKey: 'projects.templates.blankDescription',
    defaultDescription: 'An empty canvas with default settings.',
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
      return undefined;
    },
  },
);
