export type Point = [number, number];

/**
 * Module augmentation interface for custom element types.
 * Developers can extend this via declaration merging:
 *
 * ```ts
 * declare module '@fazelstudio/fazelidraw' {
 *   interface CustomElementMap {
 *     star: StarElement;
 *   }
 * }
 * ```
 *
 * This keeps the built-in Element union type closed and type-safe,
 * while allowing custom shapes to participate in the type system.
 */

// Intentionally empty: extension point for module augmentation.
// Declaration merging requires an interface (a `type` alias cannot be merged).
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CustomElementMap {}

export type ElementType =
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'freedraw'
  | 'frame'
  | 'image'
  | 'path'
  | 'instance'
  | (string & {});  // Allows custom types via module augmentation while keeping autocomplete for built-in types

/**
 * Crop region for image elements.
 * Coordinates are in pixels relative to the original image (naturalSize).
 */
export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Constraint configuration for an element inside a frame.
 * Determines how the child reacts when its parent frame is resized.
 * Uses Figma API naming: min (pin left/top), max (pin right/bottom),
 * center, stretch, scale.
 */
export interface Constraints {
  horizontal: 'min' | 'max' | 'center' | 'stretch' | 'scale';
  vertical: 'min' | 'max' | 'center' | 'stretch' | 'scale';
}

/**
 * Auto-layout configuration for a frame.
 * When set, the frame becomes a flex-like container that automatically
 * positions its children. Constraints on children are ignored when auto-layout is active.
 */
export interface AutoLayoutConfig {
  /** Layout direction — primary axis. */
  direction: 'horizontal' | 'vertical';
  /** Gap between children along the primary axis. */
  gap: number;
  /** Padding inside the frame (space between frame edges and children). */
  padding: { top: number; right: number; bottom: number; left: number };
  /** Alignment along the primary axis (direction axis). */
  primaryAxisAlign: 'start' | 'center' | 'end' | 'space-between';
  /** Alignment along the counter axis (perpendicular to direction). */
  counterAxisAlign: 'start' | 'center' | 'end' | 'stretch';
  /** Frame sizing mode: 'hug' = frame resizes to fit children, 'fixed' = frame stays at its current size. */
  sizing: 'hug' | 'fixed';
}

export type ArrowheadType = 'arrow' | 'bar' | 'dot';

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export type ElementFillStyle = 'solid' | 'hachure' | 'cross-hatch';

export interface GradientStop {
  offset: number;
  color: string;
}

export type FillStyle =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; gradientType: 'linear' | 'radial'; angle: number; stops: GradientStop[] };

export interface Binding {
  elementId: string;
  focus: number;
  gap: number;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  strokeColor: string;
  backgroundColor: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  fillStyle: ElementFillStyle;
  opacity: number;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  locked: boolean;
  hidden: boolean;
  frameId: string | null;
  /** Constraint behavior when parent frame is resized (only applies to direct children of non-auto-layout frames). */
  constraints?: Constraints;
  /** Child sizing within an auto-layout frame: 'fixed' = keep own size, 'fill' = expand to fill available space on primary axis. */
  childLayoutSizing?: 'fixed' | 'fill';
}

export interface RectangleElement extends BaseElement {
  type: 'rectangle';
  roundness: number | null;
}

export interface EllipseElement extends BaseElement {
  type: 'ellipse';
}

export interface LineElement extends BaseElement {
  type: 'line';
  points: Point[];
}

export interface ArrowElement extends BaseElement {
  type: 'arrow';
  points: Point[];
  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowhead: ArrowheadType | null;
  endArrowhead: ArrowheadType | null;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  textAlign: 'left' | 'center' | 'right';
  containerId: string | null;
}

export interface FreedrawElement extends BaseElement {
  type: 'freedraw';
  points: Point[];
  pressures: number[];
}

export interface FrameElement extends BaseElement {
  type: 'frame';
  name: string;
  clipContent: boolean;
  /** Auto-layout config. When set, frame acts as a flex-like container — children are positioned automatically. */
  autoLayout?: AutoLayoutConfig;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  /** Reference to asset in AssetStore — NOT the image data itself. */
  assetId: string;
  /** Natural (original file) dimensions, used for aspect-ratio lock. */
  naturalWidth: number;
  naturalHeight: number;
  /** Non-destructive crop region in natural pixel coordinates, or null for no crop. */
  crop: CropRegion | null;
}

/** A single anchor point in a vector path with optional Bezier control handles. */
export interface PathSegment {
  /** Anchor point position in scene coordinates. */
  point: Point;
  /** Incoming control point (relative to anchor), null = sharp corner. */
  handleIn: Point | null;
  /** Outgoing control point (relative to anchor), null = sharp corner. */
  handleOut: Point | null;
}

/** Vector path element — cubic Bezier curves between anchor points. */
export interface PathElement extends BaseElement {
  type: 'path';
  /** Ordered array of anchor points forming the path. */
  segments: PathSegment[];
  /** Whether the path is closed (solid shape) or open (stroke only). */
  closed: boolean;
}

/**
 * Instance of a ComponentDefinition — a live copy that inherits all master
 * properties except those explicitly overridden per-property.
 *
 * Override keys use index-based paths into the component's rootElementIds:
 * - `"0"` = first root element
 * - `"1/0"` = first child of second root element (if grouped)
 *
 * Children are NOT stored as separate scene elements — they are resolved
 * from the master at render/mutation time via `resolveInstance()`.
 */
export interface InstanceElement extends BaseElement {
  type: 'instance';
  /** Reference to the ComponentDefinition this instance belongs to. */
  componentId: string;
  /** Per-child property overrides. Key = index path, value = partial element patch. */
  overrides: Record<string, Partial<Element>>;
}

/** Built-in element types. */
export type BuiltinElement =
  | RectangleElement
  | EllipseElement
  | LineElement
  | ArrowElement
  | TextElement
  | FreedrawElement
  | FrameElement
  | ImageElement
  | PathElement
  | InstanceElement;

/**
 * All element types: built-in + custom types registered via module augmentation.
 * Custom types extend BaseElement and are added to CustomElementMap:
 *
 * ```ts
 * declare module '@fazelstudio/fazelidraw' {
 *   interface CustomElementMap {
 *     star: StarElement;
 *   }
 * }
 * ```
 */
export type Element =
  | BuiltinElement
  | CustomElementMap[keyof CustomElementMap];
