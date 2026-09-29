import { Scene } from './scene';
import { FillStyle, StrokeStyle } from './types';

/**
 * Get the common stroke color across multiple elements, or null if mixed.
 * Used by UI to show "mixed" state in color picker.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to check
 * @returns Common color string, or null if values differ
 */
export function getMixedStrokeColor(scene: Scene, elementIds: string[]): string | null {
  let common: string | null = null;
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (!el) continue;
    if (common === null) {
      common = el.strokeColor;
    } else if (common !== el.strokeColor) {
      return null; // mixed
    }
  }
  return common;
}

/**
 * Get the common opacity across multiple elements, or null if mixed.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to check
 * @returns Common opacity value, or null if values differ
 */
export function getMixedOpacity(scene: Scene, elementIds: string[]): number | null {
  let common: number | null = null;
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (!el) continue;
    if (common === null) {
      common = el.opacity;
    } else if (common !== el.opacity) {
      return null; // mixed
    }
  }
  return common;
}

/**
 * Get the common stroke width across multiple elements, or null if mixed.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to check
 * @returns Common stroke width, or null if values differ
 */
export function getMixedStrokeWidth(scene: Scene, elementIds: string[]): number | null {
  let common: number | null = null;
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (!el) continue;
    if (common === null) {
      common = el.strokeWidth;
    } else if (common !== el.strokeWidth) {
      return null; // mixed
    }
  }
  return common;
}

/**
 * Set stroke color for multiple elements.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to update
 * @param color - New stroke color (hex string or 'transparent')
 */
export function setStrokeColor(
  scene: Scene,
  elementIds: string[],
  color: string,
): void {
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el) {
      scene.upsertElement({
        ...el,
        strokeColor: color,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2000000000),
      });
    }
  }
}

/**
 * Set background fill style for multiple elements.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to update
 * @param fillStyle - New fill style (solid or gradient)
 */
export function setBackgroundFill(
  scene: Scene,
  elementIds: string[],
  fillStyle: FillStyle,
): void {
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el) {
      scene.upsertElement({
        ...el,
        backgroundColor: fillStyle,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2000000000),
      });
    }
  }
}

/**
 * Set stroke width for multiple elements.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to update
 * @param width - New stroke width in pixels
 */
export function setStrokeWidth(
  scene: Scene,
  elementIds: string[],
  width: number,
): void {
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el) {
      scene.upsertElement({
        ...el,
        strokeWidth: width,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2000000000),
      });
    }
  }
}

/**
 * Set stroke style for multiple elements.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to update
 * @param style - New stroke style (solid, dashed, or dotted)
 */
export function setStrokeStyle(
  scene: Scene,
  elementIds: string[],
  style: StrokeStyle,
): void {
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el) {
      scene.upsertElement({
        ...el,
        strokeStyle: style,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2000000000),
      });
    }
  }
}

/**
 * Set opacity for multiple elements.
 * @param scene - Scene instance
 * @param elementIds - Array of element IDs to update
 * @param opacity - New opacity value (0-100)
 */
export function setOpacity(
  scene: Scene,
  elementIds: string[],
  opacity: number,
): void {
  // Clamp opacity to valid range
  const clampedOpacity = Math.max(0, Math.min(100, opacity));
  
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (el) {
      scene.upsertElement({
        ...el,
        opacity: clampedOpacity,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2000000000),
      });
    }
  }
}