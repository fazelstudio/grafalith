import { createRegistry, type Descriptor } from './core';

/** Status bar region used by built-in features and future extensions. */
export type StatusSide = 'left' | 'right';

export interface StatusDefinition extends Descriptor {
  side: StatusSide;
  order: number;
}

const STATUS_ITEMS: readonly StatusDefinition[] = [
  { id: 'engine', labelKey: 'editor.status.engine', defaultLabel: 'Engine', side: 'left', order: 0 },
  { id: 'protocol', labelKey: 'editor.status.protocol', defaultLabel: 'Protocol', side: 'left', order: 10 },
  { id: 'selection', labelKey: 'editor.status.selected', defaultLabel: 'Selection', side: 'right', order: 0 },
  { id: 'tool', labelKey: 'editor.status.tool', defaultLabel: 'Tool', side: 'right', order: 10 },
  { id: 'zoom', labelKey: 'editor.status.zoom', defaultLabel: 'Zoom', side: 'right', order: 20 },
];

/** Registry for modular editor status items. */
export const statusRegistry = createRegistry('status', STATUS_ITEMS, {
  validateAll: (items) => {
    const slots = new Set<string>();
    const problems: string[] = [];
    for (const item of items) {
      const slot = `${item.side}:${item.order}`;
      if (slots.has(slot)) problems.push(`duplicate status slot "${slot}"`);
      slots.add(slot);
    }
    return problems;
  },
});

/** Returns status items for a side in deterministic display order. */
export function statusForSide(side: StatusSide): readonly StatusDefinition[] {
  return statusRegistry.all()
    .filter((item) => item.side === side)
    .sort((a, b) => a.order - b.order);
}
