export { createRegistry, type Descriptor, type Registry, type RegistryOptions } from './core';
export {
  toolRegistry,
  toolGroups,
  toolsForGroup,
  type ToolDefinition,
  type ToolGroup,
  type ToolMode,
  type ToolBarPlacement,
} from './tools';
export { statusRegistry, statusForSide, type StatusDefinition, type StatusSide } from './status';
export { activityRegistry, activities, type ActivityDefinition } from './activity';
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
  appCommandRegistry,
  appCommandsForSurface,
  searchAppCommands,
  executeAppCommand,
  canExecuteAppCommand,
  type AppCommandContext,
  type AppCommandDefinition,
  type AppCommandSurface,
  type AppCommandScope,
  type AppCommandCategory,
  type AppCommandVerdict,
  type AppCommandResult,
} from './appCommands';
export {
  menuRegistry,
  menusFor,
  menuLocations,
  type MenuItemDefinition,
  type MenuLocation,
} from './menus';
export {
  searchUnifiedPalette,
  executeUnifiedRow,
  groupUnifiedRows,
  menuRowExecutable,
  executeMenuRow,
  selectOptionsFor,
  extensionRowsFor,
  type UnifiedPaletteRow,
} from './unified';
export { paletteMru, recordPaletteUse } from './paletteMru';
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
