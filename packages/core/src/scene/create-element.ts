import {
  RectangleElement,
  EllipseElement,
  LineElement,
  ArrowElement,
  TextElement,
  FreedrawElement,
  FrameElement,
  ImageElement,
  PathElement,
  FillStyle,
} from './types';

function generateId(): string {
  return crypto.randomUUID();
}

function randomNonce(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

const defaultFillStyle: FillStyle = { type: 'solid', color: 'transparent' };

/** Create a new RectangleElement with defaults. */
export function createRectangle(
  overrides: Partial<RectangleElement> = {},
): RectangleElement {
  return {
    id: generateId(),
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    roundness: null,
    ...overrides,
  };
}

/** Create a new EllipseElement with defaults. */
export function createEllipse(
  overrides: Partial<EllipseElement> = {},
): EllipseElement {
  return {
    id: generateId(),
    type: 'ellipse',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    ...overrides,
  };
}

/** Create a new LineElement with defaults. */
export function createLine(
  overrides: Partial<LineElement> = {},
): LineElement {
  return {
    id: generateId(),
    type: 'line',
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    points: [[0, 0]],
    ...overrides,
  };
}

/** Create a new ArrowElement with defaults. */
export function createArrow(
  overrides: Partial<ArrowElement> = {},
): ArrowElement {
  return {
    id: generateId(),
    type: 'arrow',
    x: 0,
    y: 0,
    width: 100,
    height: 0,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    points: [[0, 0]],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    ...overrides,
  };
}

/** Create a new TextElement with defaults. */
export function createText(
  overrides: Partial<TextElement> = {},
): TextElement {
  return {
    id: generateId(),
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    text: '',
    fontSize: 16,
    fontFamily: 'Virgil',
    textAlign: 'left',
    containerId: null,
    ...overrides,
  };
}

/** Create a new FreedrawElement with defaults. */
export function createFreedraw(
  overrides: Partial<FreedrawElement> = {},
): FreedrawElement {
  return {
    id: generateId(),
    type: 'freedraw',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    points: [],
    pressures: [],
    ...overrides,
  };
}

/** Create a new FrameElement with defaults. */
export function createFrame(
  overrides: Partial<FrameElement> = {},
): FrameElement {
  return {
    id: generateId(),
    type: 'frame',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    name: 'Frame',
    clipContent: true,
    ...overrides,
  };
}

/** Create a new ImageElement with defaults. */
export function createImage(
  overrides: Partial<ImageElement> = {},
): ImageElement {
  return {
    id: generateId(),
    type: 'image',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    assetId: '',
    naturalWidth: 100,
    naturalHeight: 100,
    crop: null,
    ...overrides,
  };
}

/** Create a new PathElement with defaults. */
export function createPath(
  overrides: Partial<PathElement> = {},
): PathElement {
  return {
    id: generateId(),
    type: 'path',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: defaultFillStyle,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    segments: [],
    closed: false,
    ...overrides,
  };
}