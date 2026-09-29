import { describe, it, expect, beforeEach } from 'bun:test';
import { Scene } from '../scene/scene';
import { HistoryManager } from './history-manager';
import { createRectangle } from '../scene/create-element';

describe('HistoryManager', () => {
  let scene: Scene;
  let history: HistoryManager;

  beforeEach(() => {
    scene = new Scene();
    history = new HistoryManager(scene);
  });

  describe('basic undo/redo', () => {
    it('should undo a single element creation', () => {
      const rect = createRectangle({ id: 'r1', x: 10, y: 20 });
      scene.upsertElement(rect);

      expect(scene.getElement('r1')).toBeDefined();
      expect(scene.getElement('r1')!.x).toBe(10);

      const undone = history.undo();
      expect(undone).toBe(true);
      // After undo, element should be removed (was newly created)
      expect(scene.getElement('r1')).toBeUndefined();
    });

    it('should redo after undo', () => {
      const rect = createRectangle({ id: 'r1', x: 10, y: 20 });
      scene.upsertElement(rect);

      history.undo();
      expect(scene.getElement('r1')).toBeUndefined();

      const redone = history.redo();
      expect(redone).toBe(true);
      expect(scene.getElement('r1')).toBeDefined();
      expect(scene.getElement('r1')!.x).toBe(10);
    });

    it('should undo a move operation', () => {
      const rect = createRectangle({ id: 'r1', x: 10, y: 20 });
      scene.upsertElement(rect);

      // Simulate move
      scene.upsertElement({ ...rect, x: 50, y: 60, version: rect.version + 1 });
      expect(scene.getElement('r1')!.x).toBe(50);

      history.undo();
      expect(scene.getElement('r1')!.x).toBe(10);
      expect(scene.getElement('r1')!.y).toBe(20);
    });

    it('should undo a delete operation', () => {
      const rect = createRectangle({ id: 'r1', x: 10, y: 20 });
      scene.upsertElement(rect);

      scene.deleteElement('r1');
      expect(scene.getElement('r1')!.isDeleted).toBe(true);

      history.undo();
      expect(scene.getElement('r1')!.isDeleted).toBe(false);
    });

    it('should undo style changes', () => {
      const rect = createRectangle({ id: 'r1', strokeColor: '#000000' });
      scene.upsertElement(rect);

      scene.upsertElement({ ...rect, strokeColor: '#ff0000', version: rect.version + 1 });
      expect(scene.getElement('r1')!.strokeColor).toBe('#ff0000');

      history.undo();
      expect(scene.getElement('r1')!.strokeColor).toBe('#000000');
    });
  });

  describe('batching (one drag = one entry)', () => {
    it('should collapse multiple mutations into one undo step via batch', () => {
      const rect = createRectangle({ id: 'r1', x: 0, y: 0 });
      scene.upsertElement(rect);

      history.startBatch();

      // Simulate drag: multiple small moves
      scene.upsertElement({ ...rect, x: 1, y: 0, version: 1 });
      scene.upsertElement({ ...rect, x: 2, y: 0, version: 2 });
      scene.upsertElement({ ...rect, x: 3, y: 0, version: 3 });
      scene.upsertElement({ ...rect, x: 4, y: 0, version: 4 });
      scene.upsertElement({ ...rect, x: 5, y: 0, version: 5 });

      history.endBatch();

      // Two entries: creation (outside batch) + batch of moves
      expect(history.getUndoStackSize()).toBe(2);
      expect(scene.getElement('r1')!.x).toBe(5);

      // Undo batch: revert all moves, back to x=0
      history.undo();
      expect(history.getUndoStackSize()).toBe(1);
      expect(scene.getElement('r1')!.x).toBe(0);
    });

    it('should collapse create + multiple updates into one undo step', () => {
      history.startBatch();

      const rect = createRectangle({ id: 'r1', x: 0, y: 0 });
      scene.upsertElement(rect);
      scene.upsertElement({ ...rect, x: 10, y: 10, version: 1 });
      scene.upsertElement({ ...rect, x: 20, y: 20, version: 2 });

      history.endBatch();

      expect(history.getUndoStackSize()).toBe(1);
      history.undo();
      // New element should be removed entirely
      expect(scene.getElement('r1')).toBeUndefined();
    });

    it('should auto-commit empty batch without pushing entry', () => {
      history.startBatch();
      history.endBatch();
      expect(history.getUndoStackSize()).toBe(0);
    });

    it('should auto-commit mid-batch on undo', () => {
      const rect = createRectangle({ id: 'r1', x: 0, y: 0 });
      scene.upsertElement(rect);

      history.startBatch();
      scene.upsertElement({ ...rect, x: 10, y: 0, version: 1 });

      // Undo while batch is open — should commit batch first, then undo it
      history.undo();
      expect(scene.getElement('r1')!.x).toBe(0);
      // Creation entry remains (1), batch was committed then undone
      expect(history.getUndoStackSize()).toBe(1);
    });
  });

  describe('redo stack cleared on new action', () => {
    it('should clear redo stack when a new mutation happens after undo', () => {
      const rect = createRectangle({ id: 'r1', x: 0 });
      scene.upsertElement(rect);

      scene.upsertElement({ ...rect, x: 10, version: 1 });
      history.undo();

      expect(history.canRedo()).toBe(true);

      // New action should clear redo
      scene.upsertElement({ ...rect, x: 20, version: 2 });
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('stack limit', () => {
    it('should enforce max stack size', () => {
      const limited = new HistoryManager(scene, 3);

      for (let i = 0; i < 5; i++) {
        const rect = createRectangle({ id: `r${i}`, x: i * 10 });
        scene.upsertElement(rect);
      }

      // Only last 3 entries should remain
      expect(limited.getUndoStackSize()).toBe(3);
    });
  });

  describe('consecutive undo', () => {
    it('should undo multiple entries in sequence', () => {
      const r1 = createRectangle({ id: 'r1', x: 0 });
      const r2 = createRectangle({ id: 'r2', x: 0 });
      scene.upsertElement(r1);
      scene.upsertElement(r2);

      scene.upsertElement({ ...r1, x: 10, version: 1 });
      scene.upsertElement({ ...r2, x: 20, version: 1 });

      history.undo(); // undo r2 move
      expect(scene.getElement('r2')!.x).toBe(0);

      history.undo(); // undo r1 move
      expect(scene.getElement('r1')!.x).toBe(0);
    });
  });

  describe('canUndo / canRedo', () => {
    it('should return false when stacks are empty', () => {
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });

    it('should return true after mutation', () => {
      const rect = createRectangle({ id: 'r1' });
      scene.upsertElement(rect);
      expect(history.canUndo()).toBe(true);
    });

    it('redo should become available after undo', () => {
      const rect = createRectangle({ id: 'r1' });
      scene.upsertElement(rect);
      history.undo();
      expect(history.canRedo()).toBe(true);
    });
  });

  describe('destroy', () => {
    it('should stop recording after destroy', () => {
      const rect = createRectangle({ id: 'r1', x: 0 });
      scene.upsertElement(rect);

      history.destroy();

      scene.upsertElement({ ...rect, x: 10, version: 1 });
      expect(history.getUndoStackSize()).toBe(1); // only the first entry
    });
  });

  describe('recordEntry (manual)', () => {
    it('should allow manually pushing an entry and undoing it', () => {
      const rect = createRectangle({ id: 'r1', x: 0 });
      scene.upsertElement(rect);

      const updatedRect = { ...rect, x: 100, version: rect.version + 1 };
      history.recordEntry({
        elementUpdates: new Map([
          ['r1', { before: rect, after: updatedRect }],
        ]),
      });

      expect(history.getUndoStackSize()).toBe(2); // auto entry + manual
      history.undo(); // undo manual entry
      expect(scene.getElement('r1')!.x).toBe(0);
    });
  });
});
