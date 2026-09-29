import React, { useCallback } from 'react';
import type { ColorPickerProps } from '../types';

const DEFAULT_PRESETS = [
  '#ffffff', '#f28b82', '#fbbc04', '#fff475',
  '#ccff90', '#a7ffeb', '#cbf0f8', '#aecbfa',
  '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed',
  '#333333', '#ff0000', '#00ff00', '#0000ff',
];

/**
 * Default ColorPicker component. Renders a native HTML color input
 * with optional preset swatches. Override with a richer picker
 * (e.g. react-colorful) via `components.ColorPicker`.
 */
export const DefaultColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  label,
  presets = DEFAULT_PRESETS,
}) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4, color: '#555' }}>
          {label}
        </label>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={value}
          onChange={handleChange}
          style={{ width: 32, height: 32, border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer', padding: 0 }}
        />
        <span style={{ fontSize: 12, color: '#777' }}>{value}</span>
      </div>
      {presets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {presets.map((color) => (
            <button
              key={color}
              onClick={() => onChange(color)}
              title={color}
              style={{
                width: 20,
                height: 20,
                borderRadius: 3,
                border: value === color ? '2px solid #333' : '1px solid #ccc',
                background: color,
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
