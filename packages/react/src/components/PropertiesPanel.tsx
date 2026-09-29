import React, { useCallback } from 'react';
import type { PropertiesPanelProps } from '../types';
import { DefaultColorPicker } from './ColorPicker';

/**
 * Default PropertiesPanel component. Shows style controls and numeric inputs for selected elements.
 * Override with a custom panel via `components.PropertiesPanel`.
 */
export const DefaultPropertiesPanel: React.FC<PropertiesPanelProps> = ({
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
  onStrokeColorChange,
  onFillColorChange,
  onStrokeWidthChange,
  onStrokeStyleChange,
  onOpacityChange,
  onXChange,
  onYChange,
  onWidthChange,
  onHeightChange,
  onRotationChange,
  visible,
  onToggleVisibility,
  ColorPicker,
}) => {
  const Picker = ColorPicker ?? DefaultColorPicker;
  const handleStrokeWidthChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onStrokeWidthChange(parseInt(e.target.value, 10));
    },
    [onStrokeWidthChange],
  );

  const handleStrokeStyleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onStrokeStyleChange(e.target.value as 'solid' | 'dashed' | 'dotted');
    },
    [onStrokeStyleChange],
  );

  const handleOpacityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onOpacityChange(parseInt(e.target.value, 10));
    },
    [onOpacityChange],
  );

  const handleNumberCommit = useCallback(
    (setter: (val: number) => void, min?: number, max?: number) =>
      (e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent<HTMLInputElement>) => {
        let val = parseFloat((e.target as HTMLInputElement).value);
        if (isNaN(val)) return;
        if (min !== undefined) val = Math.max(min, val);
        if (max !== undefined) val = Math.min(max, val);
        setter(val);
      },
    [],
  );

  // Commit-on-Enter is handled by blurring, which triggers the onBlur commit above.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      }
    },
    [],
  );

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '4px 6px',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 12,
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    fontWeight: 500,
    marginBottom: 2,
    color: '#555',
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    marginBottom: 8,
  };

  return (
    <>
      <button
        onClick={onToggleVisibility}
        style={{
          position: 'fixed',
          top: 60,
          right: 10,
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '8px 12px',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
          zIndex: 100,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          border: 'none',
        }}
      >
        {visible ? 'Hide Style' : 'Style'}
      </button>
      {visible && (
        <div
          style={{
            position: 'fixed',
            top: 100,
            right: 10,
            background: 'rgba(255, 255, 255, 0.95)',
            padding: 12,
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            zIndex: 100,
            width: 220,
            maxHeight: 'calc(100vh - 120px)',
            overflowY: 'auto',
          }}
        >
          {/* Numeric Inputs Section */}
          {numericInputsEnabled && (
            <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #eee' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#333', marginBottom: 8 }}>Transform</div>
              <div style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>X</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={Math.round(x)}
                    onBlur={handleNumberCommit(onXChange)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Y</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={Math.round(y)}
                    onBlur={handleNumberCommit(onYChange)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>
              <div style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>W</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={Math.round(width)}
                    min={1}
                    onBlur={handleNumberCommit(onWidthChange, 1)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>H</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={Math.round(height)}
                    min={1}
                    onBlur={handleNumberCommit(onHeightChange, 1)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>
              <div style={rowStyle}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Rotation (deg)</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={Math.round(rotation)}
                    onBlur={handleNumberCommit(onRotationChange)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Style Section */}
          <Picker value={strokeColor} onChange={onStrokeColorChange} label="Stroke Color" />
          <Picker value={fillColor} onChange={onFillColorChange} label="Fill Color" />

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#555' }}>
              Stroke Width
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="range"
                min={1}
                max={20}
                value={strokeWidth}
                onChange={handleStrokeWidthChange}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 11, color: '#777', minWidth: 30, textAlign: 'right' }}>
                {strokeWidth}px
              </span>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#555' }}>
              Stroke Style
            </label>
            <select
              value={strokeStyle}
              onChange={handleStrokeStyleChange}
              style={{ width: '100%', padding: 4, border: '1px solid #ccc', borderRadius: 4 }}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#555' }}>
              Opacity
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="range"
                min={0}
                max={100}
                value={opacity}
                onChange={handleOpacityChange}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 11, color: '#777', minWidth: 30, textAlign: 'right' }}>
                {opacity}%
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
