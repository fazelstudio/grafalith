import type { ComponentType } from 'react';
import type { ThemeOverride } from '@fazelstudio/fazelidraw/theme';
import type { DrawToolType } from '@fazelstudio/fazelidraw';
import type { ShapeDefinition } from '@fazelstudio/fazelidraw/shapes';
import type { CanvasMode } from '@fazelstudio/fazelidraw';

/** Tool identifiers available in the toolbar. */
export type ToolId = DrawToolType | 'select' | 'pan';

/** Icon names for the icon system. */
export type IconName =
  | 'select'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'arrow'
  | 'pan'
  | 'undo'
  | 'redo'
  | 'export'
  | 'import';

/** Props for the ColorPicker component. Override implementations must satisfy this contract. */
export interface ColorPickerProps {
  /** Current color value (hex string). */
  value: string;
  /** Callback when the user selects a new color. */
  onChange: (color: string) => void;
  /** Optional label shown above the picker (e.g. "Stroke", "Fill"). */
  label?: string;
  /** Optional preset colors to show as swatches. */
  presets?: string[];
}

/** Props for the Toolbar component. Override implementations must satisfy this contract. */
export interface ToolbarProps {
  /** Currently active tool. */
  activeTool: ToolId;
  /** Callback when user selects a tool. */
  onToolChange: (tool: ToolId) => void;
  /** Tools enabled in the engine (null = all). Toolbar hides disabled tools. */
  enabledTools?: string[] | null;
  /** Icon overrides by name. Omitted icons use the built-in set. */
  icons?: Partial<Record<IconName, ComponentType<{ size?: number }>>>;
  /** Whether undo is available. */
  canUndo?: boolean;
  /** Whether redo is available. */
  canRedo?: boolean;
  /** Undo callback. */
  onUndo?: () => void;
  /** Redo callback. */
  onRedo?: () => void;
}

/** Props for the PropertiesPanel component. Override implementations must satisfy this contract. */
export interface PropertiesPanelProps {
  /** Current stroke color. */
  strokeColor: string;
  /** Current fill color (solid). */
  fillColor: string;
  /** Current stroke width. */
  strokeWidth: number;
  /** Current stroke style. */
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  /** Current opacity (0-100). */
  opacity: number;
  /** Current element X position (or combined bounding box X for multi-select). */
  x: number;
  /** Current element Y position. */
  y: number;
  /** Current element width. */
  width: number;
  /** Current element height. */
  height: number;
  /** Current element rotation in degrees (converted from radians). */
  rotation: number;
  /** Whether numeric inputs are enabled (requires selection). */
  numericInputsEnabled: boolean;
  /** Callbacks for style changes. */
  onStrokeColorChange: (color: string) => void;
  onFillColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onStrokeStyleChange: (style: 'solid' | 'dashed' | 'dotted') => void;
  onOpacityChange: (opacity: number) => void;
  /** Callbacks for numeric input changes (commit on blur/Enter). */
  onXChange: (x: number) => void;
  onYChange: (y: number) => void;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onRotationChange: (rotation: number) => void;
  /** Whether the panel is visible. */
  visible: boolean;
  /** Toggle panel visibility. */
  onToggleVisibility: () => void;
  /** Optional ColorPicker override slot (defaults to DefaultColorPicker). */
  ColorPicker?: ComponentType<ColorPickerProps>;
}

/** Configuration for the Fazelidraw editor (mirrors core FazelidrawConfig). */
export interface FazelidrawConfig {
  /** Theme override. Applied on top of default theme. */
  theme?: ThemeOverride;
  /** Tool types that are enabled. If provided, setActiveTool rejects tools not in this list. */
  enabledTools?: string[];
  /** Custom shape definitions (registered into the engine). */
  shapes?: ShapeDefinition[];
  /** Canvas mode (infinite or bounded). */
  canvasMode?: CanvasMode;
}

/** Props for the main FazelidrawEditor component. */
export interface FazelidrawEditorProps {
  /** Editor configuration (theme, etc.). */
  config?: FazelidrawConfig;
  /** Override specific UI components. Omitted components use defaults. */
  components?: {
    Toolbar?: ComponentType<ToolbarProps>;
    ColorPicker?: ComponentType<ColorPickerProps>;
    PropertiesPanel?: ComponentType<PropertiesPanelProps>;
  };
  /** Override specific icons by name. */
  icons?: Partial<Record<IconName, ComponentType<{ size?: number }>>>;
  /** CSS class for the root container. */
  className?: string;
}
