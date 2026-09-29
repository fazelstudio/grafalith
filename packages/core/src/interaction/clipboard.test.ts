import { describe, it, expect, beforeEach } from 'bun:test';
import { Scene } from '../scene/scene';
import { HistoryManager } from '../history/history-manager';
import {
  copyElements,
  pasteElements,
  duplicateElements,
  cutElements,
  clearClipboardBuffer,
} from './clipboard';
import { createRectangle, createArrow } from '../scene/create-element';
import { ArrowElement } from '../scene/types';

describe('Clipboard', () => {
  let scene: Scene;
  let history: HistoryManager;

  beforeEach(() => {
    scene = new Scene();
    history = new HistoryManager(scene);
    clearClipboardBuffer();
  });

  // ─── Basic copy/paste ─────────────────────────────────────────

  describe('copy + paste single element', () => {
    it('should create a new element with different id and offset position', () => {
      const rect = createRectangle({ id: 'r1', x: 100, y: 200 });
      scene.upsertElement(rect);

      const copied = copyElements(scene, ['r1']);
      expect(copied.length).toBe(1);

      const pasted = pasteElements(scene, history);
      expect(pasted.length).toBe(1);

      // New element exists in scene
      const allElements = scene.getAllElements();
      expect(allElements.length).toBe(2);

      // IDs are different
      const ids = allElements.map((el) => el.id);
      expect(ids[0]).not.toBe(ids[1]);

      // Pasted element is offset from original
      const pastedEl = pasted[0];
      expect(pastedEl.x).toBe(100 + 10); // PASTE_OFFSET = 10
      expect(pastedEl.y).toBe(200 + 10);
    });

    it('should record paste as a single undo entry', () => {
      const rect = createRectangle({ id: 'r1', x: 0, y: 0 });
      scene.upsertElement(rect);

      copyElements(scene, ['r1']);
      pasteElements(scene, history);

      expect(history.getUndoStackSize()).toBe(2); // create + paste

      // Undo paste — element removed
      history.undo();
      expect(scene.getAllElements().length).toBe(1);
    });
  });

  describe('copy + paste multi-select', () => {
    it('should preserve relative positions', () => {
      const r1 = createRectangle({ id: 'r1', x: 0, y: 0, width: 50 });
      const r2 = createRectangle({ id: 'r2', x: 100, y: 50, width: 50 });
      scene.upsertElement(r1);
      scene.upsertElement(r2);

      copyElements(scene, ['r1', 'r2']);
      const pasted = pasteElements(scene, history);

      expect(pasted.length).toBe(2);

      // Relative positions preserved: r2 is at (100,50), r1 at (0,0) → diff = (100,50)
      const pastedR1 = pasted.find((el) => el.id !== pasted[0].id || el === pasted[0])!;
      const pastedR2 = pasted.find((el) => el !== pastedR1)!;
      const dx = pastedR2.x - pastedR1.x;
      const dy = pastedR2.y - pastedR1.y;
      expect(dx).toBe(100);
      expect(dy).toBe(50);
    });
  });

  // ─── Duplicate ────────────────────────────────────────────────

  describe('duplicate', () => {
    it('should work without system clipboard', () => {
      const rect = createRectangle({ id: 'r1', x: 0, y: 0 });
      scene.upsertElement(rect);

      const duplicated = duplicateElements(scene, history, ['r1']);
      expect(duplicated.length).toBe(1);
      expect(scene.getAllElements().length).toBe(2);
      expect(duplicated[0].id).not.toBe('r1');
    });
  });

  // ─── Cut ──────────────────────────────────────────────────────

  describe('cut', () => {
    it('should soft-delete originals after copying', () => {
      const rect = createRectangle({ id: 'r1', x: 0, y: 0 });
      scene.upsertElement(rect);

      cutElements(scene, history, ['r1']);

      // Original is soft-deleted
      const el = scene.getElement('r1');
      expect(el).toBeDefined();
      expect(el!.isDeleted).toBe(true);

      // Visible count is 0
      expect(scene.getAllElements().length).toBe(0);

      // Can undo the cut
      history.undo();
      expect(scene.getElement('r1')!.isDeleted).toBe(false);
    });
  });

  // ─── Arrow binding scenarios ──────────────────────────────────

  describe('arrow binding: both arrow + target in selection', () => {
    it('should remap binding to new element IDs', () => {
      const rect1 = createRectangle({ id: 'rect1', x: 0, y: 0 });
      const rect2 = createRectangle({ id: 'rect2', x: 200, y: 0 });
      const arrow = createArrow({
        id: 'arrow1',
        startBinding: { elementId: 'rect1', focus: 0, gap: 5 },
        endBinding: { elementId: 'rect2', focus: 0, gap: 5 },
      });

      scene.upsertElement(rect1);
      scene.upsertElement(rect2);
      scene.upsertElement(arrow);

      // Copy all three together
      copyElements(scene, ['rect1', 'rect2', 'arrow1']);
      const pasted = pasteElements(scene, history);

      expect(pasted.length).toBe(3);

      // Find the pasted arrow
      const pastedArrow = pasted.find((el) => el.type === 'arrow') as ArrowElement;
      expect(pastedArrow).toBeDefined();

      // Find the pasted rectangles
      const pastedRects = pasted.filter((el) => el.type === 'rectangle');

      // Build id map: old rect IDs → new rect IDs
      const rectIdMap = new Map<string, string>();
      rectIdMap.set('rect1', pastedRects[0].id);
      rectIdMap.set('rect2', pastedRects[1].id);

      // Bindings should point to the NEW rect IDs
      expect(pastedArrow.startBinding).not.toBeNull();
      expect(pastedArrow.endBinding).not.toBeNull();
      expect(pastedArrow.startBinding!.elementId).toBe(pastedRects[0].id);
      expect(pastedArrow.endBinding!.elementId).toBe(pastedRects[1].id);

      // Bindings should NOT reference old IDs
      expect(pastedArrow.startBinding!.elementId).not.toBe('rect1');
      expect(pastedArrow.endBinding!.elementId).not.toBe('rect2');
    });
  });

  describe('arrow binding: arrow in selection, target NOT', () => {
    it('should null out binding to non-selected target', () => {
      const rect1 = createRectangle({ id: 'rect1', x: 0, y: 0 });
      const rect2 = createRectangle({ id: 'rect2', x: 200, y: 0 });
      const arrow = createArrow({
        id: 'arrow1',
        startBinding: { elementId: 'rect1', focus: 0, gap: 5 },
        endBinding: { elementId: 'rect2', focus: 0, gap: 5 },
      });

      scene.upsertElement(rect1);
      scene.upsertElement(rect2);
      scene.upsertElement(arrow);

      // Copy only the arrow (rects NOT in selection)
      copyElements(scene, ['arrow1']);
      const pasted = pasteElements(scene, history);

      expect(pasted.length).toBe(1);

      const pastedArrow = pasted[0] as ArrowElement;
      expect(pastedArrow.type).toBe('arrow');

      // Both bindings should be nulled — targets were not in the copy
      expect(pastedArrow.startBinding).toBeNull();
      expect(pastedArrow.endBinding).toBeNull();
    });

    it('should null only the binding whose target is not selected', () => {
      const rect1 = createRectangle({ id: 'rect1', x: 0, y: 0 });
      const rect2 = createRectangle({ id: 'rect2', x: 200, y: 0 });
      const arrow = createArrow({
        id: 'arrow1',
        startBinding: { elementId: 'rect1', focus: 0, gap: 5 },
        endBinding: { elementId: 'rect2', focus: 0, gap: 5 },
      });

      scene.upsertElement(rect1);
      scene.upsertElement(rect2);
      scene.upsertElement(arrow);

      // Copy arrow + rect1 only (rect2 NOT selected)
      copyElements(scene, ['arrow1', 'rect1']);
      const pasted = pasteElements(scene, history);

      expect(pasted.length).toBe(2);

      const pastedArrow = pasted.find((el) => el.type === 'arrow') as ArrowElement;
      const pastedRect = pasted.find((el) => el.type === 'rectangle')!;

      // startBinding (to rect1) should be remapped to pasted rect
      expect(pastedArrow.startBinding).not.toBeNull();
      expect(pastedArrow.startBinding!.elementId).toBe(pastedRect.id);

      // endBinding (to rect2, which was NOT selected) should be nulled
      expect(pastedArrow.endBinding).toBeNull();
    });
  });

  // ─── Undo/redo integration ────────────────────────────────────

  describe('undo/redo integration', () => {
    it('should undo paste and restore scene', () => {
      const rect = createRectangle({ id: 'r1', x: 0 });
      scene.upsertElement(rect);

      copyElements(scene, ['r1']);
      pasteElements(scene, history);

      expect(scene.getAllElements().length).toBe(2);

      history.undo(); // undo paste
      expect(scene.getAllElements().length).toBe(1);

      history.redo(); // redo paste
      expect(scene.getAllElements().length).toBe(2);
    });

    it('should undo cut and restore deleted elements', () => {
      const rect = createRectangle({ id: 'r1', x: 0 });
      scene.upsertElement(rect);

      cutElements(scene, history, ['r1']);
      expect(scene.getElement('r1')!.isDeleted).toBe(true);

      history.undo(); // undo cut
      expect(scene.getElement('r1')!.isDeleted).toBe(false);
    });
  });
});
