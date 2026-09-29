import React, { useRef, useEffect } from 'react';
import type { FazelidrawEditorProps, ToolId } from './types';
import { createEditor, type Editor } from '@fazelstudio/fazelidraw';
import { DefaultToolbar } from './components/Toolbar';
import { DefaultPropertiesPanel } from './components/PropertiesPanel';
import { useFazelidraw } from './hooks/useFazelidraw';

/**
 * Main Fazelidraw editor component.
 * All engine access goes through the Editor API — no direct Scene/internal access.
 * Pass `components.ColorPicker` to replace the default color picker, etc.
 */
export function FazelidrawEditor({
  config,
  components,
  icons,
  className,
}: FazelidrawEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  // Create Editor once (headless — no Scene/Viewport created here)
  if (!editorRef.current) {
    editorRef.current = createEditor({
      theme: config?.theme,
      enabledTools: config?.enabledTools,
      shapes: config?.shapes as never,
      canvasMode: config?.canvasMode as never,
    });
  }
  const editor = editorRef.current;

  const engine = useFazelidraw(editor);

  // Mount the editor to the DOM container
  useEffect(() => {
    if (containerRef.current && editor) {
      editor.mount(containerRef.current);
    }
    return () => {
      editor.unmount();
    };
  }, [editor]);

  const ToolbarComp = components?.Toolbar ?? DefaultToolbar;
  const PropertiesPanelComp = components?.PropertiesPanel ?? DefaultPropertiesPanel;
  const PickerComp = components?.ColorPicker;

  return (
    <div ref={containerRef} className={className} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* Canvas container — Editor mounts dual-canvas here */}

      {/* Override-aware Toolbar */}
      <ToolbarComp
        activeTool={engine.activeTool}
        onToolChange={(tool: ToolId) => editor.setActiveTool(tool)}
        enabledTools={editor.getEnabledTools()}
        icons={icons}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        onUndo={() => editor.undo()}
        onRedo={() => editor.redo()}
      />

      {/* Override-aware Properties Panel */}
      <PropertiesPanelComp
        strokeColor={engine.strokeColor}
        fillColor={engine.fillColor}
        strokeWidth={engine.strokeWidth}
        strokeStyle={engine.strokeStyle}
        opacity={engine.opacity}
        x={engine.x}
        y={engine.y}
        width={engine.width}
        height={engine.height}
        rotation={engine.rotation}
        numericInputsEnabled={engine.numericInputsEnabled}
        onStrokeColorChange={engine.applyStrokeColor}
        onFillColorChange={engine.applyFillColor}
        onStrokeWidthChange={engine.applyStrokeWidth}
        onStrokeStyleChange={engine.applyStrokeStyle}
        onOpacityChange={engine.applyOpacity}
        onXChange={engine.applyX}
        onYChange={engine.applyY}
        onWidthChange={engine.applyWidth}
        onHeightChange={engine.applyHeight}
        onRotationChange={engine.applyRotation}
        visible={true}
        onToggleVisibility={() => {}}
        ColorPicker={PickerComp}
      />

      {/* Info bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 10,
          left: 10,
          background: 'rgba(255, 255, 255, 0.9)',
          padding: '8px 12px',
          borderRadius: 5,
          boxShadow: '0 2px 5px rgba(0, 0, 0, 0.2)',
          zIndex: 100,
          fontSize: 13,
        }}
      >
        Elements: {editor.getElementCount()}
        {engine.selectedElementIds.size > 0 && ` | Selected: ${engine.selectedElementIds.size}`}
      </div>
    </div>
  );
}
