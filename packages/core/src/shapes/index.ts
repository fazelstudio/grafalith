import { Element } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds } from './geometry';
import { defaultShapeRegistry } from './registry';

// Re-export registry (values)
export { ShapeRegistry, defaultShapeRegistry, registerShape } from './registry';
// Re-export registry (types)
export type { ShapeDefinition, CustomElementMap } from './registry';

// Ensure built-in shapes are registered (side-effect import triggers registration)
import './builtin-shapes';

/** Shape handler functions for a specific element type. */
export interface ShapeHandler {
  render: (ctx: CanvasRenderingContext2D, el: Element, viewport: Viewport) => void;
  hitTest: (px: number, py: number, el: Element) => boolean;
  getBounds: (el: Element) => Bounds;
}

/**
 * Render an element using the appropriate shape handler from the registry.
 * Falls back to a simple rectangle if the type is not registered.
 */
export function renderElement(
  ctx: CanvasRenderingContext2D,
  el: Element,
  viewport: Viewport,
): void {
  const definition = defaultShapeRegistry.get(el.type);
  if (definition) {
    definition.render(ctx, el, viewport);
  } else {
    ctx.strokeRect(el.x, el.y, el.width, el.height);
  }
}

/**
 * Hit-test a point against an element using the appropriate shape handler.
 * Falls back to a simple bounds check if the type is not registered.
 */
export function hitTestElement(
  px: number,
  py: number,
  el: Element,
): boolean {
  const definition = defaultShapeRegistry.get(el.type);
  if (definition) {
    return definition.hitTest([px, py], el);
  }
  return (
    px >= el.x &&
    px <= el.x + el.width &&
    py >= el.y &&
    py <= el.y + el.height
  );
}

/**
 * Get bounds of an element using the appropriate shape handler.
 * Falls back to a simple bounds if the type is not registered.
 */
export function getElementBounds(el: Element): Bounds {
  const definition = defaultShapeRegistry.get(el.type);
  if (definition) {
    return definition.getBounds(el);
  }
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
}

/**
 * Get the raw (unrotated) bounds of an element from its x, y, width, height.
 * Ignores rotation — useful for selection overlay that needs to render
 * a rotated bounding box from the element's local coordinate system.
 */
export function getElementRawBounds(el: Element): Bounds {
  return { minX: el.x, minY: el.y, maxX: el.x + el.width, maxY: el.y + el.height };
}

export type { Bounds };
export { renderRectangle, hitTestRectangle, getRectangleBounds } from './rectangle';
export { renderEllipse, hitTestEllipse, getEllipseBounds } from './ellipse';
export { renderLine, hitTestLine, getLineBounds } from './line';
export { renderFreedraw, hitTestFreedraw, getFreedrawBounds } from './freedraw';
export { renderText, hitTestText, getTextBounds, measureText } from './text';
export { renderArrow, hitTestArrow, getArrowBounds } from './arrow';
export { renderImage, hitTestImage, getImageBounds, setImageAssetStore, clearImageCache, getImageCache } from './image';
export { renderPath, hitTestPath, getPathBounds, flattenPath } from './path';
