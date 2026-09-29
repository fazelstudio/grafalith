import { describe, it, expect } from 'bun:test';
import { createEditor } from './editor';

describe('Editor', () => {
  // ─── CRUD ────────────────────────────────────────────────────

  describe('createElement / getElement / getAllElements', () => {
    it('creates and retrieves a rectangle element', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle', x: 10, y: 20, width: 100, height: 50 });

      expect(el.type).toBe('rectangle');
      expect(el.x).toBe(10);
      expect(el.y).toBe(20);
      expect(editor.getElement(el.id)).toBeDefined();
      expect(editor.getAllElements()).toHaveLength(1);
    });

    it('creates different element types', () => {
      const editor = createEditor();
      const rect = editor.createElement({ type: 'rectangle' });
      const ellipse = editor.createElement({ type: 'ellipse' });
      const line = editor.createElement({ type: 'line' });
      const arrow = editor.createElement({ type: 'arrow' });
      const text = editor.createElement({ type: 'text' });
      const freedraw = editor.createElement({ type: 'freedraw' });
      const frame = editor.createElement({ type: 'frame' });
      const image = editor.createElement({ type: 'image' });

      expect(rect.type).toBe('rectangle');
      expect(ellipse.type).toBe('ellipse');
      expect(line.type).toBe('line');
      expect(arrow.type).toBe('arrow');
      expect(text.type).toBe('text');
      expect(freedraw.type).toBe('freedraw');
      expect(frame.type).toBe('frame');
      expect(image.type).toBe('image');
      expect(editor.getAllElements()).toHaveLength(8);
    });
  });

  describe('updateElement', () => {
    it('updates element properties', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle', x: 0, y: 0 });

      editor.updateElement(el.id, { x: 50, y: 60 });

      const updated = editor.getElement(el.id)!;
      expect(updated.x).toBe(50);
      expect(updated.y).toBe(60);
      expect(updated.version).toBe(el.version + 1);
    });

    it('does nothing for non-existent id', () => {
      const editor = createEditor();
      editor.updateElement('nonexistent', { x: 99 });
      expect(editor.getAllElements()).toHaveLength(0);
    });
  });

  describe('deleteElement', () => {
    it('soft-deletes an element', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle' });
      expect(editor.getAllElements()).toHaveLength(1);

      editor.deleteElement(el.id);
      expect(editor.getAllElements()).toHaveLength(0);
      expect(editor.getElement(el.id)).toBeUndefined();
    });
  });

  // ─── Selection ──────────────────────────────────────────────

  describe('Selection', () => {
    it('select and getSelection', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle' });
      const b = editor.createElement({ type: 'ellipse' });

      editor.select([a.id, b.id]);
      expect(editor.getSelection()).toEqual([a.id, b.id]);
    });

    it('clearSelection', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle' });
      editor.select([a.id]);
      editor.clearSelection();
      expect(editor.getSelection()).toHaveLength(0);
    });

    it('toggleSelect', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle' });
      editor.toggleSelect(a.id);
      expect(editor.getSelection()).toEqual([a.id]);
      editor.toggleSelect(a.id);
      expect(editor.getSelection()).toHaveLength(0);
    });
  });

  // ─── Active Tool ────────────────────────────────────────────

  describe('Active Tool', () => {
    it('defaults to select', () => {
      const editor = createEditor();
      expect(editor.getActiveTool()).toBe('select');
    });

    it('setActiveTool and getActiveTool', () => {
      const editor = createEditor();
      editor.setActiveTool('rectangle');
      expect(editor.getActiveTool()).toBe('rectangle');
    });

    it('rejects tools not in enabledTools', () => {
      const editor = createEditor({ enabledTools: ['select', 'rectangle'] });
      editor.setActiveTool('rectangle');
      expect(editor.getActiveTool()).toBe('rectangle');

      editor.setActiveTool('ellipse'); // not enabled
      expect(editor.getActiveTool()).toBe('rectangle'); // unchanged
    });
  });

  // ─── History ────────────────────────────────────────────────

  describe('History (undo/redo)', () => {
    it('undo and redo after creating element', () => {
      const editor = createEditor();
      expect(editor.canUndo()).toBe(false);

      editor.createElement({ type: 'rectangle' });
      expect(editor.canUndo()).toBe(true);

      editor.undo();
      expect(editor.getAllElements()).toHaveLength(0);

      editor.redo();
      expect(editor.getAllElements()).toHaveLength(1);
    });

    it('undo and redo after updating element', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle', x: 0 });

      editor.updateElement(el.id, { x: 100 });
      expect(editor.getElement(el.id)!.x).toBe(100);

      editor.undo();
      expect(editor.getElement(el.id)!.x).toBe(0);
    });
  });

  // ─── Style ──────────────────────────────────────────────────

  describe('Style', () => {
    it('setStrokeColor', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle' });
      editor.setStyle([el.id], { strokeColor: '#ff0000' });
      expect(editor.getElement(el.id)!.strokeColor).toBe('#ff0000');
    });

    it('setOpacity', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle' });
      editor.setStyle([el.id], { opacity: 50 });
      expect(editor.getElement(el.id)!.opacity).toBe(50);
    });

    it('setStrokeWidth', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle' });
      editor.setStyle([el.id], { strokeWidth: 5 });
      expect(editor.getElement(el.id)!.strokeWidth).toBe(5);
    });
  });

  // ─── Layering ──────────────────────────────────────────────

  describe('Layering', () => {
    it('bringToFront changes z-order', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle' });
      const b = editor.createElement({ type: 'ellipse' });
      expect(editor.getAllElements().map((e) => e.id)).toEqual([a.id, b.id]);

      editor.bringToFront([a.id]);
      expect(editor.getAllElements().map((e) => e.id)).toEqual([b.id, a.id]);
    });

    it('sendToBack changes z-order', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle' });
      const b = editor.createElement({ type: 'ellipse' });

      editor.sendToBack([b.id]);
      expect(editor.getAllElements().map((e) => e.id)).toEqual([b.id, a.id]);
    });
  });

  // ─── Lock ──────────────────────────────────────────────────

  describe('Lock', () => {
    it('lock and unlock elements', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle' });

      editor.lock([el.id]);
      expect(editor.getElement(el.id)!.locked).toBe(true);

      editor.unlock([el.id]);
      expect(editor.getElement(el.id)!.locked).toBe(false);
    });

    it('toggleLock', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle' });

      editor.toggleLock([el.id]);
      expect(editor.getElement(el.id)!.locked).toBe(true);

      editor.toggleLock([el.id]);
      expect(editor.getElement(el.id)!.locked).toBe(false);
    });
  });

  // ─── Grouping ──────────────────────────────────────────────

  describe('Grouping', () => {
    it('group and ungroup', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle' });
      const b = editor.createElement({ type: 'ellipse' });

      const groupId = editor.group([a.id, b.id]);
      expect(groupId).toBeTruthy();
      expect(editor.getGroupMembers(a.id)).toEqual([a.id, b.id]);
      expect(editor.getOutermostGroupId(a.id)).toBe(groupId);

      editor.ungroup(groupId);
      expect(editor.getOutermostGroupId(a.id)).toBeNull();
    });
  });

  // ─── Alignment ─────────────────────────────────────────────

  describe('Alignment', () => {
    it('alignLeft aligns to leftmost', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle', x: 100, width: 50 });
      const b = editor.createElement({ type: 'rectangle', x: 200, width: 50 });

      editor.alignLeft([a.id, b.id]);
      expect(editor.getElement(a.id)!.x).toBe(100);
      expect(editor.getElement(b.id)!.x).toBe(100);
    });

    it('alignRight aligns to rightmost', () => {
      const editor = createEditor();
      const a = editor.createElement({ type: 'rectangle', x: 100, width: 50 });
      const b = editor.createElement({ type: 'rectangle', x: 200, width: 80 });

      editor.alignRight([a.id, b.id]);
      // Rightmost edge = 200 + 80 = 280
      // a.x = 280 - 50 = 230
      expect(editor.getElement(a.id)!.x).toBe(230);
      expect(editor.getElement(b.id)!.x).toBe(200);
    });
  });

  // ─── Viewport ──────────────────────────────────────────────

  describe('Viewport', () => {
    it('getViewport returns current viewport', () => {
      const editor = createEditor();
      const vp = editor.getViewport();
      expect(vp.scrollX).toBe(0);
      expect(vp.scrollY).toBe(0);
      expect(vp.zoom).toBe(1);
    });

    it('pan updates viewport', () => {
      const editor = createEditor();
      editor.pan(100, 50);
      const vp = editor.getViewport();
      expect(vp.scrollX).toBeCloseTo(100);
      expect(vp.scrollY).toBeCloseTo(50);
    });
  });

  // ─── Event System ──────────────────────────────────────────

  describe('Event System', () => {
    it('on() returns unsubscribe function', () => {
      const editor = createEditor();
      let callCount = 0;
      const unsub = editor.on('change', () => { callCount++; });

      editor.createElement({ type: 'rectangle' });
      expect(callCount).toBe(1);

      unsub();
      editor.createElement({ type: 'ellipse' });
      expect(callCount).toBe(1); // not called after unsubscribe
    });

    it('emits selectionChange on select()', () => {
      const editor = createEditor();
      let received: string[] = [];
      editor.on('selectionChange', (ids) => { received = ids; });

      const el = editor.createElement({ type: 'rectangle' });
      editor.select([el.id]);
      expect(received).toEqual([el.id]);
    });

    it('emits toolChange on setActiveTool()', () => {
      const editor = createEditor();
      let received = '';
      editor.on('toolChange', (tool) => { received = tool; });

      editor.setActiveTool('rectangle');
      expect(received).toBe('rectangle');
    });

    it('emits historyChange on undo/redo', () => {
      const editor = createEditor();
      let lastPayload: { canUndo: boolean; canRedo: boolean } | null = null;
      editor.on('historyChange', (p) => { lastPayload = p; });

      editor.createElement({ type: 'rectangle' });
      editor.undo();
      expect(lastPayload).toEqual({ canUndo: false, canRedo: true });
    });

    it('emits viewportChange on pan()', () => {
      const editor = createEditor();
      let received: { scrollX: number; scrollY: number; zoom: number } | null = null;
      editor.on('viewportChange', (vp) => { received = vp; });

      editor.pan(50, 30);
      expect(received).not.toBeNull();
      expect(received!.scrollX).toBeCloseTo(50);
      expect(received!.scrollY).toBeCloseTo(30);
      expect(received!.zoom).toBe(1);
    });
  });

  // ─── Transform ─────────────────────────────────────────────

  describe('Transform', () => {
    it('moveElements shifts element position', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle', x: 100, y: 100 });

      editor.moveElements([el.id], 50, 30);
      expect(editor.getElement(el.id)!.x).toBe(150);
      expect(editor.getElement(el.id)!.y).toBe(130);
    });

    it('moveElements skips locked elements', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle', x: 100, y: 100 });
      editor.lock([el.id]);

      editor.moveElements([el.id], 50, 30);
      expect(editor.getElement(el.id)!.x).toBe(100);
    });

    it('resizeElement changes bounds', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle', x: 0, y: 0, width: 100, height: 100 });

      editor.resizeElement(el.id, { x: 10, y: 20, width: 200, height: 150 });
      const updated = editor.getElement(el.id)!;
      expect(updated.x).toBe(10);
      expect(updated.y).toBe(20);
      expect(updated.width).toBe(200);
      expect(updated.height).toBe(150);
    });

    it('rotateElement changes rotation', () => {
      const editor = createEditor();
      const el = editor.createElement({ type: 'rectangle', rotation: 0 });

      editor.rotateElement(el.id, Math.PI / 4);
      expect(editor.getElement(el.id)!.rotation).toBe(Math.PI / 4);
    });
  });

  // ─── Export / Import ───────────────────────────────────────

  describe('Export / Import', () => {
    it('exportToJSON and importFromJSON round-trip', () => {
      const editor = createEditor();
      editor.createElement({ type: 'rectangle', x: 10, y: 20 });
      editor.createElement({ type: 'ellipse', x: 50, y: 60 });

      const json = editor.exportToJSON();
      expect(json).toBeTruthy();

      const editor2 = createEditor();
      editor2.importFromJSON(json);
      expect(editor2.getAllElements()).toHaveLength(2);
    });
  });

  // ─── Frames ────────────────────────────────────────────────

  describe('Frames', () => {
    it('getFrameChildren returns empty for frame with no children', () => {
      const editor = createEditor();
      const frame = editor.createElement({ type: 'frame' });
      expect(editor.getFrameChildren(frame.id)).toHaveLength(0);
    });

    it('autoAssignToFrames assigns element to frame', () => {
      const editor = createEditor();
      const frame = editor.createElement({ type: 'frame', x: 0, y: 0, width: 500, height: 500 });
      const rect = editor.createElement({ type: 'rectangle', x: 10, y: 10, width: 50, height: 50 });

      editor.autoAssignToFrames([rect.id]);
      expect(editor.getFrameChildren(frame.id)).toContain(rect.id);
    });
  });
});
