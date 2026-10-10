import { describe, expect, test } from 'bun:test';
import { cursorForResizeHandle, ROTATE_CURSOR, selectionHandleCursor } from './cursors';
import type { RenderModelDto } from '../hooks/useEngine';

const viewport = { scrollX: 0, scrollY: 0, zoom: 1 };

function modelWithBox(minX: number, minY: number, maxX: number, maxY: number): RenderModelDto {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    base: [],
    frames: [],
    selection: {
      bounds: { minX, minY, maxX, maxY },
      handles: [
        [minX, minY],
        [cx, minY],
        [maxX, minY],
        [minX, cy],
        [maxX, cy],
        [minX, maxY],
        [cx, maxY],
        [maxX, maxY],
      ],
      rotateHandle: [cx, minY - 24],
      rotation: 0,
    },
    snapGuides: [],
    textEditing: null,
    viewport,
    assetGeneration: 0,
  };
}

describe('selection handle cursors', () => {
  const model = modelWithBox(100, 100, 200, 200);

  test('direction follows the handle', () => {
    expect(selectionHandleCursor(model, viewport, [100, 100], false)).toBe(
      'var(--cursor-nwse-resize)',
    );
    expect(selectionHandleCursor(model, viewport, [150, 100], false)).toBe(
      'var(--cursor-ns-resize)',
    );
    expect(selectionHandleCursor(model, viewport, [200, 100], false)).toBe(
      'var(--cursor-nesw-resize)',
    );
    expect(selectionHandleCursor(model, viewport, [100, 150], false)).toBe(
      'var(--cursor-ew-resize)',
    );
  });

  test('empty space and missing selection resolve to null', () => {
    expect(selectionHandleCursor(model, viewport, [0, 0], false)).toBeNull();
    expect(
      selectionHandleCursor({ ...model, selection: null }, viewport, [100, 100], false),
    ).toBeNull();
  });

  test('lone text keeps cursors on corners only', () => {
    expect(selectionHandleCursor(model, viewport, [200, 200], true)).toBe(
      'var(--cursor-nwse-resize)',
    );
    expect(selectionHandleCursor(model, viewport, [150, 100], true)).toBeNull();
    expect(selectionHandleCursor(model, viewport, [100, 150], true)).toBeNull();
  });

  test('rotate handle shows the refresh cursor', () => {
    expect(selectionHandleCursor(model, viewport, [150, 76], false)).toBe(ROTATE_CURSOR);
    expect(selectionHandleCursor(model, viewport, [150, 40], false)).toBeNull();
  });

  test('dragged handle names map to their cursor', () => {
    expect(cursorForResizeHandle('top-left')).toBe('var(--cursor-nwse-resize)');
    expect(cursorForResizeHandle('bottom')).toBe('var(--cursor-ns-resize)');
    expect(cursorForResizeHandle('right')).toBe('var(--cursor-ew-resize)');
    expect(cursorForResizeHandle('bottom-left')).toBe('var(--cursor-nesw-resize)');
    expect(cursorForResizeHandle('mystery')).toBeNull();
  });
});
