import { Point } from '../scene/types';
import type {
  RectangleElement,
  EllipseElement,
  LineElement,
  ArrowElement,
  FreedrawElement,
  TextElement,
  FrameElement,
  PathElement,
} from '../scene/types';
import { defaultShapeRegistry } from './registry';
import type { ShapeDefinition } from './registry';
import { renderRectangle, hitTestRectangle, getRectangleBounds } from './rectangle';
import { renderEllipse, hitTestEllipse, getEllipseBounds } from './ellipse';
import { renderLine, hitTestLine, getLineBounds } from './line';
import { renderFreedraw, hitTestFreedraw, getFreedrawBounds } from './freedraw';
import { renderText, hitTestText, getTextBounds } from './text';
import { renderArrow, hitTestArrow, getArrowBounds } from './arrow';
import { renderFrame, hitTestFrame, getFrameBounds } from './frame';
import { imageShapeDefinition } from './image';
import { renderPath, hitTestPath, getPathBounds } from './path';

/** Built-in rectangle shape definition. */
const rectangleDefinition: ShapeDefinition<RectangleElement> = {
  type: 'rectangle',
  render: renderRectangle,
  hitTest: (point, el) => hitTestRectangle(point[0], point[1], el),
  getBounds: (el) => getRectangleBounds(el),
  getDefaultProps: () => ({
    type: 'rectangle' as const,
    width: 100,
    height: 100,
    roundness: null,
  }),
  onCreateDrag: (start, current) => ({
    x: Math.min(start[0], current[0]),
    y: Math.min(start[1], current[1]),
    width: Math.abs(current[0] - start[0]),
    height: Math.abs(current[1] - start[1]),
  }),
};

/** Built-in ellipse shape definition. */
const ellipseDefinition: ShapeDefinition<EllipseElement> = {
  type: 'ellipse',
  render: renderEllipse,
  hitTest: (point, el) => hitTestEllipse(point[0], point[1], el),
  getBounds: (el) => getEllipseBounds(el),
  getDefaultProps: () => ({
    type: 'ellipse' as const,
    width: 100,
    height: 100,
  }),
  onCreateDrag: (start, current) => ({
    x: Math.min(start[0], current[0]),
    y: Math.min(start[1], current[1]),
    width: Math.abs(current[0] - start[0]),
    height: Math.abs(current[1] - start[1]),
  }),
};

/** Built-in line shape definition. */
const lineDefinition: ShapeDefinition<LineElement> = {
  type: 'line',
  render: renderLine,
  hitTest: (point, el) => hitTestLine(point[0], point[1], el),
  getBounds: (el) => getLineBounds(el),
  getDefaultProps: () => ({
    type: 'line' as const,
    width: 100,
    height: 0,
    points: [[0, 0]] as Point[],
  }),
  onCreateDrag: (start, current, _el) => ({
    x: start[0],
    y: start[1],
    width: Math.abs(current[0] - start[0]),
    height: Math.abs(current[1] - start[1]),
    points: [[0, 0], [current[0] - start[0], current[1] - start[1]]] as Point[],
  }),
  hasMinimumSize: (el) => {
    return (el.points?.length ?? 0) >= 2;
  },
};

/** Built-in arrow shape definition. */
const arrowDefinition: ShapeDefinition<ArrowElement> = {
  type: 'arrow',
  render: renderArrow,
  hitTest: (point, el) => hitTestArrow(point[0], point[1], el),
  getBounds: (el) => getArrowBounds(el),
  getDefaultProps: () => ({
    type: 'arrow' as const,
    width: 100,
    height: 0,
    points: [[0, 0]] as Point[],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow' as const,
  }),
  onCreateDrag: (start, current) => ({
    x: start[0],
    y: start[1],
    width: Math.abs(current[0] - start[0]),
    height: Math.abs(current[1] - start[1]),
    points: [[0, 0], [current[0] - start[0], current[1] - start[1]]] as Point[],
  }),
  hasMinimumSize: (el) => {
    return (el.points?.length ?? 0) >= 2;
  },
};

/** Built-in freedraw shape definition. */
const freedrawDefinition: ShapeDefinition<FreedrawElement> = {
  type: 'freedraw',
  render: renderFreedraw,
  hitTest: (point, el) => hitTestFreedraw(point[0], point[1], el),
  getBounds: (el) => getFreedrawBounds(el),
  getDefaultProps: () => ({
    type: 'freedraw' as const,
    width: 100,
    height: 100,
    points: [] as Point[],
    pressures: [] as number[],
  }),
  onCreateDrag: (start, current, el) => {
    const relX = current[0] - el.x;
    const relY = current[1] - el.y;
    return {
      points: [...el.points, [relX, relY] as Point],
      width: Math.abs(current[0] - el.x),
      height: Math.abs(current[1] - el.y),
    };
  },
  hasMinimumSize: (el) => {
    return (el.points?.length ?? 0) >= 2;
  },
};

/** Built-in text shape definition. */
const textDefinition: ShapeDefinition<TextElement> = {
  type: 'text',
  render: renderText,
  hitTest: (point, el) => hitTestText(point[0], point[1], el),
  getBounds: (el) => getTextBounds(el),
  getDefaultProps: () => ({
    type: 'text' as const,
    width: 100,
    height: 20,
    text: '',
    fontSize: 16,
    fontFamily: 'Virgil',
    textAlign: 'left' as const,
    containerId: null,
  }),
  onCreateDrag: (start) => ({
    x: start[0],
    y: start[1],
    width: 100,
    height: 20,
  }),
  hasMinimumSize: () => true,
};

/** Built-in frame shape definition. */
const frameDefinition: ShapeDefinition<FrameElement> = {
  type: 'frame',
  render: renderFrame,
  hitTest: (point, el) => hitTestFrame(point[0], point[1], el),
  getBounds: (el) => getFrameBounds(el),
  getDefaultProps: () => ({
    type: 'frame' as const,
    width: 400,
    height: 300,
    name: 'Frame',
    clipContent: true,
  }),
  onCreateDrag: (start, current) => ({
    x: Math.min(start[0], current[0]),
    y: Math.min(start[1], current[1]),
    width: Math.abs(current[0] - start[0]),
    height: Math.abs(current[1] - start[1]),
  }),
};

/** Built-in path shape definition. */
const pathDefinition: ShapeDefinition<PathElement> = {
  type: 'path',
  render: renderPath,
  hitTest: (point, el) => hitTestPath(point[0], point[1], el),
  getBounds: (el) => getPathBounds(el),
  getDefaultProps: () => ({
    type: 'path' as const,
    width: 0,
    height: 0,
    segments: [],
    closed: false,
  }),
  hasMinimumSize: (el) => {
    return (el.segments?.length ?? 0) >= 2;
  },
};

/** Register all built-in shapes in the default registry. */
export function registerBuiltinShapes(): void {
  defaultShapeRegistry.register(rectangleDefinition);
  defaultShapeRegistry.register(ellipseDefinition);
  defaultShapeRegistry.register(lineDefinition);
  defaultShapeRegistry.register(arrowDefinition);
  defaultShapeRegistry.register(freedrawDefinition);
  defaultShapeRegistry.register(textDefinition);
  defaultShapeRegistry.register(frameDefinition);
  defaultShapeRegistry.register(imageShapeDefinition);
  defaultShapeRegistry.register(pathDefinition);
}

// Auto-register built-in shapes on module load
registerBuiltinShapes();
