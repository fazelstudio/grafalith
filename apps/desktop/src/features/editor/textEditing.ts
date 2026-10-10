/**
 * Pure text-editing helpers for the canvas overlay.
 *
 * The engine owns the draft, caret, and committed colors; these helpers only
 * cover what the host must decide while presenting the overlay: a display
 * color that stays readable even when a stored stroke has poor contrast
 * against the current canvas, and a reconciliation plan that maps a native
 * textarea change onto the engine's caret-based ops. Committed rendering
 * keeps the stored color untouched.
 */

type Rgb = [number, number, number];

/** Contrast floor for overlay text; matches the engine's 3:1 crossover. */
export const MIN_OVERLAY_CONTRAST = 3;

/** Parse `#rrggbb`/`#rgb` into channels; anything else yields null. */
export function parseHexColor(color: string): Rgb | null {
  const hex = color.trim().replace(/^#/, '');
  const expanded = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

function channelLuminance(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** Relative luminance of an sRGB color in `[0, 1]`. */
export function relativeLuminance([r, g, b]: Rgb): number {
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

/** Black on light canvases, white on dark ones. */
export function contrastingTextColor(canvasBackground: string): string {
  const rgb = parseHexColor(canvasBackground);
  if (!rgb) return '#000000';
  return relativeLuminance(rgb) > 0.179 ? '#000000' : '#ffffff';
}

/** WCAG contrast ratio of two colors in `[1, 21]`. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Display color for overlay text. Keeps the stored stroke when it contrasts
 * with the canvas; otherwise substitutes black/white so typing and the caret
 * stay visible. Empty, transparent, and unparseable strokes fall back the
 * same way instead of rendering nothing.
 */
export function legibleTextColor(strokeColor: string, canvasBackground: string): string {
  const fallback = contrastingTextColor(canvasBackground);
  const stroke = strokeColor.trim();
  if (stroke === '' || stroke.toLowerCase() === 'transparent') return fallback;
  if (hasPoorContrast(stroke, canvasBackground)) return fallback;
  return stroke;
}

/**
 * True when a stored stroke would be unreadable on the canvas: empty,
 * transparent, unparseable, or below the overlay contrast floor. Hosts use
 * this before assigning a contrasting default to a fresh element; elements
 * that already carry visible content keep their colors untouched.
 */
export function hasPoorContrast(strokeColor: string, canvasBackground: string): boolean {
  const stroke = strokeColor.trim();
  if (stroke === '' || stroke.toLowerCase() === 'transparent') return true;
  const strokeRgb = parseHexColor(stroke);
  const bgRgb = parseHexColor(canvasBackground);
  if (!strokeRgb || !bgRgb) return true;
  return contrastRatio(strokeRgb, bgRgb) < MIN_OVERLAY_CONTRAST;
}

/** Caret-based ops that reconcile a native textarea change. */
export interface DraftReconcile {
  /** Caret position (code points) the deletions start from. */
  setCaret: number;
  /** Backspaces to send from that caret. */
  backspaces: number;
  /** Text to insert once the differing range is removed. */
  insert: string;
}

/**
 * Diff two drafts over a single contiguous change (typing, paste, cut, or
 * select-and-replace) into engine ops. Counts in code points to match the
 * engine caret. Returns null when both drafts already agree.
 */
export function planDraftReconcile(previous: string, next: string): DraftReconcile | null {
  if (previous === next) return null;
  const prev = Array.from(previous);
  const chars = Array.from(next);
  let start = 0;
  while (start < prev.length && start < chars.length && prev[start] === chars[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < prev.length - start &&
    end < chars.length - start &&
    prev[prev.length - 1 - end] === chars[chars.length - 1 - end]
  ) {
    end += 1;
  }
  return {
    setCaret: start + (prev.length - start - end),
    backspaces: prev.length - start - end,
    insert: chars.slice(start, chars.length - end).join(''),
  };
}

/** Native selection as code-point indices into the draft. */
export interface CaretRange {
  /** Range start (code points). */
  start: number;
  /** Range end (code points, `>= start`). */
  end: number;
}

/**
 * Map UTF-16 textarea offsets onto code-point indices so ranges line up
 * with the engine caret. Clamped to the value.
 */
export function caretRange(value: string, selectionStart: number, selectionEnd: number): CaretRange {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(0, Math.min(selectionEnd, value.length));
  return {
    start: Array.from(value.slice(0, start)).length,
    end: Array.from(value.slice(0, end)).length,
  };
}

/** Engine ops for one intercepted keystroke over a caret range. */
export interface KeyEditOps {
  /** Caret to set before deleting. */
  setCaret: number;
  /** Backspaces from that caret (removes the range). */
  backspaces: number;
  /** Forward deletes from the range start (collapsed Delete only). */
  deleteForwards: number;
  /** Text to insert once the range is gone ('' = deletion only). */
  insert: string;
}

/** Planned keystroke: ops to send plus the draft and caret they produce. */
export interface KeyEditPlan {
  /** Ops to send, in order. */
  ops: KeyEditOps;
  /** Draft the ops produce (code points). */
  expected: string;
  /** Caret the ops produce (code points). */
  expectedCaret: number;
}

/**
 * Plan one intercepted keystroke (printable, Enter, Tab, Backspace, Delete)
 * over the native caret range: a selected range is removed first so typing
 * replaces it, exactly like a native field. Returns null when the key is a
 * no-op at the caret (Backspace at 0, Delete at the end).
 */
export function planKeyEdit(
  draft: string,
  start: number,
  end: number,
  insert: string | null,
  forward = false,
): KeyEditPlan | null {
  const chars = Array.from(draft);
  const s = Math.max(0, Math.min(start, chars.length));
  const e = Math.max(s, Math.min(end, chars.length));
  const head = chars.slice(0, s).join('');
  const tail = chars.slice(e).join('');
  if (insert !== null) {
    return {
      ops: { setCaret: s === e ? s : e, backspaces: e - s, deleteForwards: 0, insert },
      expected: head + insert + tail,
      expectedCaret: s + Array.from(insert).length,
    };
  }
  if (s !== e) {
    return {
      ops: { setCaret: e, backspaces: e - s, deleteForwards: 0, insert: '' },
      expected: head + tail,
      expectedCaret: s,
    };
  }
  if (!forward) {
    if (s === 0) return null;
    return {
      ops: { setCaret: s, backspaces: 1, deleteForwards: 0, insert: '' },
      expected: chars.slice(0, s - 1).join('') + chars.slice(s).join(''),
      expectedCaret: s - 1,
    };
  }
  if (s >= chars.length) return null;
  return {
    ops: { setCaret: s, backspaces: 0, deleteForwards: 1, insert: '' },
    expected: chars.slice(0, s).join('') + chars.slice(s + 1).join(''),
    expectedCaret: s,
  };
}

/**
 * Row for a scene-space y offset inside a text box (`lineHeight` scene
 * units per row, clamped to the laid-out lines).
 */
export function lineRowForY(relY: number, lineHeight: number, lineCount: number): number {
  if (!(lineHeight > 0) || lineCount <= 0) return 0;
  return Math.max(0, Math.min(lineCount - 1, Math.floor(relY / lineHeight)));
}

/**
 * Caret boundary in one line nearest to `relX` (scene units from the line
 * start). Widths come from the host 2D context so shaping matches the
 * committed render; per-character advances approximate ligature runs.
 */
export function caretIndexAtLine(
  line: string,
  relX: number,
  measure: (text: string) => number,
): number {
  const chars = Array.from(line);
  let best = 0;
  let bestDist = Math.abs(relX);
  let width = 0;
  for (let i = 0; i < chars.length; i += 1) {
    width += measure(chars[i]);
    const dist = Math.abs(width - relX);
    if (dist < bestDist) {
      bestDist = dist;
      best = i + 1;
    }
  }
  return best;
}

/**
 * Caret index into a multi-line draft for a scene-space point relative to
 * the text origin: rows map through the line height, columns through shaped
 * advances, plus one char per crossed newline.
 */
export function caretIndexAt(
  lines: string[],
  row: number,
  relX: number,
  measure: (text: string) => number,
): number {
  let index = 0;
  const clampedRow = Math.max(0, Math.min(lines.length - 1, row));
  for (let i = 0; i < clampedRow; i += 1) {
    index += Array.from(lines[i]).length + 1;
  }
  if (lines.length === 0) return 0;
  return index + caretIndexAtLine(lines[clampedRow], relX, measure);
}
