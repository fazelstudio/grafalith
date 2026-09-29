import { describe, it, expect } from 'bun:test';
import { createEditor } from './editor';

describe('Editor', () => {
  it('creates and retrieves a rectangle element', () => {
    const editor = createEditor();
    const el = editor.createElement({ type: 'rectangle', x: 10, y: 20, width: 100, height: 50 });
    expect(el.type).toBe('rectangle');
  });
});

describe('Canvas Mode', () => {
  it('defaults to infinite canvas mode', () => {
    const editor = createEditor();
    const mode = editor.getCanvasMode();
    expect(mode.type).toBe('infinite');
  });

  it('returns null bounds for infinite mode', () => {
    const editor = createEditor();
    const bounds = editor.getCanvasBounds();
    expect(bounds).toBeNull();
  });

  it('accepts bounded canvas mode config', () => {
    const editor = createEditor({
      canvasMode: { type: 'bounded', width: 1440, height: 1024 },
    });
    const mode = editor.getCanvasMode();
    expect(mode.type).toBe('bounded');
    if (mode.type === 'bounded') {
      expect(mode.width).toBe(1440);
      expect(mode.height).toBe(1024);
    }
  });

  it('returns correct bounds for bounded mode', () => {
    const editor = createEditor({
      canvasMode: { type: 'bounded', width: 1920, height: 1080 },
    });
    const bounds = editor.getCanvasBounds();
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBe(0);
    expect(bounds!.minY).toBe(0);
    expect(bounds!.maxX).toBe(1920);
    expect(bounds!.maxY).toBe(1080);
  });

  it('canvas mode is immutable after creation', () => {
    const editor = createEditor({
      canvasMode: { type: 'bounded', width: 800, height: 600 },
    });
    const mode1 = editor.getCanvasMode();
    const mode2 = editor.getCanvasMode();
    expect(mode1).toEqual(mode2);
  });

  it('works normally in infinite mode (no regression)', () => {
    const editor = createEditor();
    
    // Create elements
    const rect = editor.createElement({ type: 'rectangle', x: 100, y: 100, width: 200, height: 150 });
    expect(rect.x).toBe(100);
    expect(rect.width).toBe(200);
    
    // Selection works
    editor.select([rect.id]);
    expect(editor.getSelection()).toEqual([rect.id]);
    
    // Style works
    editor.setStyle([rect.id], { strokeColor: '#ff0000' });
    const styled = editor.getElement(rect.id);
    expect(styled?.strokeColor).toBe('#ff0000');
    
    // Viewport works
    const vp = editor.getViewport();
    expect(vp.zoom).toBe(1);
  });
});
