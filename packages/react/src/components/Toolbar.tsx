import React, { useCallback } from 'react';
import type { ToolbarProps, ToolId, IconName } from '../types';
import { getIcon } from '../icons';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'line', label: 'Line' },
  { id: 'freedraw', label: 'Freedraw' },
  { id: 'text', label: 'Text' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'pan', label: 'Pan' },
];

/**
 * Default Toolbar component. Renders a horizontal bar with tool buttons.
 * Override with a custom toolbar via `components.Toolbar`.
 */
export const DefaultToolbar: React.FC<ToolbarProps> = ({
  activeTool,
  onToolChange,
  enabledTools,
  icons,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
}) => {
  const handleToolClick = useCallback(
    (tool: ToolId) => () => onToolChange(tool),
    [onToolChange],
  );

  const visibleTools = enabledTools ? TOOLS.filter((t) => enabledTools.includes(t.id)) : TOOLS;
  const resolveIcon = (name: IconName): React.ComponentType<{ size?: number }> => icons?.[name] ?? getIcon(name);
  const UndoIcon = resolveIcon('undo');
  const RedoIcon = resolveIcon('redo');

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255, 255, 255, 0.95)',
        padding: '8px 12px',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        zIndex: 100,
        display: 'flex',
        gap: 6,
        alignItems: 'center',
      }}
    >
      {visibleTools.map((tool, i) => {
        const Icon = resolveIcon(tool.id as IconName);
        return (
          <React.Fragment key={tool.id}>
            {i === visibleTools.length - 1 && <span style={{ borderLeft: '1px solid #ddd', margin: '0 4px' }} />}
            <button
              onClick={handleToolClick(tool.id)}
              title={tool.label}
              style={{
                padding: '6px 10px',
                border: activeTool === tool.id ? '2px solid #4a90d9' : '2px solid transparent',
                borderRadius: 6,
                background: activeTool === tool.id ? '#e8f0fe' : '#f0f0f0',
                color: activeTool === tool.id ? '#1a5dab' : undefined,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
            >
              <Icon size={18} />
            </button>
          </React.Fragment>
        );
      })}
      <span style={{ borderLeft: '1px solid #ddd', margin: '0 4px' }} />
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        style={{
          padding: '6px 10px',
          border: '2px solid transparent',
          borderRadius: 6,
          background: '#f0f0f0',
          cursor: canUndo ? 'pointer' : 'default',
          opacity: canUndo ? 1 : 0.4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <UndoIcon size={18} />
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        style={{
          padding: '6px 10px',
          border: '2px solid transparent',
          borderRadius: 6,
          background: '#f0f0f0',
          cursor: canRedo ? 'pointer' : 'default',
          opacity: canRedo ? 1 : 0.4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <RedoIcon size={18} />
      </button>
    </div>
  );
};
