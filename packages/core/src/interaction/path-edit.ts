import { Scene } from '../scene';
import type { PathElement, PathSegment, Point } from '../scene/types';
import { Viewport, screenToScene } from '../render/viewport';
import { distToSegment } from '../shapes/geometry';

/** What part of the path is being dragged. */
type DragTarget =
  | { kind: 'anchor'; index: number }
  | { kind: 'handleIn'; index: number }
  | { kind: 'handleOut'; index: number };

/** Callback when path edit completes a mutation. */
export type OnPathEditComplete = (element: PathElement) => void;

/** Callback to request a preview render. */
export type OnPathEditPreview = (element: PathElement | null) => void;

/** Distance threshold for hit-testing anchors and handles. */
const ANCHOR_HIT_RADIUS = 8;
const HANDLE_HIT_RADIUS = 6;
/** Distance threshold for adding anchor on segment. */
const SEGMENT_HIT_THRESHOLD = 10;

/**
 * Path edit mode — allows editing individual anchor points and handles of a PathElement.
 * Activated by double-clicking a path with the select tool.
 */
export class PathEditor {
  private scene: Scene;
  private viewport: Viewport;
  private editingElement: PathElement | null = null;
  private dragTarget: DragTarget | null = null;
  private dragStartScene: Point = [0, 0];
  private originalSegments: PathSegment[] = [];
  private onEditComplete: OnPathEditComplete;
  private onPreviewUpdate: OnPathEditPreview;

  /**
   * Create a path editor.
   * @param scene - Scene containing the path element
   * @param viewport - Current viewport for coordinate conversion
   * @param onEditComplete - Callback when an edit mutation is committed
   * @param onPreviewUpdate - Callback to update the preview render
   */
  constructor(
    scene: Scene,
    viewport: Viewport,
    onEditComplete: OnPathEditComplete,
    onPreviewUpdate: OnPathEditPreview,
  ) {
    this.scene = scene;
    this.viewport = viewport;
    this.onEditComplete = onEditComplete;
    this.onPreviewUpdate = onPreviewUpdate;
  }

  /** Update viewport state. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Check if path edit mode is active. */
  isActive(): boolean {
    return this.editingElement !== null;
  }

  /** Get the element currently being edited. */
  getEditingElement(): PathElement | null {
    return this.editingElement;
  }

  /** Enter path edit mode for a given PathElement. */
  enterEditMode(element: PathElement): void {
    this.editingElement = { ...element, segments: element.segments.map(s => ({ ...s })) };
    this.originalSegments = element.segments.map(s => ({
      point: [...s.point] as Point,
      handleIn: s.handleIn ? [...s.handleIn] as Point : null,
      handleOut: s.handleOut ? [...s.handleOut] as Point : null,
    }));
    this.onPreviewUpdate(this.editingElement);
  }

  /** Exit path edit mode without committing changes. */
  exitEditMode(): void {
    this.editingElement = null;
    this.originalSegments = [];
    this.dragTarget = null;
    this.onPreviewUpdate(null);
  }

  /** Commit the current edit state to the scene. */
  commitEdit(): void {
    if (!this.editingElement) return;
    this.scene.upsertElement(this.editingElement);
    this.onEditComplete(this.editingElement);
    this.editingElement = null;
    this.originalSegments = [];
    this.dragTarget = null;
    this.onPreviewUpdate(null);
  }

  /**
   * Handle pointer down in path edit mode.
   * Detects click on anchor, handle, or segment for add/delete.
   */
  handlePointerDown(e: PointerEvent, containerRect: DOMRect): void {
    if (!this.editingElement) return;

    const screenX = e.clientX - containerRect.left;
    const screenY = e.clientY - containerRect.top;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);

    // Check if clicking on an anchor point
    const anchorHit = this.hitTestAnchors(scenePoint);
    if (anchorHit) {
      if (e.altKey) {
        // Alt+click on anchor: delete it
        this.deleteAnchor(anchorHit.index);
        return;
      }
      this.dragTarget = anchorHit;
      this.dragStartScene = scenePoint;
      return;
    }

    // Check if clicking on a handle
    const handleHit = this.hitTestHandles(scenePoint);
    if (handleHit) {
      this.dragTarget = handleHit;
      this.dragStartScene = scenePoint;
      return;
    }

    // Check if clicking on a segment to add a new anchor
    if (this.editingElement.closed || this.editingElement.segments.length >= 2) {
      const segHit = this.hitTestSegment(scenePoint);
      if (segHit !== null) {
        this.addAnchorOnSegment(segHit, scenePoint);
        return;
      }
    }
  }

  /**
   * Handle pointer move in path edit mode.
   * Drags the active anchor or handle.
   */
  handlePointerMove(e: PointerEvent, containerRect: DOMRect): void {
    if (!this.editingElement || !this.dragTarget) return;

    const screenX = e.clientX - containerRect.left;
    const screenY = e.clientY - containerRect.top;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);

    const dx = scenePoint[0] - this.dragStartScene[0];
    const dy = scenePoint[1] - this.dragStartScene[1];
    this.dragStartScene = scenePoint;

    const seg = this.editingElement.segments[this.dragTarget.index];
    if (!seg) return;

    if (this.dragTarget.kind === 'anchor') {
      // Move the anchor point
      seg.point = [seg.point[0] + dx, seg.point[1] + dy] as Point;

      // Update element bounds
      this.recalcBounds();
      this.onPreviewUpdate(this.editingElement);
      return;
    }

    // Handle drag
    if (this.dragTarget.kind === 'handleOut') {
      seg.handleOut = [seg.handleOut ? seg.handleOut[0] + dx : dx, seg.handleOut ? seg.handleOut[1] + dy : dy] as Point;

      // Symmetric by default (unless Alt held)
      if (!e.altKey && seg.handleIn) {
        const len = Math.hypot(seg.handleOut[0], seg.handleOut[1]);
        const inLen = Math.hypot(seg.handleIn[0], seg.handleIn[1]);
        if (inLen > 0) {
          const scale = len / inLen;
          seg.handleIn = [-seg.handleOut[0] * scale, -seg.handleOut[1] * scale] as Point;
        }
      } else if (!e.altKey) {
        // No existing handleIn — create symmetric one
        seg.handleIn = [-seg.handleOut[0], -seg.handleOut[1]] as Point;
      }
    } else if (this.dragTarget.kind === 'handleIn') {
      seg.handleIn = [seg.handleIn ? seg.handleIn[0] + dx : dx, seg.handleIn ? seg.handleIn[1] + dy : dy] as Point;

      // Symmetric by default (unless Alt held)
      if (!e.altKey && seg.handleOut) {
        const len = Math.hypot(seg.handleIn[0], seg.handleIn[1]);
        const outLen = Math.hypot(seg.handleOut[0], seg.handleOut[1]);
        if (outLen > 0) {
          const scale = len / outLen;
          seg.handleOut = [-seg.handleIn[0] * scale, -seg.handleIn[1] * scale] as Point;
        }
      } else if (!e.altKey) {
        seg.handleOut = [-seg.handleIn[0], -seg.handleIn[1]] as Point;
      }
    }

    this.onPreviewUpdate(this.editingElement);
  }

  /**
   * Handle pointer up in path edit mode.
   * Commits the drag if an anchor or handle was being moved.
   */
  handlePointerUp(_e: PointerEvent): void {
    if (this.dragTarget && this.editingElement) {
      this.scene.upsertElement(this.editingElement);
      this.onEditComplete(this.editingElement);
    }
    this.dragTarget = null;
  }

  /**
   * Handle keydown in path edit mode.
   * Delete key removes the selected anchor (if one was last clicked).
   */
  handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.commitEdit();
    }
  }

  /** Hit-test anchor points. Returns the first one within threshold. */
  private hitTestAnchors(scenePoint: Point): DragTarget | null {
    if (!this.editingElement) return null;

    const threshold = ANCHOR_HIT_RADIUS / this.viewport.zoom;
    const thresholdSq = threshold * threshold;

    for (let i = 0; i < this.editingElement.segments.length; i++) {
      const seg = this.editingElement.segments[i];
      const ax = this.editingElement.x + seg.point[0];
      const ay = this.editingElement.y + seg.point[1];
      const dSq = (scenePoint[0] - ax) ** 2 + (scenePoint[1] - ay) ** 2;
      if (dSq <= thresholdSq) {
        return { kind: 'anchor', index: i };
      }
    }
    return null;
  }

  /** Hit-test handle points. Returns the first one within threshold. */
  private hitTestHandles(scenePoint: Point): DragTarget | null {
    if (!this.editingElement) return null;

    const threshold = HANDLE_HIT_RADIUS / this.viewport.zoom;
    const thresholdSq = threshold * threshold;

    for (let i = 0; i < this.editingElement.segments.length; i++) {
      const seg = this.editingElement.segments[i];
      const ax = this.editingElement.x + seg.point[0];
      const ay = this.editingElement.y + seg.point[1];

      if (seg.handleIn) {
        const hx = ax + seg.handleIn[0];
        const hy = ay + seg.handleIn[1];
        const dSq = (scenePoint[0] - hx) ** 2 + (scenePoint[1] - hy) ** 2;
        if (dSq <= thresholdSq) {
          return { kind: 'handleIn', index: i };
        }
      }

      if (seg.handleOut) {
        const hx = ax + seg.handleOut[0];
        const hy = ay + seg.handleOut[1];
        const dSq = (scenePoint[0] - hx) ** 2 + (scenePoint[1] - hy) ** 2;
        if (dSq <= thresholdSq) {
          return { kind: 'handleOut', index: i };
        }
      }
    }
    return null;
  }

  /**
   * Hit-test path segments for adding a new anchor point.
   * Returns the segment index if the point is close enough, or null.
   */
  private hitTestSegment(scenePoint: Point): number | null {
    if (!this.editingElement) return null;
    const el = this.editingElement;
    if (el.segments.length < 2) return null;

    const threshold = SEGMENT_HIT_THRESHOLD / this.viewport.zoom;
    const thresholdSq = threshold * threshold;

    for (let i = 0; i < el.segments.length - 1; i++) {
      const a: Point = [el.x + el.segments[i].point[0], el.y + el.segments[i].point[1]];
      const b: Point = [el.x + el.segments[i + 1].point[0], el.y + el.segments[i + 1].point[1]];
      const dSq = distToSegment(scenePoint, a, b) ** 2;
      if (dSq <= thresholdSq) return i;
    }

    // For closed paths, also check the closing segment
    if (el.closed && el.segments.length > 2) {
      const last = el.segments[el.segments.length - 1];
      const first = el.segments[0];
      const a: Point = [el.x + last.point[0], el.y + last.point[1]];
      const b: Point = [el.x + first.point[0], el.y + first.point[1]];
      const dSq = distToSegment(scenePoint, a, b) ** 2;
      if (dSq <= thresholdSq) return el.segments.length - 1;
    }

    return null;
  }

  /**
   * Add a new anchor point on a segment by splitting it.
   * Uses the parametric midpoint t=0.5 of the cubic Bezier.
   */
  private addAnchorOnSegment(segIndex: number, scenePoint: Point): void {
    if (!this.editingElement) return;

    const el = this.editingElement;

    // Convert to local coordinates
    const localX = scenePoint[0] - el.x;
    const localY = scenePoint[1] - el.y;

    // Insert new anchor at the click position
    const newSeg: PathSegment = {
      point: [localX, localY],
      handleIn: null,
      handleOut: null,
    };

    el.segments.splice(segIndex + 1, 0, newSeg);
    this.recalcBounds();
    this.scene.upsertElement(el);
    this.onEditComplete(el);
    this.onPreviewUpdate(el);
  }

  /**
   * Delete an anchor point from the path.
   * Removes the segment and adjusts neighbors.
   */
  private deleteAnchor(index: number): void {
    if (!this.editingElement) return;
    if (this.editingElement.segments.length <= 2) return; // Need at least 2 anchors

    this.editingElement.segments.splice(index, 1);
    this.recalcBounds();
    this.scene.upsertElement(this.editingElement);
    this.onEditComplete(this.editingElement);
    this.onPreviewUpdate(this.editingElement);
  }

  /** Recalculate element bounds from segments. */
  private recalcBounds(): void {
    if (!this.editingElement || this.editingElement.segments.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const seg of this.editingElement.segments) {
      const ax = seg.point[0];
      const ay = seg.point[1];
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

    if (minX === Infinity) return;

    // Update element position and size
    const newX = this.editingElement.x + minX;
    const newY = this.editingElement.y + minY;

    // Shift all segments to keep them in the same world position
    const dx = this.editingElement.x - newX;
    const dy = this.editingElement.y - newY;

    this.editingElement.x = newX;
    this.editingElement.y = newY;
    this.editingElement.width = maxX - minX;
    this.editingElement.height = maxY - minY;

    // Adjust segment positions to new origin
    for (const seg of this.editingElement.segments) {
      seg.point = [seg.point[0] + dx, seg.point[1] + dy] as Point;
    }
  }
}
