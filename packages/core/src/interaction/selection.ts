import { Scene, Element } from '../scene';
import { Viewport, screenToScene } from '../render/viewport';
import type { Bounds } from '../shapes/geometry';
import { hitTestElement, getElementBounds } from '../shapes';
import { getOutermostGroupId, getGroupMembers } from '../scene/group-actions';
import { releaseFrameChildrenOnDelete } from '../scene/frame-actions';

/** Selection state for the selection manager. */
export interface SelectionState {
  selectedElementIds: Set<string>;
  rubberBand: { startX: number; startY: number; endX: number; endY: number } | null;
  isDragging: boolean;
  /** When set, individual members of this group can be selected (entered via double-click). */
  editingGroupId: string | null;
}

/** Callback when selection changes. */
export type OnSelectionChange = (state: SelectionState) => void;

/**
 * Query elements that overlap with the given bounds.
 * Uses spatial grid for coarse filtering, then fine-grained bounds check.
 * @param scene - Scene to query
 * @param bounds - Bounds to check overlap against
 * @returns Array of elements that overlap with bounds
 */
export function queryElementsInBounds(scene: Scene, bounds: Bounds): Element[] {
  const grid = scene.getSpatialGrid();
  const candidateIds = grid.queryBounds(bounds);
  const results: Element[] = [];

  for (const id of candidateIds) {
    const el = scene.getElement(id);
    if (el && !el.isDeleted && !el.hidden) {
      const elBounds = getElementBounds(el);
      if (boundsOverlap(bounds, elBounds)) {
        results.push(el);
      }
    }
  }
  return results;
}

/** Check if two bounding boxes overlap. */
export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Selection manager for click, multi-select, and rubber-band selection. */
export class SelectionManager {
  private scene: Scene;
  private viewport: Viewport;
  private state: SelectionState = {
    selectedElementIds: new Set(),
    rubberBand: null,
    isDragging: false,
    editingGroupId: null,
  };
  private onSelectionChange: OnSelectionChange;

  /**
   * Create a selection manager.
   * @param scene - Scene to select elements from
   * @param viewport - Current viewport for coordinate conversion
   * @param onSelectionChange - Callback when selection state changes
   */
  constructor(scene: Scene, viewport: Viewport, onSelectionChange: OnSelectionChange) {
    this.scene = scene;
    this.viewport = viewport;
    this.onSelectionChange = onSelectionChange;
  }

  /** Update viewport state. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Get current selection state. */
  getState(): Readonly<SelectionState> {
    return this.state;
  }

  /** Get selected element IDs. */
  getSelectedIds(): Set<string> {
    return new Set(this.state.selectedElementIds);
  }

  /** Check if an element is selected. */
  isSelected(id: string): boolean {
    return this.state.selectedElementIds.has(id);
  }

  /** Set selection to a specific set of element IDs. */
  setSelection(ids: Set<string>): void {
    this.state.selectedElementIds = new Set(ids);
    this.notifyChange();
  }

  /** Clear all selections. */
  clearSelection(): void {
    this.state.selectedElementIds.clear();
    this.notifyChange();
  }

  /** Toggle selection of an element. */
  toggleSelection(id: string): void {
    if (this.state.selectedElementIds.has(id)) {
      this.state.selectedElementIds.delete(id);
    } else {
      this.state.selectedElementIds.add(id);
    }
    this.notifyChange();
  }

  /** Add an element to selection. */
  addToSelection(id: string): void {
    this.state.selectedElementIds.add(id);
    this.notifyChange();
  }

  /** Remove an element from selection. */
  removeFromSelection(id: string): void {
    this.state.selectedElementIds.delete(id);
    this.notifyChange();
  }

  /**
   * Enter group editing mode for a specific group.
   * While in this mode, individual members of the group can be selected.
   * @param groupId - The group ID to edit within
   */
  enterGroupEditingMode(groupId: string): void {
    this.state.editingGroupId = groupId;
    this.notifyChange();
  }

  /**
   * Exit group editing mode (return to normal selection where groups are selected as a whole).
   */
  exitGroupEditingMode(): void {
    this.state.editingGroupId = null;
    this.notifyChange();
  }

  /** Find element at a scene point, searching from top to bottom (z-order).
   *  Returns the outermost group member if the hit element is grouped
   *  (unless we're in group editing mode for that group).
   *  Skips hidden and locked elements. */
  hitTest(px: number, py: number): Element | null {
    const grid = this.scene.getSpatialGrid();
    // Use a tiny bounds around the point for grid query
    const pointBounds: Bounds = { minX: px, minY: py, maxX: px, maxY: py };
    const candidateIds = grid.queryBounds(pointBounds);
    const candidates: Element[] = [];

    for (const id of candidateIds) {
      const el = this.scene.getElement(id);
      if (el && !el.isDeleted && !el.locked && !el.hidden) {
        candidates.push(el);
      }
    }

    // Sort by z-order (elementOrder index ascending), then search top-down.
    // Grid query order is spatial, not z-order — without this, overlapping
    // picks return an arbitrary element instead of the topmost one.
    const order = this.scene.getElementOrder();
    const orderIndex = new Map<string, number>();
    for (let i = 0; i < order.length; i++) orderIndex.set(order[i], i);
    candidates.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    // Search from top to bottom (last in z-order = top)
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (hitTestElement(px, py, candidates[i])) {
        const hitEl = candidates[i];
        // If the element is grouped, return the outermost group member instead
        // UNLESS we're in group editing mode for this specific group
        const outerGroupId = getOutermostGroupId(this.scene, hitEl.id);
        if (outerGroupId) {
          if (this.state.editingGroupId === outerGroupId) {
            // In group editing mode: return the individual element
            return hitEl;
          }
          // Not in editing mode: return the hit element (selection logic will handle group)
          return hitEl;
        }
        return hitEl;
      }
    }
    return null;
  }

  /** Start rubber-band selection. */
  startRubberBand(screenX: number, screenY: number): void {
    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    this.state.rubberBand = {
      startX: scenePoint[0],
      startY: scenePoint[1],
      endX: scenePoint[0],
      endY: scenePoint[1],
    };
    this.notifyChange();
  }

  /** Update rubber-band selection endpoint. */
  updateRubberBand(screenX: number, screenY: number): void {
    if (!this.state.rubberBand) return;
    const scenePoint = screenToScene([screenX, screenY], this.viewport);
    this.state.rubberBand.endX = scenePoint[0];
    this.state.rubberBand.endY = scenePoint[1];
    this.notifyChange();
  }

  /**
   * Finish rubber-band selection and select overlapping elements.
   * @param additive - If true (shift held), add to existing selection instead of replacing
   */
  finishRubberBand(additive: boolean = false): void {
    if (!this.state.rubberBand) return;
    const rb = this.state.rubberBand;
    const bounds: Bounds = {
      minX: Math.min(rb.startX, rb.endX),
      minY: Math.min(rb.startY, rb.endY),
      maxX: Math.max(rb.startX, rb.endX),
      maxY: Math.max(rb.startY, rb.endY),
    };

    const elements = queryElementsInBounds(this.scene, bounds);
    if (!additive) {
      this.state.selectedElementIds.clear();
    }
    for (const el of elements) {
      this.state.selectedElementIds.add(el.id);
    }
    this.state.rubberBand = null;
    this.notifyChange();
  }

  /** Cancel rubber-band selection without selecting anything. */
  cancelRubberBand(): void {
    this.state.rubberBand = null;
    this.notifyChange();
  }

  /** Delete selected elements (soft-delete). Skips locked elements.
   *  If any frames are deleted, their children are released first (Figma convention). */
  deleteSelected(): void {
    // Release children of any frames being deleted
    for (const id of this.state.selectedElementIds) {
      const el = this.scene.getElement(id);
      if (el && el.type === 'frame' && !el.locked) {
        releaseFrameChildrenOnDelete(this.scene, id);
      }
    }

    // Route through Scene.deleteElement (canonical path: version bump,
    // grid removal, afterUpsert hook, single mutation each).
    for (const id of this.state.selectedElementIds) {
      const el = this.scene.getElement(id);
      if (el && !el.locked && !el.isDeleted) {
        this.scene.deleteElement(id);
      }
    }
    this.state.selectedElementIds.clear();
    this.notifyChange();
  }

  /** Nudge selected elements by (dx, dy) in scene coordinates. Skips locked elements. */
  nudgeSelected(dx: number, dy: number): void {
    for (const id of this.state.selectedElementIds) {
      const el = this.scene.getElement(id);
      if (el && !el.locked) {
        this.scene.upsertElement({ ...el, x: el.x + dx, y: el.y + dy });
      }
    }
    this.notifyChange();
  }

  /** Add an element to selection. If grouped, selects all group members. */
  addToSelectionWithGroup(id: string): void {
    const outerGroupId = getOutermostGroupId(this.scene, id);
    if (outerGroupId) {
      const members = getGroupMembers(this.scene, id);
      for (const memberId of members) {
        this.state.selectedElementIds.add(memberId);
      }
    } else {
      this.state.selectedElementIds.add(id);
    }
    this.notifyChange();
  }

  private notifyChange(): void {
    this.onSelectionChange({ ...this.state, selectedElementIds: new Set(this.state.selectedElementIds) });
  }
}
