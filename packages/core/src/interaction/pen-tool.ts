import { Scene } from '../scene';
import type { PathElement, PathSegment, Point } from '../scene/types';
import { Viewport, screenToScene } from '../render/viewport';

/** Pen tool states. */
type PenState = 'idle' | 'drawing';

/** Callback when path creation completes. */
export type OnPathCreated = (element: PathElement) => void;

/** Callback to request preview render. */
export type OnPreviewUpdate = (element: PathElement | null) => void;

/** Distance threshold (in scene coords) to detect click on first anchor for closing. */
const CLOSE_THRESHOLD = 12;

/**
 * State machine for creating vector paths via multi-click pen tool.
 * Each click adds an anchor point; click-drag adds a smooth point with handles.
 */
export class PenTool {
  private scene: Scene;
  private viewport: Viewport;
  private state: PenState = 'idle';
  private segments: PathSegment[] = [];
  private currentElement: PathElement | null = null;
  private onPathCreated: OnPathCreated;
  private onPreviewUpdate: OnPreviewUpdate;
  /** Whether a drag is in progress (to distinguish click vs click-drag). */
  private isDragging = false;
  /** Pointer down position for detecting drag. */
  private dragStartScreen: Point = [0, 0];
  /** Accumulated path ID for the current creation session. */
  private pathId: string = '';

  /**
   * Create a new pen tool.
   * @param scene - Scene to add the final path to
   * @param viewport - Current viewport for coordinate conversion
   * @param onPathCreated - Callback when a path is finalized
   * @param onPreviewUpdate - Callback when the preview element changes
   */
  constructor(
    scene: Scene,
    viewport: Viewport,
    onPathCreated: OnPathCreated,
    onPreviewUpdate: OnPreviewUpdate,
  ) {
    this.scene = scene;
    this.viewport = viewport;
    this.onPathCreated = onPathCreated;
    this.onPreviewUpdate = onPreviewUpdate;
  }

  /** Update viewport state. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Check if the pen tool is actively drawing a path. */
  isActive(): boolean {
    return this.state === 'drawing';
  }

  /** Get the current preview element being drawn. */
  getPreviewElement(): PathElement | null {
    return this.currentElement;
  }

  /**
   * Handle pointer down event.
   * Starts a new segment or closes the path if clicking near the first anchor.
   */
  handlePointerDown(e: PointerEvent, containerRect: DOMRect): void {
    const screenX = e.clientX - containerRect.left;
    const screenY = e.clientY - containerRect.top;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);

    if (this.state === 'idle') {
      // Start a new path
      this.pathId = `path-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.segments = [];
      this.state = 'drawing';
    }

    this.isDragging = false;
    this.dragStartScreen = [screenX, screenY];

    // Check if clicking near the first anchor to close the path
    if (this.segments.length > 2) {
      const firstAnchor = this.segments[0].point;
      const firstWorld: Point = [this.getWorldX() + firstAnchor[0], this.getWorldY() + firstAnchor[1]];
      const dist = Math.hypot(scenePoint[0] - firstWorld[0], scenePoint[1] - firstWorld[1]);
      if (dist < CLOSE_THRESHOLD) {
        this.finishPath(true);
        return;
      }
    }

    // Add new anchor point (sharp by default, handles set on drag)
    const localX = scenePoint[0] - this.getWorldX();
    const localY = scenePoint[1] - this.getWorldY();

    this.segments.push({
      point: [localX, localY],
      handleIn: null,
      handleOut: null,
    });

    this.updatePreview();
  }

  /**
   * Handle pointer move event.
   * If dragging, updates the handle of the current anchor point.
   */
  handlePointerMove(e: PointerEvent, containerRect: DOMRect): void {
    if (this.state !== 'idle' || this.segments.length === 0) {
      if (this.state === 'idle') return;
    }

    const screenX = e.clientX - containerRect.left;
    const screenY = e.clientY - containerRect.top;

    // Detect drag (threshold: 3px)
    const dx = screenX - this.dragStartScreen[0];
    const dy = screenY - this.dragStartScreen[1];
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      this.isDragging = true;
    }

    if (this.isDragging && this.segments.length > 0) {
      const scenePoint = screenToScene([screenX, screenY], this.viewport);
      const lastSeg = this.segments[this.segments.length - 1];

      // Handle is relative to anchor, in the direction opposite to drag
      const handleX = this.getWorldX() + lastSeg.point[0] - scenePoint[0];
      const handleY = this.getWorldY() + lastSeg.point[1] - scenePoint[1];

      // Symmetric handles: handleOut = drag direction, handleIn = opposite
      lastSeg.handleOut = [-handleX, -handleY];
      lastSeg.handleIn = [handleX, handleY];

      this.updatePreview();
    }
  }

  /**
   * Handle pointer up event.
   * If no drag occurred, the anchor is a sharp corner (handles remain null).
   */
  handlePointerUp(_e: PointerEvent): void {
    // The drag state is already captured in handlePointerMove
    this.isDragging = false;
  }

  /**
   * Handle double-click to finish the current open path.
   */
  handleDoubleClick(_e: PointerEvent): void {
    if (this.state === 'drawing' && this.segments.length >= 2) {
      // Remove the last segment added by the second click of the double-click
      this.segments.pop();
      this.finishPath(false);
    }
  }

  /**
   * Handle keydown event for finishing/canceling path.
   * Enter/Escape finish the path; Escape with 0-1 segments cancels.
   */
  handleKeyDown(e: KeyboardEvent): void {
    if (this.state !== 'drawing') return;

    if (e.key === 'Enter') {
      this.finishPath(false);
    } else if (e.key === 'Escape') {
      if (this.segments.length <= 1) {
        this.cancelPath();
      } else {
        this.finishPath(false);
      }
    }
  }

  /** Cancel the current path creation without adding to scene. */
  cancelPath(): void {
    this.state = 'idle';
    this.segments = [];
    this.currentElement = null;
    this.pathId = '';
    this.onPreviewUpdate(null);
  }

  /** Finish the current path and commit to scene. */
  private finishPath(closed: boolean): void {
    if (this.segments.length < 2) {
      this.cancelPath();
      return;
    }

    const element = this.buildPathElement(closed);
    this.scene.upsertElement(element);
    this.onPathCreated(element);

    this.state = 'idle';
    this.segments = [];
    this.currentElement = null;
    this.pathId = '';
    this.onPreviewUpdate(null);
  }

  /** Build a PathElement from the current segments. */
  private buildPathElement(closed: boolean): PathElement {
    const bounds = this.computeBounds();
    const el: PathElement = {
      id: this.pathId,
      type: 'path',
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      rotation: 0,
      strokeColor: '#000000',
      backgroundColor: { type: 'solid', color: 'transparent' },
      strokeWidth: 2,
      strokeStyle: 'solid',
      fillStyle: 'solid',
      opacity: 100,
      seed: Math.floor(Math.random() * 2_000_000_000),
      version: 0,
      versionNonce: Math.floor(Math.random() * 2_000_000_000),
      isDeleted: false,
      groupIds: [],
      locked: false,
      hidden: false,
      frameId: null,
      segments: this.segments.map(s => ({
        point: [s.point[0] - bounds.minX, s.point[1] - bounds.minY] as Point,
        handleIn: s.handleIn ? [...s.handleIn] as Point : null,
        handleOut: s.handleOut ? [...s.handleOut] as Point : null,
      })),
      closed,
    };
    return el;
  }

  /** Compute bounding box from current segments (in world coordinates). */
  private computeBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    if (this.segments.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    const wx = this.getWorldX();
    const wy = this.getWorldY();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const seg of this.segments) {
      const ax = wx + seg.point[0];
      const ay = wy + seg.point[1];
      if (ax < minX) minX = ax;
      if (ay < minY) minY = ay;
      if (ax > maxX) maxX = ax;
      if (ay > maxY) maxY = ay;

      if (seg.handleIn) {
        const hix = ax + seg.handleIn[0];
        const hiy = ay + seg.handleIn[1];
        if (hix < minX) minX = hix;
        if (hiy < minY) minY = hiy;
        if (hix > maxX) maxX = hix;
        if (hiy > maxY) maxY = hiy;
      }
      if (seg.handleOut) {
        const hox = ax + seg.handleOut[0];
        const hoy = ay + seg.handleOut[1];
        if (hox < minX) minX = hox;
        if (hoy < minY) minY = hoy;
        if (hox > maxX) maxX = hox;
        if (hoy > maxY) maxY = hoy;
      }
    }

    return { minX, minY, maxX, maxY };
  }

  /** Get the world X of the first segment anchor (path element origin). */
  private getWorldX(): number {
    if (this.segments.length === 0) return 0;
    // The element x will be the min X of all anchors — use first anchor as reference
    // during creation, adjust at finish
    return 0;
  }

  /** Get the world Y of the first segment anchor. */
  private getWorldY(): number {
    if (this.segments.length === 0) return 0;
    return 0;
  }

  /** Update the preview element. */
  private updatePreview(): void {
    if (this.segments.length === 0) {
      this.currentElement = null;
      this.onPreviewUpdate(null);
      return;
    }

    const bounds = this.computeBounds();
    this.currentElement = {
      id: this.pathId,
      type: 'path',
      x: bounds.minX,
      y: bounds.minY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      rotation: 0,
      strokeColor: '#000000',
      backgroundColor: { type: 'solid', color: 'transparent' },
      strokeWidth: 2,
      strokeStyle: 'solid',
      fillStyle: 'solid',
      opacity: 100,
      seed: 0,
      version: 0,
      versionNonce: 0,
      isDeleted: false,
      groupIds: [],
      locked: false,
      hidden: false,
      frameId: null,
      segments: this.segments.map(s => ({
        point: [s.point[0] - bounds.minX, s.point[1] - bounds.minY] as Point,
        handleIn: s.handleIn ? [...s.handleIn] as Point : null,
        handleOut: s.handleOut ? [...s.handleOut] as Point : null,
      })),
      closed: false,
    };
    this.onPreviewUpdate(this.currentElement);
  }
}
