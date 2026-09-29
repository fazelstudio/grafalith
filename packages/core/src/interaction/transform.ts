import { Scene, Element } from '../scene';
import type { TextElement, PathElement, PathSegment, Point, FrameElement, LineElement } from '../scene/types';
import { Viewport, screenToScene } from '../render/viewport';
import { getElementBounds } from '../shapes';
import type { Bounds } from '../shapes/geometry';
import type { HandleType } from '../render/render-selection';
import { getFrameChildren } from '../scene/frame-actions';
import { applyConstraints } from './constraints';
import type { SnapConfig, SnapGuide } from './snap';
import { applySnap } from './snap';

/** Transform operation types. */
export type TransformType = 'move' | 'resize' | 'rotate';

/** Callback when transform preview updates. */
export type OnTransformPreview = (elements: Element[]) => void;

/** Callback to get snap candidate elements for the current drag position. */
export type SnapCandidateProvider = (viewport: Viewport) => Element[];

/** Internal transform state tracking a single operation. */
interface TransformState {
  type: TransformType;
  elementId: string;
  handle?: HandleType;
  /** Element state at transform start. */
  originalElement: Element;
  /** Scene-space position where the drag started. */
  anchorX: number;
  anchorY: number;
  /** Element center at transform start (for rotate). */
  centerX: number;
  centerY: number;
  /** Original rotation (for rotate). */
  startRotation: number;
  /** Original bounding box (for resize). */
  bounds: Bounds;
}

/**
 * Handle move, resize, and rotate transforms on selected elements.
 * Supports single and multi-element transforms, including rotated elements.
 *
 * Usage:
 * 1. Call the appropriate start* method on pointerdown.
 * 2. Call update* on each pointermove.
 * 3. Call finish* on pointerup to commit to scene.
 */
export class TransformHandler {
  private scene: Scene;
  private viewport: Viewport;
  private activeTransform: TransformState | null = null;
  private previewElements: Element[] = [];
  private onPreview: OnTransformPreview;
  private snapConfig: SnapConfig | null = null;
  private snapCandidateProvider: SnapCandidateProvider | null = null;
  private currentSnapGuides: SnapGuide[] = [];
  /** Original elements for multi-selection resize (excluding the primary). */
  private multiSelectOriginals: Map<string, Element> | null = null;
  /** Combined bounds of all selected elements at resize start. */
  private multiSelectStartBounds: Bounds | null = null;

  /**
   * Create a transform handler.
   * @param scene - Scene to commit transforms to
   * @param viewport - Current viewport for coordinate conversion
   * @param onPreview - Callback to request a preview render
   */
  constructor(scene: Scene, viewport: Viewport, onPreview: OnTransformPreview) {
    this.scene = scene;
    this.viewport = viewport;
    this.onPreview = onPreview;
  }

  /** Update viewport state. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Set snap configuration. Pass null to disable snapping. */
  setSnapConfig(config: SnapConfig | null): void {
    this.snapConfig = config;
  }

  /** Set the callback that provides snap candidate elements. */
  setSnapCandidateProvider(provider: SnapCandidateProvider | null): void {
    this.snapCandidateProvider = provider;
  }

  /** Check if a transform is in progress. */
  isTransforming(): boolean {
    return this.activeTransform !== null;
  }

  /** Get the current transform type, or null if no transform is active. */
  getActiveTransformType(): TransformType | null {
    return this.activeTransform?.type ?? null;
  }

  /** Get the active resize handle, or null if not resizing. */
  getActiveResizeHandle(): HandleType | null {
    if (this.activeTransform?.type === 'resize') return this.activeTransform.handle ?? null;
    return null;
  }

  /** Get the current preview elements (before commit to scene). */
  getPreviewElements(): Element[] {
    return this.previewElements;
  }

  /** Get the current snap guides for rendering on the interactive canvas. */
  getSnapGuides(): SnapGuide[] {
    return this.currentSnapGuides;
  }

  /** Compute combined bounding box of multiple elements. */
  private computeCombinedBounds(ids: Set<string>): Bounds | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
      const el = this.scene.getElement(id);
      if (!el) continue;
      const b = getElementBounds(el);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  /** Cancel the current transform and revert to original state. */
  cancelTransform(): void {
    this.activeTransform = null;
    this.previewElements = [];
    this.currentSnapGuides = [];
    this.multiSelectOriginals = null;
    this.multiSelectStartBounds = null;
  }

  /** Start a move transform. Refuses locked primary targets. */
  startMove(selectedIds: Set<string>, screenX: number, screenY: number): void {
    if (selectedIds.size === 0) return;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    const id = Array.from(selectedIds)[0];
    const el = this.scene.getElement(id);
    if (!el || el.locked || el.isDeleted) return;

    this.activeTransform = {
      type: 'move',
      elementId: id,
      originalElement: { ...el },
      anchorX: scenePoint[0],
      anchorY: scenePoint[1],
      centerX: 0,
      centerY: 0,
      startRotation: 0,
      bounds: getElementBounds(el),
    };
    this.previewElements = [];
    this.currentSnapGuides = [];
  }

  /** Update a move transform. Moves all selected elements by the delta.
   *  @param shiftKey - If true, axis-lock movement to horizontal or vertical based on dominant direction */
  updateMove(selectedIds: Set<string>, screenX: number, screenY: number, shiftKey: boolean = false): void {
    if (!this.activeTransform || this.activeTransform.type !== 'move') return;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    let dx = scenePoint[0] - this.activeTransform.anchorX;
    let dy = scenePoint[1] - this.activeTransform.anchorY;

    // Axis-lock when shift is held: constrain to dominant axis
    if (shiftKey) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        dy = 0;
      } else {
        dx = 0;
      }
    }

    // Compute raw new position for anchor element
    let rawX = this.activeTransform.originalElement.x + dx;
    let rawY = this.activeTransform.originalElement.y + dy;

    // Apply snapping if configured
    this.currentSnapGuides = [];
    if (this.snapConfig && this.snapCandidateProvider) {
      const origBounds = this.activeTransform.bounds;
      const movingWidth = origBounds.maxX - origBounds.minX;
      const movingHeight = origBounds.maxY - origBounds.minY;
      const movingBounds: Bounds = {
        minX: rawX,
        minY: rawY,
        maxX: rawX + movingWidth,
        maxY: rawY + movingHeight,
      };

      const candidates = this.snapCandidateProvider(this.viewport);
      const excludeIds = new Set(selectedIds);
      const snapResult = applySnap(
        rawX + movingWidth / 2,
        rawY + movingHeight / 2,
        movingBounds,
        this.snapConfig,
        candidates,
        excludeIds,
        this.viewport.zoom,
      );

      // Convert snapped center back to top-left
      rawX = snapResult.x - movingWidth / 2;
      rawY = snapResult.y - movingHeight / 2;
      this.currentSnapGuides = snapResult.guides;
    }

    const finalDx = rawX - this.activeTransform.originalElement.x;
    const finalDy = rawY - this.activeTransform.originalElement.y;

    this.previewElements = [];
    for (const id of selectedIds) {
      const el = this.scene.getElement(id);
      if (!el || el.locked || el.isDeleted) continue;
      const origEl = id === this.activeTransform.elementId
        ? this.activeTransform.originalElement
        : el;
      const offsetX = origEl.x - this.activeTransform.originalElement.x;
      const offsetY = origEl.y - this.activeTransform.originalElement.y;
      this.previewElements.push({
        ...el,
        x: this.activeTransform.originalElement.x + finalDx + offsetX,
        y: this.activeTransform.originalElement.y + finalDy + offsetY,
      });
    }
    this.onPreview(this.previewElements);
  }

  /** Commit move transform to scene. Also moves frame children if a frame is being moved. */
  commitMove(selectedIds: Set<string>, screenX: number, screenY: number, shiftKey: boolean = false): void {
    this.updateMove(selectedIds, screenX, screenY, shiftKey);
    this.commitPreview();

    // Move unselected frame children exactly once. Children already in the
    // selection were moved by the preview above — moving them again would
    // double the delta (data corruption on frame+child co-selection).
    const selectedSet = new Set(selectedIds);
    for (const id of selectedIds) {
      const el = this.scene.getElement(id);
      if (el && el.type === 'frame') {
        const origEl = this.activeTransform?.elementId === id
          ? this.activeTransform.originalElement
          : el;
        const ddx = el.x - origEl.x;
        const ddy = el.y - origEl.y;
        if (ddx !== 0 || ddy !== 0) {
          const children = getFrameChildren(this.scene, id);
          for (const childId of children) {
            if (selectedSet.has(childId)) continue;
            const child = this.scene.getElement(childId);
            if (child && !child.isDeleted && !child.locked) {
              this.scene.upsertElement({ ...child, x: child.x + ddx, y: child.y + ddy });
            }
          }
        }
      }
    }

    this.activeTransform = null;
    this.previewElements = [];
    this.currentSnapGuides = [];
  }

  /** Start a resize transform from a specific handle.
   *  @param elementId - Primary element being resized (determines handle position)
   *  @param handle - Which handle is being dragged
   *  @param selectedIds - All selected element IDs (for multi-selection proportional resize) */
  startResize(elementId: string, handle: HandleType, screenX: number, screenY: number, selectedIds?: Set<string>): void {
    const el = this.scene.getElement(elementId);
    if (!el || el.locked || el.isDeleted) return;

    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    const bounds = getElementBounds(el);

    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;

    this.activeTransform = {
      type: 'resize',
      elementId,
      handle,
      originalElement: { ...el },
      anchorX: scenePoint[0],
      anchorY: scenePoint[1],
      centerX: cx,
      centerY: cy,
      startRotation: el.rotation,
      bounds,
    };
    this.previewElements = [];

    // Store all selected element originals for multi-selection proportional resize
    if (selectedIds && selectedIds.size > 1) {
      this.multiSelectOriginals = new Map();
      for (const id of selectedIds) {
        const selEl = this.scene.getElement(id);
        if (selEl && id !== elementId) {
          this.multiSelectOriginals.set(id, { ...selEl });
        }
      }
      // Store the combined bounds at start
      this.multiSelectStartBounds = this.computeCombinedBounds(selectedIds);
    } else {
      this.multiSelectOriginals = null;
      this.multiSelectStartBounds = null;
    }
  }

  /** Update a resize transform. Pass shiftKey to override aspect ratio lock for images. */
  updateResize(screenX: number, screenY: number, shiftKey: boolean = false): void {
    if (!this.activeTransform || this.activeTransform.type !== 'resize') return;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    const el = this.activeTransform.originalElement;
    const handle = this.activeTransform.handle!;

    if (el.rotation === 0) {
      this.resizeNoRotation(el, handle, scenePoint, shiftKey);
    } else {
      this.resizeWithRotation(el, handle, scenePoint, shiftKey);
    }

    // Multi-selection proportional resize: scale other elements relative to combined bounds
    if (this.multiSelectOriginals && this.multiSelectStartBounds) {
      const primaryPreview = this.previewElements[0];
      if (primaryPreview) {
        const sb = this.multiSelectStartBounds;
        // Combined-box scale: how much did the whole selection bounds change?
        // Derive from primary delta mapped onto the combined box: use the
        // primary's scale factors (previews are in the same space).
        const origW = el.width;
        const origH = el.height;
        const scaleX = origW > 0 ? primaryPreview.width / origW : 1;
        const scaleY = origH > 0 ? primaryPreview.height / origH : 1;

        // New combined origin: scale the combined box around its own min
        // corner by the same factors, anchored at the primary's new position
        // relative to the combined box (not at primaryPreview.x/y directly,
        // which is only correct when the primary is at the combined min).
        const primOrig = this.activeTransform.originalElement;
        const newSbMinX = primaryPreview.x - (primOrig.x - sb.minX) * scaleX;
        const newSbMinY = primaryPreview.y - (primOrig.y - sb.minY) * scaleY;
        for (const [, origEl] of this.multiSelectOriginals) {
          // Position relative to combined bounds, then scale
          const relX = (origEl.x - sb.minX) * scaleX;
          const relY = (origEl.y - sb.minY) * scaleY;
          this.previewElements.push({
            ...origEl,
            x: newSbMinX + relX,
            y: newSbMinY + relY,
            width: origEl.width * scaleX,
            height: origEl.height * scaleY,
          });
        }
      }
    }

    this.onPreview(this.previewElements);
  }

  /** Commit resize transform to scene. Pass shiftKey to override aspect ratio lock for images. */
  commitResize(screenX: number, screenY: number, shiftKey: boolean = false): void {
    this.updateResize(screenX, screenY, shiftKey);
    this.commitPreview();

    // Apply constraints to direct children of a resized frame
    if (this.activeTransform) {
      const el = this.scene.getElement(this.activeTransform.elementId);
      if (el && el.type === 'frame') {
        this.applyFrameConstraints(
          el as FrameElement,
          this.activeTransform.originalElement,
        );
      }
    }

    this.activeTransform = null;
    this.previewElements = [];
    this.multiSelectOriginals = null;
    this.multiSelectStartBounds = null;
  }

  /** Start a rotate transform. Refuses locked targets. */
  startRotate(elementId: string, screenX: number, screenY: number): void {
    const el = this.scene.getElement(elementId);
    if (!el || el.locked || el.isDeleted) return;

    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    const bounds = getElementBounds(el);
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;

    this.activeTransform = {
      type: 'rotate',
      elementId,
      originalElement: { ...el },
      anchorX: scenePoint[0],
      anchorY: scenePoint[1],
      centerX: cx,
      centerY: cy,
      startRotation: el.rotation,
      bounds,
    };
    this.previewElements = [];
  }

  /** Update a rotate transform. */
  updateRotate(screenX: number, screenY: number, shiftKey: boolean): void {
    if (!this.activeTransform || this.activeTransform.type !== 'rotate') return;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    const el = this.activeTransform.originalElement;
    const cx = this.activeTransform.centerX;
    const cy = this.activeTransform.centerY;

    const angle = Math.atan2(scenePoint[1] - cy, scenePoint[0] - cx);
    const startAngle = Math.atan2(this.activeTransform.anchorY - cy, this.activeTransform.anchorX - cx);
    let newRotation = el.rotation + (angle - startAngle);

    if (shiftKey) {
      const snap = Math.PI / 12;
      newRotation = Math.round(newRotation / snap) * snap;
    }

    while (newRotation > Math.PI) newRotation -= 2 * Math.PI;
    while (newRotation < -Math.PI) newRotation += 2 * Math.PI;

    this.previewElements = [{ ...el, rotation: newRotation }];
    this.onPreview(this.previewElements);
  }

  /** Commit rotate transform to scene. */
  commitRotate(screenX: number, screenY: number, shiftKey: boolean): void {
    this.updateRotate(screenX, screenY, shiftKey);
    this.commitPreview();
    this.activeTransform = null;
    this.previewElements = [];
  }

  /** Resize without rotation — simple axis-aligned, opposite corner anchored. */
  private resizeNoRotation(el: Element, handle: HandleType, point: Point, shiftKey: boolean): void {
    const orig = this.activeTransform!.originalElement;
    const r = computeAxisAlignedResize(orig.x, orig.y, orig.width, orig.height, handle, point, shiftKey);

    // Text elements: scale font-size proportionally to the resize (TLDraw convention).
    // This decision is documented here per Phase 19 §C spec requirement.
    // Side-only drags use min(scaleX, scaleY), so pure widening may not change font.
    const finalW = Math.max(1, r.newW);
    const finalH = Math.max(1, r.newH);
    const previewEl: Element = { ...el, x: r.newX, y: r.newY, width: finalW, height: finalH };
    this.applyProportionalContentScaling(el, previewEl, finalW, finalH);
    this.previewElements = [previewEl];
  }

  /** Scale text font-size, path segments, and line/arrow/freedraw points. */
  private applyProportionalContentScaling(el: Element, previewEl: Element, finalW: number, finalH: number): void {
    if (el.type === 'text') {
      const textEl = el as TextElement;
      const scaleX = el.width > 0 ? finalW / el.width : 1;
      const scaleY = el.height > 0 ? finalH / el.height : 1;
      const scale = Math.min(scaleX, scaleY);
      (previewEl as TextElement).fontSize = Math.max(8, Math.round(textEl.fontSize * scale));
    }
    // Path elements: scale segments proportionally
    if (el.type === 'path') {
      const pathEl = el as PathElement;
      const scaleX = el.width > 0 ? finalW / el.width : 1;
      const scaleY = el.height > 0 ? finalH / el.height : 1;
      (previewEl as PathElement).segments = scalePathSegments(pathEl.segments, scaleX, scaleY);
    }
    // Line/arrow/freedraw: points are relative to (x, y); scale them so the
    // visual geometry follows width/height (previously a no-op: metadata
    // changed but pixels and points-derived bounds did not move).
    if (el.type === 'line' || el.type === 'arrow' || el.type === 'freedraw') {
      const scaleX = el.width > 0 ? finalW / el.width : 1;
      const scaleY = el.height > 0 ? finalH / el.height : 1;
      const pts = (el as LineElement).points as Point[] | undefined;
      if (Array.isArray(pts)) {
        const scaled = pts.map(([px, py]) => [px * scaleX, py * scaleY] as Point);
        (previewEl as LineElement).points = scaled;
      }
    }
  }

  /** Resize with rotation — work in element's local coordinate space.
   *
   * Correctness rule (Phase 19 B4): resize happens RELATIVE to the element's
   * orientation with the opposite corner/edge (in local space) stationary —
   * not center-symmetric growth. Strategy: inverse-rotate the pointer into
   * the unrotated frame, run the same axis-aligned anchor logic as the
   * unrotated path (including flip + aspect lock), then rotate the resulting
   * center delta back to world space.
   */
  private resizeWithRotation(el: Element, handle: HandleType, point: Point, shiftKey: boolean): void {
    const orig = this.activeTransform!.originalElement;
    const cx = this.activeTransform!.centerX;
    const cy = this.activeTransform!.centerY;

    // Inverse-rotate pointer around the original center into unrotated frame.
    const cos = Math.cos(-orig.rotation);
    const sin = Math.sin(-orig.rotation);
    const dx = point[0] - cx;
    const dy = point[1] - cy;
    const localPoint: Point = [dx * cos - dy * sin + cx, dx * sin + dy * cos + cy];

    const r = computeAxisAlignedResize(orig.x, orig.y, orig.width, orig.height, handle, localPoint, shiftKey);
    const finalW = Math.max(1, r.newW);
    const finalH = Math.max(1, r.newH);

    // New center in unrotated frame, then rotate its delta back to world.
    // (Center is invariant under rotation, so unrotated center == world center.)
    const oldCx = orig.x + orig.width / 2;
    const oldCy = orig.y + orig.height / 2;
    // Adjust for clamping (finalW/H may differ from r.newW/H at min-size).
    const adjNewX = r.newX + (r.newW - finalW) / 2;
    const adjNewY = r.newY + (r.newH - finalH) / 2;
    const newLocalCx = adjNewX + finalW / 2;
    const newLocalCy = adjNewY + finalH / 2;
    const ddx = newLocalCx - oldCx;
    const ddy = newLocalCy - oldCy;
    const cosR = Math.cos(orig.rotation);
    const sinR = Math.sin(orig.rotation);
    const worldCx = cx + ddx * cosR - ddy * sinR;
    const worldCy = cy + ddx * sinR + ddy * cosR;

    const previewEl: Element = {
      ...el,
      x: worldCx - finalW / 2,
      y: worldCy - finalH / 2,
      width: finalW,
      height: finalH,
    };
    this.applyProportionalContentScaling(el, previewEl, finalW, finalH);
    this.previewElements = [previewEl];
  }

  /**
   * Apply constraints to direct children of a resized frame.
   * Only applies to non-auto-layout frames (auto-layout frames handle children via layout engine).
   */
  private applyFrameConstraints(frame: FrameElement, origFrame: Element): void {
    // Skip if frame has auto-layout active (constraints are ignored)
    if (frame.autoLayout) return;

    const childIds = getFrameChildren(this.scene, frame.id);
    const oldFrameBounds = getElementBounds(origFrame);
    const newFrameBounds = getElementBounds(frame);

    for (const childId of childIds) {
      const child = this.scene.getElement(childId);
      if (!child || child.isDeleted || !child.constraints) continue;

      const patch = applyConstraints(child, child.constraints, oldFrameBounds, newFrameBounds);
      this.scene.upsertElement({
        ...child,
        ...patch,
        version: child.version + 1,
        versionNonce: Math.floor(Math.random() * 2_000_000_000),
      } as Element);
    }
  }

  /** Commit preview elements to the scene via upsertElement.
   * Version bumps are centralized in Scene.upsertElement — do not pre-bump here. */
  private commitPreview(): void {
    for (const el of this.previewElements) {
      if ((el as { locked?: boolean }).locked) continue;
      this.scene.upsertElement(el);
    }
  }
}

/**
 * Axis-aligned resize with opposite corner/edge anchored and flip support.
 * Shared by the unrotated path and (via inverse-rotated pointer) the rotated
 * path, so both behave identically in local space.
 */
function computeAxisAlignedResize(
  origX: number,
  origY: number,
  origW: number,
  origH: number,
  handle: HandleType,
  point: Point,
  shiftKey: boolean,
): { newX: number; newY: number; newW: number; newH: number } {
  let newX = origX;
  let newY = origY;
  let newW = origW;
  let newH = origH;

  // Shift locks aspect ratio for ALL shapes (Figma/TLDraw convention)
  const lockAspect = shiftKey;
  const aspectRatio = origH !== 0 ? origW / origH : 1;

  if (handle.includes('right')) {
    newW = point[0] - origX;
    if (lockAspect) {
      newH = newW / aspectRatio;
    }
  }
  if (handle.includes('left')) {
    newW = origX + origW - point[0];
    newX = point[0];
    if (lockAspect) {
      newH = newW / aspectRatio;
    }
  }
  if (handle.includes('bottom')) {
    newH = point[1] - origY;
    if (lockAspect) {
      newW = newH * aspectRatio;
      if (handle.includes('left')) {
        newX = origX + origW - newW;
      }
    }
  }
  if (handle.includes('top')) {
    newH = origY + origH - point[1];
    newY = point[1];
    if (lockAspect) {
      newW = newH * aspectRatio;
      if (handle.includes('left')) {
        newX = origX + origW - newW;
      }
    }
  }

  // Flip behavior: if dragged past opposite edge, flip orientation
  // (width/height stay positive, position flips to opposite corner)
  if (newW < 0) {
    newX = newX + newW;
    newW = Math.abs(newW);
  }
  if (newH < 0) {
    newY = newY + newH;
    newH = Math.abs(newH);
  }

  return { newX, newY, newW, newH };
}

/** Scale path segments by the given factors (for resize). */
function scalePathSegments(segments: PathSegment[], scaleX: number, scaleY: number): PathSegment[] {
  return segments.map(seg => ({
    point: [seg.point[0] * scaleX, seg.point[1] * scaleY] as Point,
    handleIn: seg.handleIn
      ? [seg.handleIn[0] * scaleX, seg.handleIn[1] * scaleY] as Point
      : null,
    handleOut: seg.handleOut
      ? [seg.handleOut[0] * scaleX, seg.handleOut[1] * scaleY] as Point
      : null,
  }));
}
