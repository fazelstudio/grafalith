export { createRegistry, type Descriptor, type Registry, type RegistryOptions } from './core';
export { toolRegistry, toolGroups, toolsForGroup, type ToolDefinition, type ToolGroup, type ToolMode } from './tools';
export { panelRegistry, panelsFor, type PanelDefinition, type PanelLocation } from './panels';
export {
  commandRegistry,
  commandsForSurface,
  paletteCommands,
  searchCommands,
  executeCommand,
  canExecuteCommand,
  type CommandContext,
  type CommandDefinition,
  type CommandSurface,
  type CommandScope,
  type CommandCategory,
  type CommandVerdict,
  type CommandResult,
  type CommandDisableReason,
  type ShortcutChord,
  type ViewActions,
  type FileActions,
  type UiActions,
} from './commands';
export {
  isMacPlatform,
  chordMatchesEvent,
  commandShortcuts,
  findCommandForEvent,
  findToolForEvent,
  formatShortcut,
  shortcutKeyLabel,
  commandShortcutLabel,
  isEditableTarget,
  isDialogTarget,
  shouldDispatchInScope,
} from './shortcuts';
