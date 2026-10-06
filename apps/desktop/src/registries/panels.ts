import { createRegistry, type Descriptor } from './core';

/** Dock location a panel renders in; the shell derives layout from this. */
export type PanelLocation = 'left' | 'right';

/** Declarative description of one editor panel. */
export interface PanelDefinition extends Descriptor {
  /** Dock side inside the editor workspace. */
  location: PanelLocation;
  /** Position within its dock; lower renders first. */
  order: number;
  /** Whether the panel starts open before workspace preferences load. */
  defaultOpen: boolean;
  /** Localization key for the collapsed toggle tooltip. */
  toggleKey: string;
  /** English toggle tooltip rendered until `toggleKey` resolves. */
  defaultToggle: string;
}

const PANELS: readonly PanelDefinition[] = [
  {
    id: 'layers',
    labelKey: 'editor.panels.layers',
    defaultLabel: 'Layers',
    location: 'left',
    order: 0,
    defaultOpen: true,
    toggleKey: 'editor.panels.layersToggle',
    defaultToggle: 'Toggle layers panel',
  },
  {
    id: 'inspector',
    labelKey: 'editor.panels.inspector',
    defaultLabel: 'Inspector',
    location: 'right',
    order: 0,
    defaultOpen: true,
    toggleKey: 'editor.panels.inspectorToggle',
    defaultToggle: 'Toggle inspector panel',
  },
];

/** Validated lookup over the editor panels. */
export const panelRegistry = createRegistry('panel', PANELS, {
  validateItem: (panel) => {
    if (panel.toggleKey === '') {
      return `empty toggleKey for id "${panel.id}"`;
    }
    if (panel.defaultToggle === '') {
      return `empty defaultToggle for id "${panel.id}"`;
    }
    return undefined;
  },
  validateAll: (items) => {
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const item of items) {
      const slot = `${item.location}:${item.order}`;
      if (seen.has(slot)) {
        problems.push(`duplicate panel slot "${slot}" for id "${item.id}"`);
      }
      seen.add(slot);
    }
    return problems;
  },
});

/** Panels for one dock side in display order. */
export function panelsFor(location: PanelLocation): readonly PanelDefinition[] {
  return panelRegistry.all().filter((panel) => panel.location === location);
}
