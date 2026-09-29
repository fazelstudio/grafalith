import { useCallback, useState, useEffect } from 'react';
import type { Editor, FillStyle, StrokeStyle } from '@fazelstudio/fazelidraw';
import type { ToolId } from '../types';

/** Return type of useFazelidraw hook. */
export interface UseFazelidrawReturn {
  /** The Editor instance. */
  editor: Editor;
  /** Currently active tool. */
  activeTool: ToolId;
  /** Currently selected element IDs. */
  selectedElementIds: Set<string>;
  /** Stroke color of the first selected element (or default). */
  strokeColor: string;
  /** Fill color of the first selected element (or default). */
  fillColor: string;
  /** Stroke width of the first selected element (or default). */
  strokeWidth: number;
  /** Stroke style of the first selected element (or default). */
  strokeStyle: StrokeStyle;
  /** Opacity of the first selected element (or default). */
  opacity: number;
  /** Combined bounding box X (or first element X). */
  x: number;
  /** Combined bounding box Y (or first element Y). */
  y: number;
  /** Combined bounding box width (or first element width). */
  width: number;
  /** Combined bounding box height (or first element height). */
  height: number;
  /** Rotation of first selected element in degrees. */
  rotation: number;
  /** Whether numeric inputs are enabled (has selection). */
  numericInputsEnabled: boolean;
  /** Whether undo is available. */
  canUndo: boolean;
  /** Whether redo is available. */
  canRedo: boolean;
  /** Apply style changes to all selected elements. */
  applyStrokeColor: (color: string) => void;
  applyFillColor: (color: string) => void;
  applyStrokeWidth: (width: number) => void;
  applyStrokeStyle: (style: StrokeStyle) => void;
  applyOpacity: (opacity: number) => void;
  /** Apply numeric transform changes (commit as single history entry). */
  applyX: (x: number) => void;
  applyY: (y: number) => void;
  applyWidth: (width: number) => void;
  applyHeight: (height: number) => void;
  applyRotation: (rotation: number) => void;
  /** Force a re-render. */
  forceUpdate: () => void;
}

/**
 * Hook to access and interact with the Fazelidraw engine from React.
 * All access goes through the Editor API — no direct Scene/internal access.
 */
export function useFazelidraw(editor: Editor): UseFazelidrawReturn {
  const [activeTool, setActiveTool] = useState<ToolId>('select');
  const [selectedElementIds, setSelectedElementIds] = useState<Set<string>>(new Set());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((t) => t + 1), []);

  const selectedIds = useCallback(() => Array.from(selectedElementIds), [selectedElementIds]);

  // Subscribe to Editor events for reactivity
  useEffect(() => {
    const unsubscribes = [
      editor.on('toolChange', (tool: string) => {
        setActiveTool(tool as ToolId);
      }),
      editor.on('selectionChange', (ids: string[]) => {
        setSelectedElementIds(new Set(ids));
      }),
      editor.on('change', () => {
        forceUpdate();
      }),
      editor.on('historyChange', (payload: { canUndo: boolean; canRedo: boolean }) => {
        setCanUndo(payload.canUndo);
        setCanRedo(payload.canRedo);
      }),
    ];

    // Initialize state from editor
    setActiveTool(editor.getActiveTool() as ToolId);
    setSelectedElementIds(new Set(editor.getSelection()));
    setCanUndo(editor.canUndo());
    setCanRedo(editor.canRedo());

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [editor, forceUpdate]);

  // Query first selected element for derived style values
  const getFirstSelected = useCallback(() => {
    const ids = selectedIds();
    if (ids.length === 0) return undefined;
    return editor.getElement(ids[0]);
  }, [editor, selectedIds]);

  const strokeColor = getFirstSelected()?.strokeColor ?? '#333333';
  const fillColor = (() => {
    const el = getFirstSelected();
    if (!el) return '#e8f4fc';
    return el.backgroundColor.type === 'solid' ? el.backgroundColor.color : '#e8f4fc';
  })();
  const strokeWidth = getFirstSelected()?.strokeWidth ?? 2;
  const strokeStyle = getFirstSelected()?.strokeStyle ?? ('solid' as StrokeStyle);
  const opacity = getFirstSelected()?.opacity ?? 100;

  // Numeric input values
  const numericInputsEnabled = selectedIds().length > 0;
  const selectionBounds = editor.getSelectionBounds();
  const x = selectionBounds?.minX ?? 0;
  const y = selectionBounds?.minY ?? 0;
  const width = selectionBounds ? selectionBounds.maxX - selectionBounds.minX : 0;
  const height = selectionBounds ? selectionBounds.maxY - selectionBounds.minY : 0;
  const rotation = (() => {
    const el = getFirstSelected();
    if (!el) return 0;
    return Math.round((el.rotation * 180) / Math.PI);
  })();

  // Style mutators — all go through Editor.setStyle()
  const applyStrokeColor = useCallback(
    (color: string) => {
      editor.setStyle(selectedIds(), { strokeColor: color });
    },
    [editor, selectedIds],
  );

  const applyFillColor = useCallback(
    (color: string) => {
      const fill: FillStyle = { type: 'solid', color };
      editor.setStyle(selectedIds(), { backgroundColor: fill });
    },
    [editor, selectedIds],
  );

  const applyStrokeWidth = useCallback(
    (w: number) => {
      editor.setStyle(selectedIds(), { strokeWidth: w });
    },
    [editor, selectedIds],
  );

  const applyStrokeStyle = useCallback(
    (style: StrokeStyle) => {
      editor.setStyle(selectedIds(), { strokeStyle: style });
    },
    [editor, selectedIds],
  );

  const applyOpacity = useCallback(
    (op: number) => {
      editor.setStyle(selectedIds(), { opacity: Math.max(0, Math.min(100, op)) });
    },
    [editor, selectedIds],
  );

  // Transform mutators — each as single history entry via Editor
  const applyX = useCallback(
    (newX: number) => {
      const ids = selectedIds();
      if (ids.length === 0) return;
      const bounds = editor.getSelectionBounds();
      if (!bounds) return;
      const dx = newX - bounds.minX;
      editor.moveElements(ids, dx, 0);
    },
    [editor, selectedIds],
  );

  const applyY = useCallback(
    (newY: number) => {
      const ids = selectedIds();
      if (ids.length === 0) return;
      const bounds = editor.getSelectionBounds();
      if (!bounds) return;
      const dy = newY - bounds.minY;
      editor.moveElements(ids, 0, dy);
    },
    [editor, selectedIds],
  );

  const applyWidth = useCallback(
    (newW: number) => {
      const el = getFirstSelected();
      if (!el) return;
      editor.resizeElement(el.id, {
        x: el.x,
        y: el.y,
        width: Math.max(1, newW),
        height: el.height,
      });
    },
    [editor, getFirstSelected],
  );

  const applyHeight = useCallback(
    (newH: number) => {
      const el = getFirstSelected();
      if (!el) return;
      editor.resizeElement(el.id, {
        x: el.x,
        y: el.y,
        width: el.width,
        height: Math.max(1, newH),
      });
    },
    [editor, getFirstSelected],
  );

  const applyRotation = useCallback(
    (deg: number) => {
      const el = getFirstSelected();
      if (!el) return;
      editor.rotateElement(el.id, (deg * Math.PI) / 180);
    },
    [editor, getFirstSelected],
  );

  return {
    editor,
    activeTool,
    selectedElementIds,
    strokeColor,
    fillColor,
    strokeWidth,
    strokeStyle,
    opacity,
    x,
    y,
    width,
    height,
    rotation,
    numericInputsEnabled,
    canUndo,
    canRedo,
    applyStrokeColor,
    applyFillColor,
    applyStrokeWidth,
    applyStrokeStyle,
    applyOpacity,
    applyX,
    applyY,
    applyWidth,
    applyHeight,
    applyRotation,
    forceUpdate,
  };
}
