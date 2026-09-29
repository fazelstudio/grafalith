import { BaseElement, Point } from '../scene/types';
import { Viewport } from '../render/viewport';
import { Bounds } from './geometry';

/** Re-export CustomElementMap for convenience. */
export type { CustomElementMap } from '../scene/types';

/**
 * Shape definition for the registry.
 * Each shape type provides render, hit-test, bounds, and default creation logic.
 */
export interface ShapeDefinition<T extends BaseElement = BaseElement> {
  /** Unique type identifier (e.g. 'rectangle', 'star'). */
  type: string;
  /** Render the element onto a canvas context. */
  render(ctx: CanvasRenderingContext2D, element: T, viewport: Viewport): void;
  /** Test whether a point in scene coordinates hits the element. */
  hitTest(point: Point, element: T): boolean;
  /** Compute axis-aligned bounding box for the element. */
  getBounds(element: T): Bounds;
  /** Return default property values for a new element of this type. */
  getDefaultProps(): Partial<T>;
  /**
   * Optional: compute element properties during drag-creation.
   * Called on each pointermove while the user is drawing this shape.
   * If not provided, the default drag behavior (updating x/y/width/height) is used.
   */
  onCreateDrag?(startPoint: Point, currentPoint: Point, element: T): Partial<T>;
  /**
   * Optional: compute minimum valid size check after drag-creation.
   * If not provided, defaults to width > 2 && height > 2.
   */
  hasMinimumSize?(element: T): boolean;
}

/**
 * Registry for shape definitions. Built-in and custom shapes are registered
 * here — the render loop dispatches through this registry with zero
 * hardcoded if/else per type.
 */
export class ShapeRegistry {
  private definitions = new Map<string, ShapeDefinition>();

  /** Register a shape definition. Overwrites if the type already exists. */
  register<T extends BaseElement>(definition: ShapeDefinition<T>): void {
    this.definitions.set(definition.type, definition as ShapeDefinition);
  }

  /** Get a shape definition by type. Returns undefined if not registered. */
  get(type: string): ShapeDefinition | undefined {
    return this.definitions.get(type);
  }

  /** Get all registered shape definitions. */
  getAll(): ShapeDefinition[] {
    return Array.from(this.definitions.values());
  }

  /** Check if a type is registered. */
  has(type: string): boolean {
    return this.definitions.has(type);
  }

  /** Get all registered type strings. */
  getTypes(): string[] {
    return Array.from(this.definitions.keys());
  }
}

/**
 * Default singleton registry.
 * Built-in shapes are registered here; custom shapes can be added via `registerShape()`.
 */
export const defaultShapeRegistry = new ShapeRegistry();

/**
 * Register a shape definition in the default registry.
 * This is the primary public API for adding custom shapes.
 * @param definition - Shape definition to register
 */
export function registerShape<T extends BaseElement>(definition: ShapeDefinition<T>): void {
  defaultShapeRegistry.register(definition);
}
