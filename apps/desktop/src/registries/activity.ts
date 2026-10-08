import { createRegistry, type Descriptor } from './core';

/** Activity bar item definition for a dock surface. */
export interface ActivityDefinition extends Descriptor {
  panelId: string;
  icon: string;
  order: number;
}

const ACTIVITIES: readonly ActivityDefinition[] = [
  {
    id: 'layers',
    labelKey: 'editor.panels.layers',
    defaultLabel: 'Layers',
    panelId: 'layers',
    icon: 'layers',
    order: 0,
  },
];

/** Registry for VS Code-style editor activity bar entries. */
export const activityRegistry = createRegistry('activity', ACTIVITIES, {
  validateAll: (items) => {
    const orders = new Set<number>();
    const problems: string[] = [];
    for (const item of items) {
      if (orders.has(item.order)) problems.push(`duplicate activity order "${item.order}"`);
      orders.add(item.order);
    }
    return problems;
  },
});

/** Returns activity entries in display order. */
export function activities(): readonly ActivityDefinition[] {
  return [...activityRegistry.all()].sort((a, b) => a.order - b.order);
}
