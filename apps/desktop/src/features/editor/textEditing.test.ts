import { describe, expect, test } from 'bun:test';
import {
  caretIndexAt,
  caretRange,
  contrastingTextColor,
  hasPoorContrast,
  legibleTextColor,
  lineRowForY,
  planDraftReconcile,
  planKeyEdit,
} from './textEditing';

describe('overlay text legibility (display safety net)', () => {
  test('contrasts with the active canvas, not a fixed assumption', () => {
    expect(contrastingTextColor('#ffffff')).toBe('#000000');
    expect(contrastingTextColor('#f0efec')).toBe('#000000');
    expect(contrastingTextColor('#141412')).toBe('#ffffff');
    expect(contrastingTextColor('#000000')).toBe('#ffffff');
  });

  test('keeps stored strokes that already contrast', () => {
    expect(legibleTextColor('#ffffff', '#141412')).toBe('#ffffff');
    expect(legibleTextColor('#000000', '#f0efec')).toBe('#000000');
  });

  test('substitutes when the stored stroke matches the canvas', () => {
    expect(legibleTextColor('#000000', '#141412')).toBe('#ffffff');
    expect(legibleTextColor('#ffffff', '#f0efec')).toBe('#000000');
  });

  test('transparent and unparseable strokes fall back instead of vanishing', () => {
    expect(legibleTextColor('transparent', '#141412')).toBe('#ffffff');
    expect(legibleTextColor('', '#f0efec')).toBe('#000000');
    expect(legibleTextColor('not-a-color', '#141412')).toBe('#ffffff');
  });

  test('poor contrast flags unreadable strokes for default repair', () => {
    expect(hasPoorContrast('#000000', '#141412')).toBe(true);
    expect(hasPoorContrast('#ffffff', '#141412')).toBe(false);
    expect(hasPoorContrast('#000000', '#f0efec')).toBe(false);
    expect(hasPoorContrast('transparent', '#f0efec')).toBe(true);
    expect(hasPoorContrast('', '#141412')).toBe(true);
  });
});

describe('draft reconciliation (native change to engine ops)', () => {
  test('identical drafts need no ops', () => {
    expect(planDraftReconcile('hi', 'hi')).toBeNull();
  });

  test('appended typing becomes one insert', () => {
    expect(planDraftReconcile('h', 'hi')).toEqual({ setCaret: 1, backspaces: 0, insert: 'i' });
  });

  test('cut becomes backspaces from the range end', () => {
    expect(planDraftReconcile('hello', 'helo')).toEqual({ setCaret: 4, backspaces: 1, insert: '' });
  });

  test('select-and-replace removes then inserts', () => {
    expect(planDraftReconcile('hello', 'heYo')).toEqual({ setCaret: 4, backspaces: 2, insert: 'Y' });
  });

  test('counts emoji as one caret step like the engine', () => {
    expect(planDraftReconcile('a😀', 'a😀b')).toEqual({ setCaret: 2, backspaces: 0, insert: 'b' });
  });
});

describe('keystroke planning over caret ranges', () => {
  test('maps UTF-16 offsets onto code points', () => {
    expect(caretRange('a😀b', 0, 3)).toEqual({ start: 0, end: 2 });
    expect(caretRange('hi', 9, 2)).toEqual({ start: 2, end: 2 });
  });

  test('typing over a range replaces it (select-all then type)', () => {
    expect(planKeyEdit('hello', 0, 5, 'X')).toEqual({
      ops: { setCaret: 5, backspaces: 5, deleteForwards: 0, insert: 'X' },
      expected: 'X',
      expectedCaret: 1,
    });
  });

  test('collapsed typing inserts at the caret', () => {
    expect(planKeyEdit('hi', 1, 1, 'a')).toEqual({
      ops: { setCaret: 1, backspaces: 0, deleteForwards: 0, insert: 'a' },
      expected: 'hai',
      expectedCaret: 2,
    });
  });

  test('backspace over a range deletes the range', () => {
    expect(planKeyEdit('hello', 1, 4, null)).toEqual({
      ops: { setCaret: 4, backspaces: 3, deleteForwards: 0, insert: '' },
      expected: 'ho',
      expectedCaret: 1,
    });
  });

  test('collapsed backspace at the start is a no-op', () => {
    expect(planKeyEdit('hi', 0, 0, null)).toBeNull();
  });

  test('collapsed delete at the end is a no-op', () => {
    expect(planKeyEdit('hi', 2, 2, null, true)).toBeNull();
  });

  test('collapsed delete removes after the caret', () => {
    expect(planKeyEdit('hi', 0, 0, null, true)).toEqual({
      ops: { setCaret: 0, backspaces: 0, deleteForwards: 1, insert: '' },
      expected: 'i',
      expectedCaret: 0,
    });
  });
});

describe('click-to-caret mapping (pixel-exact host refinement)', () => {
  const tenPerChar = (text: string) => Array.from(text).length * 10;

  test('rows map through the line height, clamped', () => {
    expect(lineRowForY(5, 20, 3)).toBe(0);
    expect(lineRowForY(25, 20, 3)).toBe(1);
    expect(lineRowForY(999, 20, 3)).toBe(2);
    expect(lineRowForY(-4, 20, 3)).toBe(0);
    expect(lineRowForY(5, 0, 3)).toBe(0);
  });

  test('columns snap to the nearest shaped boundary', () => {
    expect(caretIndexAt(['abcd'], 0, 24, tenPerChar)).toBe(2);
    expect(caretIndexAt(['abcd'], 0, 26, tenPerChar)).toBe(3);
    expect(caretIndexAt(['abcd'], 0, -5, tenPerChar)).toBe(0);
    expect(caretIndexAt(['abcd'], 0, 100, tenPerChar)).toBe(4);
  });

  test('rows accumulate newline offsets', () => {
    expect(caretIndexAt(['ab', 'cdef'], 1, 16, tenPerChar)).toBe(3 + 2);
    expect(caretIndexAt([], 0, 15, tenPerChar)).toBe(0);
  });
});
