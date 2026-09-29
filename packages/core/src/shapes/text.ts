import { TextElement } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds, getRotatedBounds } from './geometry';

const LINE_HEIGHT_MULTIPLIER = 1.25;

/** Get the CSS font string for a TextElement. */
function getFontString(el: TextElement): string {
  return `${el.fontSize}px ${el.fontFamily}`;
}

/**
 * Measure text dimensions for a TextElement.
 * Returns width (max line width) and height (lineCount * fontSize * lineHeightMultiplier).
 */
export function measureText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  fontFamily: string,
): { width: number; height: number } {
  ctx.save();
  ctx.font = `${fontSize}px ${fontFamily}`;
  const lines = text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const m = ctx.measureText(line);
    if (m.width > maxWidth) maxWidth = m.width;
  }
  const lineCount = lines.length || 1;
  const height = lineCount * fontSize * LINE_HEIGHT_MULTIPLIER;
  ctx.restore();
  return { width: maxWidth, height };
}

/**
 * Render a text element to a canvas context.
 * Renders each line separately with proper alignment.
 */
export function renderText(
  ctx: CanvasRenderingContext2D,
  el: TextElement,
  _viewport: Viewport,
): void {
  if (!el.text) return;

  ctx.save();

  // Apply rotation around center
  if (el.rotation !== 0) {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate(el.rotation);
    ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha = el.opacity / 100;
  ctx.font = getFontString(el);
  ctx.fillStyle = el.strokeColor;
  ctx.textBaseline = 'top';
  ctx.textAlign = el.textAlign;

  const lines = el.text.split('\n');
  const lineHeight = el.fontSize * LINE_HEIGHT_MULTIPLIER;

  for (let i = 0; i < lines.length; i++) {
    let x = el.x;
    if (el.textAlign === 'center') {
      x = el.x + el.width / 2;
    } else if (el.textAlign === 'right') {
      x = el.x + el.width;
    }
    const y = el.y + i * lineHeight;
    ctx.fillText(lines[i], x, y);
  }

  ctx.restore();
}

/**
 * Hit-test a point against a text element.
 * Uses bounding box check (no per-character precision).
 */
export function hitTestText(
  px: number,
  py: number,
  el: TextElement,
): boolean {
  if (el.rotation === 0) {
    return (
      px >= el.x &&
      px <= el.x + el.width &&
      py >= el.y &&
      py <= el.y + el.height
    );
  }

  // Transform point into local (unrotated) space
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const cos = Math.cos(-el.rotation);
  const sin = Math.sin(-el.rotation);
  const dx = px - cx;
  const dy = py - cy;
  const localX = dx * cos - dy * sin + cx;
  const localY = dx * sin + dy * cos + cy;

  return (
    localX >= el.x &&
    localX <= el.x + el.width &&
    localY >= el.y &&
    localY <= el.y + el.height
  );
}

/**
 * Get axis-aligned bounding box of a text element.
 */
export function getTextBounds(el: TextElement): Bounds {
  return getRotatedBounds(el.x, el.y, el.width, el.height, el.rotation);
}
