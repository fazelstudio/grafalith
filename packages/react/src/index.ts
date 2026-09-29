// Main editor component
export { FazelidrawEditor } from './FazelidrawEditor';

// Type exports
export type {
  FazelidrawEditorProps,
  FazelidrawConfig,
  ColorPickerProps,
  ToolbarProps,
  PropertiesPanelProps,
  ToolId,
  IconName,
} from './types';

// Default components (for reference or partial override)
export { DefaultToolbar } from './components/Toolbar';
export { DefaultColorPicker } from './components/ColorPicker';
export { DefaultPropertiesPanel } from './components/PropertiesPanel';

// Icon system
export { getIcon, icons } from './icons';
export type { IconProps } from './icons';

// Hook
export { useFazelidraw } from './hooks/useFazelidraw';
export type { UseFazelidrawReturn } from './hooks/useFazelidraw';
