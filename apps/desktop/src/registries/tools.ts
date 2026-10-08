import { createRegistry, type Descriptor } from './core';

/**
 * Semantic workflow group; the toolbar derives sections from this instead
 * of branching on tool ids. Groups follow interaction workflow (select,
 * shape creation, connectors, freehand, text) rather than engine module
 * source.
 */
export type ToolGroup = 'selection' | 'shapes' | 'connectors' | 'draw' | 'text';

/** Persistent interaction mode (tools are modes, commands are discrete actions). */
export type ToolMode = 'persistent';
export type ToolBarPlacement = 'primary' | 'more';

/** Declarative description of one drawing tool. */
export interface ToolDefinition extends Descriptor {
  /** Workflow section the toolbar renders the tool under. */
  group: ToolGroup;
  /** Persistent mode: the tool stays active across pointer events until switched. */
  mode: ToolMode;
  /** Display-only shortcut hint; the global shortcut registry owns dispatch. */
  shortcutHint?: string;
  /** Localization key for `defaultDescription` (paired, all-or-nothing). */
  descriptionKey?: string;
  /** Tooltip text; falls back to `defaultLabel` when absent. */
  defaultDescription?: string;
  /** Tool id sent to the engine; always the descriptor id in this shell. */
  engineTool: string;
  /** Engine capability requirement (documents why a tool is or isn't registered). */
  capability?: string;
  /** Whether the tool is promoted to the compact editor toolbar. */
  toolbarPlacement: ToolBarPlacement;
  /** Shared icon identifier resolved by the host icon registry. */
  icon: string;
}

/**
 * Registry-driven tool set. Every entry maps to a real engine `ToolId`
 * (`select`, `text`, or `Draw(shape)`): `select`, `rectangle`, `ellipse`,
 * `line`, `arrow`, `text`, `freedraw`, plus `frame` (engine `Draw(frame)`,
 * host rubber-draw like other shapes). Engine gaps are NOT registered here
 * — see `engineGaps.ts` — rather than faked in React.
 */
const TOOLS: readonly ToolDefinition[] = [
  {
    id: 'select',
    labelKey: 'editor.tools.select',
    defaultLabel: 'Select',
    group: 'selection',
    mode: 'persistent',
    shortcutHint: 'V',
    descriptionKey: 'editor.tools.selectDescription',
    defaultDescription: 'Select and move elements',
    engineTool: 'select',
    capability: 'engine ToolId::Select',
    toolbarPlacement: 'primary',
    icon: 'select',
  },
  {
    id: 'rectangle',
    labelKey: 'editor.tools.rectangle',
    defaultLabel: 'Rectangle',
    group: 'shapes',
    mode: 'persistent',
    shortcutHint: 'R',
    descriptionKey: 'editor.tools.rectangleDescription',
    defaultDescription: 'Draw a rectangle',
    engineTool: 'rectangle',
    capability: 'engine ToolId::Draw(rectangle)',
    toolbarPlacement: 'primary',
    icon: 'rectangle',
  },
  {
    id: 'ellipse',
    labelKey: 'editor.tools.ellipse',
    defaultLabel: 'Ellipse',
    group: 'shapes',
    mode: 'persistent',
    shortcutHint: 'O',
    descriptionKey: 'editor.tools.ellipseDescription',
    defaultDescription: 'Draw an ellipse',
    engineTool: 'ellipse',
    capability: 'engine ToolId::Draw(ellipse)',
    toolbarPlacement: 'primary',
    icon: 'ellipse',
  },
  {
    id: 'frame',
    labelKey: 'editor.tools.frame',
    defaultLabel: 'Frame',
    group: 'shapes',
    mode: 'persistent',
    shortcutHint: 'F',
    descriptionKey: 'editor.tools.frameDescription',
    defaultDescription: 'Draw a frame',
    engineTool: 'frame',
    capability: 'engine ToolId::Draw(frame)',
    toolbarPlacement: 'primary',
    icon: 'frame',
  },
  {
    id: 'line',
    labelKey: 'editor.tools.line',
    defaultLabel: 'Line',
    group: 'connectors',
    mode: 'persistent',
    shortcutHint: 'L',
    descriptionKey: 'editor.tools.lineDescription',
    defaultDescription: 'Draw a line',
    engineTool: 'line',
    capability: 'engine ToolId::Draw(line)',
    toolbarPlacement: 'primary',
    icon: 'line',
  },
  {
    id: 'arrow',
    labelKey: 'editor.tools.arrow',
    defaultLabel: 'Arrow',
    group: 'connectors',
    mode: 'persistent',
    shortcutHint: 'A',
    descriptionKey: 'editor.tools.arrowDescription',
    defaultDescription: 'Draw an arrow',
    engineTool: 'arrow',
    capability: 'engine ToolId::Draw(arrow)',
    toolbarPlacement: 'primary',
    icon: 'arrow',
  },
  {
    id: 'text',
    labelKey: 'editor.tools.text',
    defaultLabel: 'Text',
    group: 'text',
    mode: 'persistent',
    shortcutHint: 'T',
    descriptionKey: 'editor.tools.textDescription',
    defaultDescription: 'Create or edit text',
    engineTool: 'text',
    capability: 'engine ToolId::Text',
    toolbarPlacement: 'primary',
    icon: 'text',
  },
  {
    id: 'freedraw',
    labelKey: 'editor.tools.freedraw',
    defaultLabel: 'Freedraw',
    group: 'draw',
    mode: 'persistent',
    shortcutHint: 'P',
    descriptionKey: 'editor.tools.freedrawDescription',
    defaultDescription: 'Draw freehand',
    engineTool: 'freedraw',
    capability: 'engine ToolId::Draw(freedraw)',
    toolbarPlacement: 'more',
    icon: 'freedraw',
  },
];

function findToolShortcutCollisions(items: readonly ToolDefinition[]): readonly string[] {
  const ownerByHint = new Map<string, string>();
  const problems: string[] = [];
  for (const item of items) {
    if (!item.shortcutHint) continue;
    const owner = ownerByHint.get(item.shortcutHint);
    if (owner) {
      problems.push(`shortcut "${item.shortcutHint}" claimed by "${owner}" and "${item.id}"`);
    } else {
      ownerByHint.set(item.shortcutHint, item.id);
    }
  }
  return problems;
}

/** Validated lookup over the drawing tools. */
export const toolRegistry = createRegistry('tool', TOOLS, {
  validateItem: (tool) => {
    const keyed = tool.descriptionKey !== undefined;
    const described = tool.defaultDescription !== undefined;
    if (keyed !== described) {
      return `descriptionKey and defaultDescription must both be present or absent for id "${tool.id}"`;
    }
    if (tool.engineTool === '') {
      return `empty engineTool for id "${tool.id}"`;
    }
    if (tool.mode !== 'persistent') {
      return `unknown mode "${tool.mode}" for id "${tool.id}"`;
    }
    return undefined;
  },
  validateAll: findToolShortcutCollisions,
});

/** Tool groups in toolbar display order, derived from registry data. */
export function toolGroups(): readonly ToolGroup[] {
  const groups: ToolGroup[] = [];
  for (const tool of toolRegistry.all()) {
    if (!groups.includes(tool.group)) groups.push(tool.group);
  }
  return groups;
}

/** Tools for one workflow group in registration order. */
export function toolsForGroup(group: ToolGroup): readonly ToolDefinition[] {
  return toolRegistry.all().filter((tool) => tool.group === group);
}
