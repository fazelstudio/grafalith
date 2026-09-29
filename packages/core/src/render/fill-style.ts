import { FillStyle, GradientStop } from '../scene/types';
import { Bounds } from '../shapes/geometry';

/**
 * Resolve a FillStyle data object to a CanvasRenderingContext2D fill value.
 * Solid colors return the color string directly.
 * Gradients create and return a CanvasGradient object.
 * 
 * @param ctx - Canvas rendering context
 * @param fillStyle - FillStyle data object (solid or gradient)
 * @param bounds - Bounding box of the element being rendered
 * @returns Color string for solid, CanvasGradient for gradient
 */
export function resolveFillStyle(
  ctx: CanvasRenderingContext2D,
  fillStyle: FillStyle,
  bounds: Bounds,
): string | CanvasGradient {
  if (fillStyle.type === 'solid') {
    return fillStyle.color;
  }

  // Gradient
  const { gradientType, angle, stops } = fillStyle;
  
  if (gradientType === 'linear') {
    return createLinearGradient(ctx, angle, stops, bounds);
  } else {
    return createRadialGradient(ctx, stops, bounds);
  }
}

/**
 * Create a linear gradient from angle and stops.
 * Angle convention: 0° = left to right, 90° = top to bottom, etc.
 * 
 * @param ctx - Canvas rendering context
 * @param angle - Gradient angle in degrees (0-360)
 * @param stops - Array of gradient stops with offset and color
 * @param bounds - Element bounding box
 * @returns CanvasGradient object
 */
function createLinearGradient(
  ctx: CanvasRenderingContext2D,
  angle: number,
  stops: GradientStop[],
  bounds: Bounds,
): CanvasGradient {
  const { minX, minY, maxX, maxY } = bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  
  // Convert angle to radians
  const radians = (angle * Math.PI) / 180;
  
  // Calculate gradient start and end points based on angle
  // 0° = left to right, 90° = top to bottom
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  
  // Calculate the length of the gradient line
  const length = Math.max(width, height);
  
  // Calculate start and end points
  const startX = centerX - (Math.cos(radians) * length) / 2;
  const startY = centerY - (Math.sin(radians) * length) / 2;
  const endX = centerX + (Math.cos(radians) * length) / 2;
  const endY = centerY + (Math.sin(radians) * length) / 2;
  
  const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
  
  // Add color stops
  for (const stop of stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  
  return gradient;
}

/**
 * Create a radial gradient from stops and bounds.
 * 
 * @param ctx - Canvas rendering context
 * @param stops - Array of gradient stops with offset and color
 * @param bounds - Element bounding box
 * @returns CanvasGradient object
 */
function createRadialGradient(
  ctx: CanvasRenderingContext2D,
  stops: GradientStop[],
  bounds: Bounds,
): CanvasGradient {
  const { minX, minY, maxX, maxY } = bounds;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radius = Math.max(maxX - minX, maxY - minY) / 2;
  
  // Create radial gradient from center to edge
  const gradient = ctx.createRadialGradient(
    centerX, centerY, 0,
    centerX, centerY, radius
  );
  
  // Add color stops
  for (const stop of stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  
  return gradient;
}