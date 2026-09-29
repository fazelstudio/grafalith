import { Scene } from '../scene/scene';
import { Element, FillStyle, StrokeStyle, Point, InstanceElement } from '../scene/types';
import { EventEmitter } from './event-emitter';
import {
  createRectangle,
  createEllipse,
  createLine,
  createArrow,
  createText,
  createFreedraw,
  createFrame,
  createImage,
  createPath,
} from '../scene/create-element';
import { HistoryManager } from '../history/history-manager';
import { SelectionManager } from '../interaction/selection';
import { TransformHandler } from '../interaction/transform';
import { DrawTool } from '../interaction/draw-tool';
import { PanZoom } from '../interaction/pan-zoom';
import { CropHandler } from '../interaction/crop-handler';
import { TextEditor } from '../interaction/text-editor';
import { RenderLoop } from '../render/render-loop';
import { createCanvasLayers, CanvasLayers } from '../render/canvas-layers';
import { Viewport, clampZoom, screenToScene, sceneToScreen } from '../render/viewport';
import { CanvasMode, DEFAULT_CANVAS_MODE, getCanvasBounds as computeCanvasBounds } from '../render/canvas-mode';
import { FazelidrawTheme, ThemeOverride } from '../theme/types';
import { resolveTheme } from '../theme/theme-provider';
import { registerShape, ShapeDefinition, defaultShapeRegistry } from '../shapes/registry';
import { getGroupMembers, getOutermostGroupId, groupElements, ungroupElements } from '../scene/group-actions';
import { bringToFront, sendToBack, bringForward, sendBackward } from '../scene/layer-actions';
import { lockElements, unlockElements, toggleLock } from '../scene/lock-actions';
import {
  setStrokeColor,
  setBackgroundFill,
  setStrokeWidth,
  setStrokeStyle,
  setOpacity,
  getMixedStrokeColor,
  getMixedOpacity,
  getMixedStrokeWidth,
} from '../scene/style-actions';
import {
  alignLeft,
  alignRight,
  alignTop,
  alignBottom,
  alignCenterH,
  alignCenterV,
  distributeHorizontal,
  distributeVertical,
} from '../interaction/alignment';
import { copyElements, pasteElements, duplicateElements, cutElements } from '../interaction/clipboard';
import { exportSceneToJSON } from '../io/export-json';
import { importSceneFromJSON } from '../io/import-json';
import { exportSceneToPNG, PNGExportOptions } from '../io/export-png';
import {
  autoAssignToFrames,
  getFrameChildren,
  moveFrameChildren,
  clearFrameChildren,
} from '../scene/frame-actions';
import {
  ComponentRegistry,
  defaultComponentRegistry,
  defineComponent,
} from '../components/component-registry';
import type { ComponentDefinition } from '../components/component-registry';
import {
  createInstance,
  resetInstanceOverride,
  detachInstance,
  setInstanceOverride,
  getInstanceElements,
} from '../components/component-actions';
import { computeCombinedBounds } from '../interaction/alignment';
import { renderSelectionOverlay, computeSelectionBounds, hitTestResizeHandle, hitTestRotateHandle } from '../render/render-selection';
import { renderElement } from '../shapes';
import type { SelectionState } from '../interaction/selection';
import type { Bounds } from '../shapes/geometry';

/** Event types emitted by the Editor. */
export type EditorEventType =
  | 'change'
  | 'selectionChange'
  | 'toolChange'
  | 'viewportChange'
  | 'historyChange'
  | 'componentChange';

/** Event payload map for type-safe subscriptions. */
export type EditorEventPayloadMap = {
  change: void;
  selectionChange: string[];
  toolChange: string;
  viewportChange: Viewport;
  historyChange: { canUndo: boolean; canRedo: boolean };
  componentChange: { componentId: string };
};

/** Callback type for editor events. */
export type EditorEventCallback<E extends EditorEventType> = (
  payload: EditorEventPayloadMap[E],
) => void;

/** Configuration options for creating an Editor instance. */
export interface FazelidrawConfig {
  /** Theme override (partial). All fields optional. */
  theme?: ThemeOverride;
  /** Custom shape definitions to register. */
  shapes?: ShapeDefinition[];
  /** Tool types that are enabled. If provided, setActiveTool rejects tools not in this list. */
  enabledTools?: string[];
  /**
   * Canvas mode: 'infinite' (default) or 'bounded' (fixed width × height).
   * Set once at initialization — cannot be changed at runtime.
   */
  canvasMode?: CanvasMode;
}

/**
 * Public API for the Fazelidraw engine.
 *
 * Wraps all engine capabilities (Scene, History, Selection, Transform,
 * Clipboard, Alignment, Grouping, Layering, IO, etc.) behind a single
 * facade. Every method is a thin wrapper that delegates to existing
 * functions — no logic is reimplemented here.
 *
 * @example
 * ```ts
 * const editor = createEditor();
 * editor.mount(document.getElementById('canvas')!);
 *
 * const rect = editor.createElement({ type: 'rectangle', x: 100, y: 100, width: 200, height: 150 });
 * editor.select([rect.id]);
 * editor.setStyle([rect.id], { strokeColor: '#ff0000' });
 *
 * editor.on('change', () => console.log('scene changed'));
 *
 * editor.unmount();
 * ```
 */
export class Editor {
  private scene: Scene;
  private history: HistoryManager;
  private selection: SelectionManager;
  private transform: TransformHandler;
  private drawTool: DrawTool;
  private panZoom: PanZoom | null = null;
  private cropHandler: CropHandler | null = null;
  private textEditor: TextEditor | null = null;
  private renderLoop: RenderLoop | null = null;
  private canvasLayers: CanvasLayers | null = null;
  private container: HTMLDivElement | null = null;
  private interactiveRafId: number | null = null;
  private needsInteractiveRender: boolean = false;
  private selectionState: SelectionState = {
    selectedElementIds: new Set(),
    rubberBand: null,
    isDragging: false,
    editingGroupId: null,
  };

  private activeTool: string = 'select';
  private enabledTools: string[] | null = null;
  private viewport: Viewport = { scrollX: 0, scrollY: 0, zoom: 1 };
  private theme: FazelidrawTheme;
  private themeOverride: ThemeOverride = {};
  private canvasMode: CanvasMode;
  private componentRegistry: ComponentRegistry = defaultComponentRegistry;
  // Click-vs-drag disambiguation (Phase 19 A5/A6): pointerdown on an
  // already-selected member must NOT collapse the multi-selection. Instead we
  // remember the collapse candidate ids and only collapse on pointerup without
  // movement beyond the drag threshold.
  private pendingCollapseIds: string[] | null = null;
  private pointerDownX: number = 0;
  private pointerDownY: number = 0;
  private pointerMovedBeyondThreshold: boolean = false;
  private static readonly DRAG_THRESHOLD_PX = 4;

  private eventEmitter = new EventEmitter<EditorEventPayloadMap>();

  /** @internal — use `createEditor()` instead. */
  constructor(config?: FazelidrawConfig) {
    this.scene = new Scene();
    this.history = new HistoryManager(this.scene);
    this.themeOverride = config?.theme ? structuredClone(config.theme) : {};
    this.theme = resolveTheme(this.themeOverride);
    this.canvasMode = config?.canvasMode ?? DEFAULT_CANVAS_MODE;

    // Hook into scene mutations to fire componentChange events
    // and invalidate instance cache when master elements change
    this.scene.onMutation((delta) => {
      for (const [id, update] of delta.elementUpdates) {
        const after = update.after;
        // Check if a master root element was modified
        if (after && this.componentRegistry.isMasterRoot(id)) {
          const def = this.componentRegistry.getByRootElement(id);
          if (def) {
            this.renderLoop?.invalidateInstanceCache();
            this.emit('componentChange', { componentId: def.id });
          }
        }
      }
    });

    if (config?.enabledTools) {
      this.enabledTools = [...config.enabledTools];
    }

    this.selection = new SelectionManager(this.scene, this.viewport, (state) => {
      this.selectionState = state;
      this.needsInteractiveRender = true;
      this.emit('selectionChange', Array.from(state.selectedElementIds));
      this.emitHistoryChange();
    });

    this.transform = new TransformHandler(this.scene, this.viewport, () => {
      this.needsInteractiveRender = true;
      this.emit('change');
    });

    this.drawTool = new DrawTool(this.scene, this.viewport, (element) => {
      this.selection.clearSelection();
      this.selection.addToSelection(element.id);
      this.needsInteractiveRender = true;
      this.emit('change');
    });

    if (config?.shapes) {
      for (const def of config.shapes) {
        registerShape(def);
      }
    }
  }

  // ─── Static Factory ────────────────────────────────────────

  /**
   * Create a new Editor instance.
   * @param config - Optional configuration (theme, shapes, enabledTools)
   * @returns A fully initialized Editor
   */
  static create(config?: FazelidrawConfig): Editor {
    return new Editor(config);
  }

  // ─── Scene & Elements ──────────────────────────────────────

  /**
   * Create a new element and add it to the scene.
   * @param partial - Partial element properties (type defaults to 'rectangle')
   * @returns The created element with all defaults filled in
   */
  createElement(partial: Partial<Element> & { type: string }): Element {
    const type = partial.type;
    if (type === 'instance') {
      throw new Error('Use createInstance() to create instance elements, not createElement().');
    }
    let el: Element;
    switch (type) {
      case 'rectangle':
        el = createRectangle(partial as Partial<import('../scene/types').RectangleElement>);
        break;
      case 'ellipse':
        el = createEllipse(partial as Partial<import('../scene/types').EllipseElement>);
        break;
      case 'line':
        el = createLine(partial as Partial<import('../scene/types').LineElement>);
        break;
      case 'arrow':
        el = createArrow(partial as Partial<import('../scene/types').ArrowElement>);
        break;
      case 'text':
        el = createText(partial as Partial<import('../scene/types').TextElement>);
        break;
      case 'freedraw':
        el = createFreedraw(partial as Partial<import('../scene/types').FreedrawElement>);
        break;
      case 'frame':
        el = createFrame(partial as Partial<import('../scene/types').FrameElement>);
        break;
      case 'image':
        el = createImage(partial as Partial<import('../scene/types').ImageElement>);
        break;
      case 'path':
        el = createPath(partial as Partial<import('../scene/types').PathElement>);
        break;
      default: {
        // Custom shape path: built-ins and custom shapes go through the same
        // registry with no privileged distinction. Unknown types throw
        // instead of silently creating the wrong type.
        const definition = defaultShapeRegistry.get(type);
        if (!definition) {
          throw new Error(`Unknown element type: "${type}". Register it via registerShape() first.`);
        }
        const defaults = (definition.getDefaultProps() ?? {}) as Record<string, unknown>;
        el = {
          id: crypto.randomUUID(),
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          strokeColor: '#000000',
          backgroundColor: { type: 'solid', color: 'transparent' },
          strokeWidth: 1,
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
          ...defaults,
          ...(partial as Record<string, unknown>),
          type,
        } as Element;
        break;
      }
    }
    this.scene.upsertElement(el);
    this.emit('change');
    return el;
  }

  /**
   * Update an element by ID with a partial patch.
   * @param id - Element ID to update
   * @param patch - Partial properties to merge
   */
  updateElement(id: string, patch: Partial<Element>): void {
    const el = this.scene.getElement(id);
    if (!el) return;
    // Strip identity/version fields: callers must not re-key identity or
    // hand-roll version arithmetic (Scene.upsertElement is authoritative).
    const { id: _ignoredId, type: _ignoredType, version: _ignoredVersion, versionNonce: _ignoredNonce, ...safePatch } = patch as Record<string, unknown>;
    void _ignoredId;
    void _ignoredType;
    void _ignoredVersion;
    void _ignoredNonce;
    this.scene.upsertElement({ ...el, ...safePatch } as Element);
    this.emit('change');
  }

  /**
   * Soft-delete an element by ID.
   * @param id - Element ID to delete
   */
  deleteElement(id: string): void {
    this.scene.deleteElement(id);
    this.emit('change');
  }

  /**
   * Get an element by ID.
   * @param id - Element ID
   * @returns The element, or undefined if not found or deleted
   */
  getElement(id: string): Element | undefined {
    const el = this.scene.getElement(id);
    if (!el || el.isDeleted) return undefined;
    return el;
  }

  /**
   * Get all visible (non-deleted) elements in z-order.
   * @returns Array of visible elements
   */
  getAllElements(): Element[] {
    return this.scene.getAllElements();
  }

  /**
   * Get the number of visible (non-deleted) elements.
   */
  getElementCount(): number {
    return this.scene.getElementCount();
  }

  // ─── Selection ─────────────────────────────────────────────

  /**
   * Set the selection to the given element IDs.
   * @param ids - Array of element IDs to select
   */
  select(ids: string[]): void {
    this.selection.setSelection(new Set(ids));
  }

  /**
   * Get the currently selected element IDs.
   * @returns Array of selected element IDs
   */
  getSelection(): string[] {
    return Array.from(this.selection.getSelectedIds());
  }

  /**
   * Clear the current selection.
   */
  clearSelection(): void {
    this.selection.clearSelection();
  }

  /**
   * Get the combined bounding box of all selected elements.
   * @returns Bounds or null if nothing selected
   */
  getSelectionBounds(): Bounds | null {
    return computeCombinedBounds(this.scene, this.getSelection());
  }

  /**
   * Toggle selection of an element.
   * @param id - Element ID to toggle
   */
  toggleSelect(id: string): void {
    this.selection.toggleSelection(id);
  }

  // ─── Active Tool ───────────────────────────────────────────

  /**
   * Set the active drawing tool. Switching tools cancels any active
   * gesture (transform batch, rubber-band, text session) so no temporary
   * state leaks across tools.
   * @param toolType - Tool type string (e.g. 'select', 'rectangle', 'ellipse', 'text')
   * @returns true if the tool was activated, false if rejected by enabledTools
   */
  setActiveTool(toolType: string): boolean {
    if (this.enabledTools && !this.enabledTools.includes(toolType)) {
      return false; // rejected — caller can reflect this in custom UI
    }
    // Cancel mid-gesture state before switching (prevents cross-tool leaks).
    if (this.transform.isTransforming()) {
      this.transform.cancelTransform();
      this.history.endBatch();
    }
    if (this.selectionState.rubberBand) {
      this.selection.cancelRubberBand();
    }
    if (this.textEditor?.isEditing()) {
      this.textEditor.finishEditing();
    }
    this.pendingCollapseIds = null;
    this.activeTool = toolType;
    this.drawTool.setTool(toolType === 'select' ? null : toolType);
    this.emit('toolChange', toolType);
    return true;
  }

  /**
   * Get the currently active tool type.
   * @returns Active tool type string
   */
  getActiveTool(): string {
    return this.activeTool;
  }

  // ─── Transform ─────────────────────────────────────────────

  /**
   * Move elements by a delta.
   * @param ids - Element IDs to move
   * @param dx - Delta X in scene coordinates
   * @param dy - Delta Y in scene coordinates
   */
  moveElements(ids: string[], dx: number, dy: number): void {
    this.history.startBatch();
    try {
      for (const id of ids) {
        const el = this.scene.getElement(id);
        if (el && !el.locked && !el.isDeleted) {
          this.scene.upsertElement({ ...el, x: el.x + dx, y: el.y + dy });
        }
      }
    } finally {
      this.history.endBatch();
    }
    this.emit('change');
  }

  /**
   * Resize an element to new bounds.
   * @param id - Element ID to resize
   * @param newBounds - New position and size { x, y, width, height }
   */
  resizeElement(
    id: string,
    newBounds: { x: number; y: number; width: number; height: number },
  ): void {
    const el = this.scene.getElement(id);
    if (!el || el.locked || el.isDeleted) return;
    if (!Number.isFinite(newBounds.x) || !Number.isFinite(newBounds.y)) return;
    if (!Number.isFinite(newBounds.width) || !Number.isFinite(newBounds.height)) return;
    if (newBounds.width < 1 || newBounds.height < 1) return;
    this.scene.upsertElement({
      ...el,
      x: newBounds.x,
      y: newBounds.y,
      width: newBounds.width,
      height: newBounds.height,
    });
    this.emit('change');
  }

  /**
   * Rotate an element by angle (radians).
   * @param id - Element ID to rotate
   * @param angle - Rotation angle in radians
   */
  rotateElement(id: string, angle: number): void {
    const el = this.scene.getElement(id);
    if (!el || el.locked || el.isDeleted) return;
    if (!Number.isFinite(angle)) return;
    this.scene.upsertElement({ ...el, rotation: angle });
    this.emit('change');
  }

  /**
   * Delete the currently selected elements (skips locked).
   */
  deleteSelected(): void {
    this.selection.deleteSelected();
    this.emit('change');
  }

  /**
   * Nudge selected elements by (dx, dy) in scene coordinates.
   * @param dx - Delta X
   * @param dy - Delta Y
   */
  nudgeSelected(dx: number, dy: number): void {
    this.selection.nudgeSelected(dx, dy);
    this.emit('change');
  }

  // ─── History ───────────────────────────────────────────────

  /**
   * Undo the last action.
   * Ignored during active transform or text editing to prevent half-finished state.
   */
  undo(): void {
    // Don't allow undo during active transforms, text editing, crop, or rubber-band.
    if (this.transform.isTransforming()) return;
    if (this.textEditor?.isEditing()) return;
    if (this.cropHandler?.isCropping()) return;
    if (this.selectionState.rubberBand) return;

    this.history.undo();
    this.emit('change');
    this.emitHistoryChange();
  }

  /**
   * Redo the last undone action.
   * Ignored during active transform or text editing.
   */
  redo(): void {
    if (this.transform.isTransforming()) return;
    if (this.textEditor?.isEditing()) return;
    if (this.cropHandler?.isCropping()) return;
    if (this.selectionState.rubberBand) return;

    this.history.redo();
    this.emit('change');
    this.emitHistoryChange();
  }

  /**
   * Check if undo is available.
   */
  canUndo(): boolean {
    return this.history.canUndo();
  }

  /**
   * Check if redo is available.
   */
  canRedo(): boolean {
    return this.history.canRedo();
  }

  // ─── Clipboard ─────────────────────────────────────────────

  /**
   * Copy elements to the clipboard.
   * @param ids - Element IDs to copy
   */
  copy(ids: string[]): void {
    copyElements(this.scene, ids);
  }

  /**
   * Paste elements from the clipboard.
   */
  paste(): void {
    pasteElements(this.scene, this.history);
    this.emit('change');
  }

  /**
   * Duplicate the given elements in-place.
   * @param ids - Element IDs to duplicate
   */
  duplicate(ids: string[]): void {
    duplicateElements(this.scene, this.history, ids);
    this.emit('change');
  }

  /**
   * Cut elements: copy to clipboard then delete originals.
   * @param ids - Element IDs to cut
   */
  cut(ids: string[]): void {
    cutElements(this.scene, this.history, ids);
    this.emit('change');
  }

  // ─── Viewport ──────────────────────────────────────────────

  /**
   * Get the canvas mode (infinite or bounded).
   * @returns The canvas mode configuration
   */
  getCanvasMode(): CanvasMode {
    return this.canvasMode;
  }

  /**
   * Get the canvas bounds.
   * @returns Bounds object for bounded mode, null for infinite mode
   */
  getCanvasBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    return computeCanvasBounds(this.canvasMode);
  }

  /**
   * Pan the viewport by a delta.
   * @param dx - Delta X in screen pixels
   * @param dy - Delta Y in screen pixels
   */
  pan(dx: number, dy: number): void {
    this.viewport.scrollX += dx / this.viewport.zoom;
    this.viewport.scrollY += dy / this.viewport.zoom;
    this.syncViewport();
    this.emit('viewportChange', this.getViewport());
  }

  /**
   * Zoom the viewport by a factor centered on a point.
   * @param factor - Zoom multiplier (>1 zooms in, <1 zooms out)
   * @param center - Center point in screen coordinates
   */
  zoom(factor: number, center: Point): void {
    const newZoom = clampZoom(this.viewport.zoom * factor);
    const sceneX = center[0] / this.viewport.zoom - this.viewport.scrollX;
    const sceneY = center[1] / this.viewport.zoom - this.viewport.scrollY;
    this.viewport.zoom = newZoom;
    this.viewport.scrollX = center[0] / newZoom - sceneX;
    this.viewport.scrollY = center[1] / newZoom - sceneY;
    this.syncViewport();
    this.emit('viewportChange', this.getViewport());
  }

  /**
   * Get the current viewport state.
   * @returns Copy of the current viewport (scrollX, scrollY, zoom)
   */
  getViewport(): Viewport {
    return { ...this.viewport };
  }

  // ─── Style ─────────────────────────────────────────────────

  /**
   * Set style properties on multiple elements.
   * For instance elements, style changes are applied as overrides on the root child.
   * @param ids - Element IDs to style
   * @param style - Style properties to apply
   */
  setStyle(
    ids: string[],
    style: {
      strokeColor?: string;
      backgroundColor?: FillStyle;
      strokeWidth?: number;
      strokeStyle?: StrokeStyle;
      opacity?: number;
    },
  ): void {
    this.history.startBatch();

    const instanceIds: string[] = [];
    const regularIds: string[] = [];

    // Separate instances from regular elements
    for (const id of ids) {
      const el = this.scene.getElement(id);
      if (el?.type === 'instance') {
        instanceIds.push(id);
      } else {
        regularIds.push(id);
      }
    }

    // Apply style to regular elements as before
    if (regularIds.length > 0) {
      if (style.strokeColor !== undefined) setStrokeColor(this.scene, regularIds, style.strokeColor);
      if (style.backgroundColor !== undefined) setBackgroundFill(this.scene, regularIds, style.backgroundColor);
      if (style.strokeWidth !== undefined) setStrokeWidth(this.scene, regularIds, style.strokeWidth);
      if (style.strokeStyle !== undefined) setStrokeStyle(this.scene, regularIds, style.strokeStyle);
      if (style.opacity !== undefined) setOpacity(this.scene, regularIds, style.opacity);
    }

    // For instances, apply style as overrides on root child (path "0")
    for (const instanceId of instanceIds) {
      const overridePatch: Partial<Element> = {};
      if (style.strokeColor !== undefined) overridePatch.strokeColor = style.strokeColor;
      if (style.backgroundColor !== undefined) overridePatch.backgroundColor = style.backgroundColor;
      if (style.strokeWidth !== undefined) overridePatch.strokeWidth = style.strokeWidth;
      if (style.strokeStyle !== undefined) overridePatch.strokeStyle = style.strokeStyle;
      if (style.opacity !== undefined) overridePatch.opacity = style.opacity;

      if (Object.keys(overridePatch).length > 0) {
        setInstanceOverride(this.scene, instanceId, '0', overridePatch);
      }
    }

    this.history.endBatch();
    if (instanceIds.length > 0) {
      this.renderLoop?.invalidateInstanceCache();
    }
    this.emit('change');
  }

  /**
   * Get the common stroke color across selected elements, or null if mixed.
   * Use this to show "mixed" state in color pickers when multi-selecting elements with different colors.
   * @param ids - Element IDs to check
   * @returns Common color, or null if values differ
   */
  getMixedStrokeColor(ids: string[]): string | null {
    return getMixedStrokeColor(this.scene, ids);
  }

  /**
   * Get the common opacity across selected elements, or null if mixed.
   * @param ids - Element IDs to check
   * @returns Common opacity, or null if values differ
   */
  getMixedOpacity(ids: string[]): number | null {
    return getMixedOpacity(this.scene, ids);
  }

  /**
   * Get the common stroke width across selected elements, or null if mixed.
   * @param ids - Element IDs to check
   * @returns Common stroke width, or null if values differ
   */
  getMixedStrokeWidth(ids: string[]): number | null {
    return getMixedStrokeWidth(this.scene, ids);
  }

  // ─── Layering ──────────────────────────────────────────────

  /**
   * Bring elements to the front of the z-order.
   * @param ids - Element IDs
   */
  bringToFront(ids: string[]): void {
    bringToFront(this.scene, ids);
    this.emit('change');
  }

  /**
   * Send elements to the back of the z-order.
   * @param ids - Element IDs
   */
  sendToBack(ids: string[]): void {
    sendToBack(this.scene, ids);
    this.emit('change');
  }

  /**
   * Bring elements forward by one step.
   * @param ids - Element IDs
   */
  bringForward(ids: string[]): void {
    bringForward(this.scene, ids);
    this.emit('change');
  }

  /**
   * Send elements backward by one step.
   * @param ids - Element IDs
   */
  sendBackward(ids: string[]): void {
    sendBackward(this.scene, ids);
    this.emit('change');
  }

  // ─── Lock ──────────────────────────────────────────────────

  /**
   * Lock elements (prevent selection/transform).
   * @param ids - Element IDs
   */
  lock(ids: string[]): void {
    lockElements(this.scene, ids);
    this.emit('change');
  }

  /**
   * Unlock elements.
   * @param ids - Element IDs
   */
  unlock(ids: string[]): void {
    unlockElements(this.scene, ids);
    this.emit('change');
  }

  /**
   * Toggle lock state for elements.
   * @param ids - Element IDs
   */
  toggleLock(ids: string[]): void {
    toggleLock(this.scene, ids);
    this.emit('change');
  }

  // ─── Grouping ──────────────────────────────────────────────

  /**
   * Create a new group from the given element IDs.
   * @param ids - Element IDs to group
   * @returns The newly created group ID
   */
  group(ids: string[]): string {
    const groupId = groupElements(this.scene, ids);
    this.emit('change');
    return groupId;
  }

  /**
   * Remove a group, clearing the group ID from all member elements.
   * @param groupId - Group ID to remove
   */
  ungroup(groupId: string): void {
    ungroupElements(this.scene, groupId);
    this.emit('change');
  }

  /**
   * Get all element IDs that share any group with the given element.
   * @param id - An element ID
   * @returns Array of element IDs in the same group
   */
  getGroupMembers(id: string): string[] {
    return getGroupMembers(this.scene, id);
  }

  /**
   * Get the outermost group ID for an element.
   * @param id - An element ID
   * @returns Outermost group ID, or null if not grouped
   */
  getOutermostGroupId(id: string): string | null {
    return getOutermostGroupId(this.scene, id);
  }

  // ─── Alignment ─────────────────────────────────────────────

  /**
   * Align selected elements to the left edge of their combined bounding box.
   * @param ids - Element IDs
   */
  alignLeft(ids: string[]): void {
    alignLeft(this.scene, ids);
    this.emit('change');
  }

  /**
   * Align selected elements to the right edge.
   * @param ids - Element IDs
   */
  alignRight(ids: string[]): void {
    alignRight(this.scene, ids);
    this.emit('change');
  }

  /**
   * Align selected elements to the top edge.
   * @param ids - Element IDs
   */
  alignTop(ids: string[]): void {
    alignTop(this.scene, ids);
    this.emit('change');
  }

  /**
   * Align selected elements to the bottom edge.
   * @param ids - Element IDs
   */
  alignBottom(ids: string[]): void {
    alignBottom(this.scene, ids);
    this.emit('change');
  }

  /**
   * Align selected elements to the horizontal center.
   * @param ids - Element IDs
   */
  alignCenterH(ids: string[]): void {
    alignCenterH(this.scene, ids);
    this.emit('change');
  }

  /**
   * Align selected elements to the vertical center.
   * @param ids - Element IDs
   */
  alignCenterV(ids: string[]): void {
    alignCenterV(this.scene, ids);
    this.emit('change');
  }

  /**
   * Distribute elements evenly along the horizontal axis.
   * @param ids - Element IDs (minimum 3)
   */
  distributeHorizontal(ids: string[]): void {
    distributeHorizontal(this.scene, ids);
    this.emit('change');
  }

  /**
   * Distribute elements evenly along the vertical axis.
   * @param ids - Element IDs (minimum 3)
   */
  distributeVertical(ids: string[]): void {
    distributeVertical(this.scene, ids);
    this.emit('change');
  }

  // ─── Frames ────────────────────────────────────────────────

  /**
   * Auto-assign elements to frames based on spatial containment.
   * @param ids - Element IDs to check (optional, defaults to all)
   */
  autoAssignToFrames(ids?: string[]): void {
    autoAssignToFrames(this.scene, ids);
    this.emit('change');
  }

  /**
   * Get all child element IDs of a frame.
   * @param frameId - Frame element ID
   * @returns Array of child element IDs
   */
  getFrameChildren(frameId: string): string[] {
    return getFrameChildren(this.scene, frameId);
  }

  /**
   * Move all children of a frame by a delta.
   * @param frameId - Frame element ID
   * @param dx - Delta X
   * @param dy - Delta Y
   */
  moveFrameChildren(frameId: string, dx: number, dy: number): void {
    moveFrameChildren(this.scene, frameId, dx, dy);
    this.emit('change');
  }

  /**
   * Remove all frameId assignments from children of a frame.
   * @param frameId - Frame element ID
   */
  clearFrameChildren(frameId: string): void {
    clearFrameChildren(this.scene, frameId);
    this.emit('change');
  }

  // ─── Component / Instance ──────────────────────────────────

  /**
   * Promote existing scene elements into a master component definition.
   * The elements remain in the scene as the master visual.
   * @param elementIds - Element IDs to promote (must exist, not deleted)
   * @param name - Human-readable component name
   * @returns The created ComponentDefinition
   */
  defineComponent(elementIds: string[], name: string): ComponentDefinition {
    const def = defineComponent(this.scene, elementIds, name, this.componentRegistry);
    this.emit('change');
    return def;
  }

  /**
   * Create a new instance of a component.
   * @param componentId - ID of the component to instantiate
   * @param x - X position in scene coordinates
   * @param y - Y position in scene coordinates
   * @returns The created InstanceElement
   */
  createInstance(componentId: string, x: number, y: number): InstanceElement {
    const instance = createInstance(this.scene, componentId, x, y, this.componentRegistry);
    this.renderLoop?.invalidateInstanceCache();
    this.emit('change');
    return instance;
  }

  /**
   * Reset a specific override on an instance, making that property
   * sync back to the master component value.
   * @param instanceId - ID of the instance
   * @param propertyPath - Override key to remove (e.g., "0" or "1/0")
   */
  resetInstanceOverride(instanceId: string, propertyPath: string): void {
    resetInstanceOverride(this.scene, instanceId, propertyPath);
    this.renderLoop?.invalidateInstanceCache();
    this.emit('change');
  }

  /**
   * Detach an instance from its component, materializing resolved elements
   * as independent scene elements. The instance is soft-deleted.
   * @param instanceId - ID of the instance to detach
   * @returns The materialized elements (independent, not instances)
   */
  detachInstance(instanceId: string): Element[] {
    const result = detachInstance(this.scene, instanceId, (id) =>
      this.componentRegistry.get(id),
    );
    this.renderLoop?.invalidateInstanceCache();
    this.emit('change');
    return result;
  }

  /**
   * Set an override on a specific property path of an instance.
   * @param instanceId - ID of the instance
   * @param propertyPath - Override key (e.g., "0" for first root element)
   * @param patch - Partial element properties to override
   */
  setInstanceOverride(instanceId: string, propertyPath: string, patch: Partial<Element>): void {
    setInstanceOverride(this.scene, instanceId, propertyPath, patch);
    this.renderLoop?.invalidateInstanceCache();
    this.emit('change');
  }

  /**
   * Get the resolved elements for an instance.
   * @param instanceId - ID of the instance
   * @returns Resolved elements, or empty array if not found
   */
  getInstanceElements(instanceId: string): Element[] {
    return getInstanceElements(this.scene, instanceId, (id) =>
      this.componentRegistry.get(id),
    );
  }

  /**
   * Get a component definition by ID.
   * @param id - Component ID
   * @returns ComponentDefinition or undefined
   */
  getComponentDefinition(id: string): ComponentDefinition | undefined {
    return this.componentRegistry.get(id);
  }

  /**
   * Get all component definitions.
   * @returns Array of ComponentDefinition
   */
  getAllComponentDefinitions(): ComponentDefinition[] {
    return this.componentRegistry.getAll();
  }

  // ─── Text Editing ──────────────────────────────────────────

  /**
   * Start editing a text element (requires a container div for the textarea overlay).
   * @param elementId - Text element ID to edit
   * @param container - Container div for the textarea overlay
   */
  startTextEditing(elementId: string, container: HTMLDivElement): void {
    if (!this.textEditor) {
      this.textEditor = new TextEditor(this.scene, this.viewport, container, () => {
        this.emit('change');
      });
    }
    this.textEditor.startEditing(elementId);
  }

  /**
   * Start editing text at a canvas position.
   * Creates a new text element if none exists at the position.
   * @param sceneX - X position in scene coordinates
   * @param sceneY - Y position in scene coordinates
   * @param container - Container div for the textarea overlay
   * @returns The element ID being edited
   */
  startTextEditingAtPosition(
    sceneX: number,
    sceneY: number,
    container: HTMLDivElement,
  ): string {
    if (!this.textEditor) {
      this.textEditor = new TextEditor(this.scene, this.viewport, container, () => {
        this.emit('change');
      });
    }
    return this.textEditor.startEditingAtPosition(sceneX, sceneY);
  }

  /**
   * Check if text editing is currently active.
   */
  isTextEditing(): boolean {
    return this.textEditor?.isEditing() ?? false;
  }

  /**
   * Get the ID of the element being text-edited.
   */
  getEditingTextId(): string | null {
    return this.textEditor?.getEditingElementId() ?? null;
  }

  // ─── Image / Crop ──────────────────────────────────────────

  /**
   * Start crop mode for an ImageElement.
   * @param elementId - ImageElement ID to crop
   */
  startCrop(elementId: string): void {
    if (!this.cropHandler) {
      this.cropHandler = new CropHandler(this.scene, this.viewport, () => {
        this.emit('change');
      });
    }
    this.cropHandler.startCrop(elementId);
  }

  /**
   * End crop mode.
   * @param commit - If true, apply the crop; if false, revert
   */
  endCrop(commit: boolean): void {
    this.cropHandler?.endCrop(commit);
    this.emit('change');
  }

  /**
   * Check if crop mode is active.
   */
  isCropping(): boolean {
    return this.cropHandler?.isCropping() ?? false;
  }

  /**
   * Get the element ID being cropped.
   */
  getCroppingElementId(): string | null {
    return this.cropHandler?.getCroppingElementId() ?? null;
  }

  // ─── Shape Registration ────────────────────────────────────

  /**
   * Register a custom shape definition.
   * @param definition - Shape definition to register
   */
  registerShape(definition: ShapeDefinition): void {
    registerShape(definition);
  }

  // ─── Export / Import ───────────────────────────────────────

  /**
   * Export the scene to a JSON string.
   * @returns JSON string of the scene
   */
  exportToJSON(): string {
    return exportSceneToJSON(this.scene);
  }

  /**
   * Import a scene from a JSON string (replaces all current elements).
   * Batched into a single history entry so the whole import is one undo step.
   * @param json - JSON string to import
   */
  importFromJSON(json: string): void {
    importSceneFromJSON(json, this.scene, this.history);
    this.emit('change');
  }

  /**
   * Export the scene to a PNG Blob.
   * @param options - Export options (background, padding, scale)
   * @returns Promise resolving to a PNG Blob
   */
  exportToPNG(options?: PNGExportOptions): Promise<Blob> {
    return exportSceneToPNG(this.scene, options);
  }

  // ─── Theme ─────────────────────────────────────────────────

  /**
   * Get the current resolved theme.
   */
  getTheme(): FazelidrawTheme {
    return this.theme;
  }

  /**
   * Update the theme at runtime. Partial overrides accumulate on top of
   * previously applied overrides (not just defaults).
   * @param override - Partial theme override
   */
  setTheme(override: ThemeOverride): void {
    this.themeOverride = deepMergeThemeOverride(this.themeOverride, override);
    this.theme = resolveTheme(this.themeOverride);
    this.renderLoop?.setTheme(this.theme);
    this.needsInteractiveRender = true;
  }

  /**
   * Get the list of enabled tools (null = all tools enabled).
   */
  getEnabledTools(): string[] | null {
    return this.enabledTools ? [...this.enabledTools] : null;
  }

  // ─── Mount / Unmount ──────────────────────────────────────

  /**
   * Mount the editor to a DOM element for rendering.
   * Creates the dual-canvas setup and starts the render loop.
   * @param target - A div element to mount into (canvas layers will be created inside)
   */
  mount(target: HTMLDivElement): void {
    if (this.canvasLayers) return; // already mounted

    this.container = target;
    this.canvasLayers = createCanvasLayers(target);

    const rect = target.getBoundingClientRect();
    this.canvasLayers.resize(rect.width, rect.height);

    this.renderLoop = new RenderLoop(this.scene, this.canvasLayers, this.viewport, this.theme, this.canvasMode);
    this.renderLoop.setComponentRegistry(this.componentRegistry);
    this.renderLoop.start();

    this.panZoom = new PanZoom(target, this.viewport, (vp) => {
      this.viewport = vp;
      this.syncViewport();
      this.needsInteractiveRender = true;
      this.emit('viewportChange', this.getViewport());
    });

    // Wire pointer events for interactive tools (draw, select, transform)
    this.bindPointerEvents();

    // Start interactive canvas render loop
    this.startInteractiveLoop();
  }

  /**
   * Unmount the editor, stopping the render loop and cleaning up.
   * Removes canvas DOM nodes, destroys handlers, and clears subscriptions
   * so mount/unmount cycles do not leak.
   */
  unmount(): void {
    this.unbindPointerEvents();
    this.stopInteractiveLoop();
    this.renderLoop?.stop();
    this.renderLoop = null;
    this.panZoom?.destroy();
    this.panZoom = null;
    if (this.canvasLayers) {
      this.canvasLayers.staticCanvas.remove();
      this.canvasLayers.interactiveCanvas.remove();
    }
    this.canvasLayers = null;
    this.cropHandler?.destroy?.();
    this.cropHandler = null;
    this.textEditor?.destroy?.();
    this.textEditor = null;
    this.eventEmitter.removeAllListeners();
    this.pendingCollapseIds = null;
    this.container = null;
  }

  // ─── Event System ──────────────────────────────────────────

  /**
   * Subscribe to an editor event.
   * @param event - Event type to subscribe to
   * @param callback - Callback to invoke when the event fires
   * @returns Unsubscribe function
   */
  on<E extends EditorEventType>(event: E, callback: EditorEventCallback<E>): () => void {
    return this.eventEmitter.on(event, callback);
  }

  // ─── Internal Helpers ──────────────────────────────────────

  private emit<E extends EditorEventType>(event: E, payload?: EditorEventPayloadMap[E]): void {
    this.eventEmitter.emit(event, payload as EditorEventPayloadMap[E]);
  }

  private emitHistoryChange(): void {
    this.emit('historyChange', {
      canUndo: this.history.canUndo(),
      canRedo: this.history.canRedo(),
    });
  }

  private syncViewport(): void {
    this.selection.setViewport(this.viewport);
    this.transform.setViewport(this.viewport);
    this.drawTool.setViewport(this.viewport);
    this.cropHandler?.setViewport(this.viewport);
    this.textEditor?.setViewport(this.viewport);
    this.renderLoop?.setViewport(this.viewport);
  }

  // ─── Pointer Events ─────────────────────────────────────────

  private boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundPointerCancel: ((e: PointerEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private lastClickTime: number = 0;
  private lastClickX: number = 0;
  private lastClickY: number = 0;

  private getCanvasXY(e: PointerEvent | MouseEvent): [number, number] {
    if (!this.container) return [0, 0];
    const r = this.container.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private bindPointerEvents(): void {
    this.boundPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
    this.boundPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
    this.boundPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
    this.boundPointerCancel = (e: PointerEvent) => this.handlePointerCancel(e);
    this.boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

    this.container!.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('pointercancel', this.boundPointerCancel);
    window.addEventListener('keydown', this.boundKeyDown);
  }

  private unbindPointerEvents(): void {
    if (this.container && this.boundPointerDown) {
      this.container.removeEventListener('pointerdown', this.boundPointerDown);
    }
    if (this.boundPointerMove) {
      window.removeEventListener('pointermove', this.boundPointerMove);
    }
    if (this.boundPointerUp) {
      window.removeEventListener('pointerup', this.boundPointerUp);
    }
    if (this.boundPointerCancel) {
      window.removeEventListener('pointercancel', this.boundPointerCancel);
    }
    if (this.boundKeyDown) {
      window.removeEventListener('keydown', this.boundKeyDown);
    }
    this.boundPointerDown = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundPointerCancel = null;
    this.boundKeyDown = null;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.container) return;

    const [sx, sy] = this.getCanvasXY(e);
    const scenePt = screenToScene([sx, sy], this.viewport);

    // Right-click: select element if not already selected, then let contextmenu handle it.
    // Ignored while a transform is active (mid-drag selection change corrupts the gesture).
    if (e.button === 2) {
      if (this.transform.isTransforming()) return;
      const hit = this.selection.hitTest(scenePt[0], scenePt[1]);
      if (hit && !this.selection.isSelected(hit.id)) {
        this.resolveAndSelect(hit.id, false);
        this.needsInteractiveRender = true;
      }
      return; // don't process further for right-click
    }

    if (e.button !== 0) return;

    // Detect double-click (within 400ms and 5px distance)
    const now = Date.now();
    const isDoubleClick =
      now - this.lastClickTime < 400 &&
      Math.abs(sx - this.lastClickX) < 5 &&
      Math.abs(sy - this.lastClickY) < 5;
    this.lastClickTime = now;
    this.lastClickX = sx;
    this.lastClickY = sy;

    if (this.activeTool === 'select') {
      // Skip if PanZoom is actively panning
      if (this.panZoom?.isPanningActive()) return;
      if (this.textEditor?.isEditing()) return;

      // Check resize handle (single selection only). Handles are placed in
      // the element's local space: use raw bounds + element rotation so
      // rotated handles are tested at their true visual positions.
      const selIds = Array.from(this.selectionState.selectedElementIds);
      if (selIds.length === 1) {
        const single = this.scene.getElement(selIds[0]);
        const rawBounds = single
          ? { minX: single.x, minY: single.y, maxX: single.x + single.width, maxY: single.y + single.height }
          : computeSelectionBounds(selIds, this.scene);
        const rotation = single ? single.rotation : 0;
        if (rawBounds) {
          const handle = hitTestResizeHandle(scenePt[0], scenePt[1], rawBounds, this.viewport.zoom, this.theme, rotation);
          if (handle) {
            this.history.startBatch();
            this.transform.startResize(selIds[0], handle, sx, sy, this.selection.getSelectedIds());
            this.pointerDownX = sx;
            this.pointerDownY = sy;
            this.pointerMovedBeyondThreshold = false;
            this.pendingCollapseIds = null;
            this.container.style.cursor = 'nwse-resize';
            e.preventDefault();
            return;
          }
          if (hitTestRotateHandle(scenePt[0], scenePt[1], rawBounds, this.viewport.zoom, this.theme, rotation)) {
            this.history.startBatch();
            this.transform.startRotate(selIds[0], sx, sy);
            this.pointerDownX = sx;
            this.pointerDownY = sy;
            this.pointerMovedBeyondThreshold = false;
            this.pendingCollapseIds = null;
            this.container.style.cursor = 'crosshair';
            e.preventDefault();
            return;
          }
        }
      }

      // Check element hit
      const hit = this.selection.hitTest(scenePt[0], scenePt[1]);
      if (hit) {
        // Double-click on text element: enter edit mode with caret near click position
        if (isDoubleClick && hit.type === 'text') {
          this.startTextEditingAtPosition(scenePt[0], scenePt[1], this.container);
          e.preventDefault();
          return;
        }

        // Double-click on grouped element: enter group editing mode
        if (isDoubleClick) {
          const outerGroupId = getOutermostGroupId(this.scene, hit.id);
          if (outerGroupId) {
            this.selection.enterGroupEditingMode(outerGroupId);
            // Select the individual element within the group
            this.selection.setSelection(new Set([hit.id]));
            this.needsInteractiveRender = true;
            e.preventDefault();
            return;
          }
        }

        // If in group editing mode, select individual element; otherwise select outermost group
        if (this.selectionState.editingGroupId) {
          // In group editing mode: select the individual element
          if (e.shiftKey || e.ctrlKey) {
            this.selection.toggleSelection(hit.id);
          } else if (!this.selection.isSelected(hit.id)) {
            this.selection.setSelection(new Set([hit.id]));
          } else {
            if (this.selectionState.selectedElementIds.size > 1) {
              // Defer collapse to pointerup (Phase 19 A5/A6): keep multi for drag.
              this.pendingCollapseIds = [hit.id];
            }
          }
        } else {
          // Normal mode: select outermost group members (not the group id).
          const selectIds = this.resolveGroupSelection(hit.id);

          if (e.shiftKey || e.ctrlKey) {
            for (const sid of selectIds) this.selection.toggleSelection(sid);
            this.pendingCollapseIds = null;
          } else if (!this.isSelectionExact(selectIds)) {
            this.selection.setSelection(new Set(selectIds));
            this.pendingCollapseIds = null;
          } else {
            if (this.selectionState.selectedElementIds.size > selectIds.length) {
              // Click on an already-selected member of a larger selection:
              // defer collapse so a direct drag moves the whole set.
              // (Exact group re-click keeps the group — no pending collapse.)
              this.pendingCollapseIds = [...selectIds];
            } else {
              this.pendingCollapseIds = null;
            }
          }
        }

        this.pointerDownX = sx;
        this.pointerDownY = sy;
        this.pointerMovedBeyondThreshold = false;
        this.history.startBatch();
        this.transform.startMove(this.selection.getSelectedIds(), sx, sy);
        this.container.style.cursor = 'move';
        e.preventDefault();
        return;
      }

      // Empty space → rubber band
      if (!e.shiftKey && !e.ctrlKey) {
        this.selection.clearSelection();
        // Exit group editing mode when clicking empty space
        if (this.selectionState.editingGroupId) {
          this.selection.exitGroupEditingMode();
        }
      }
      this.selection.startRubberBand(sx, sy);
      this.container.style.cursor = 'crosshair';
      e.preventDefault();
    } else if (this.activeTool === 'text') {
      // Space-panning takes precedence over text creation (tool preserved).
      if (this.panZoom?.isPanningActive()) return;
      if (this.container) {
        this.startTextEditingAtPosition(scenePt[0], scenePt[1], this.container);
      }
    } else {
      // Draw tool — space-panning takes precedence (tool preserved).
      if (this.panZoom?.isPanningActive()) return;
      this.drawTool.handlePointerDown(e, this.container.getBoundingClientRect());
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.container) return;

    const [sx, sy] = this.getCanvasXY(e);

    if (this.activeTool === 'select') {
      if (this.transform.isTransforming()) {
        // Track drag threshold for click-vs-drag disambiguation.
        if (!this.pointerMovedBeyondThreshold) {
          const dist = Math.hypot(sx - this.pointerDownX, sy - this.pointerDownY);
          if (dist >= Editor.DRAG_THRESHOLD_PX) this.pointerMovedBeyondThreshold = true;
        }
        const type = this.transform.getActiveTransformType();
        if (type === 'move') {
          this.transform.updateMove(this.selection.getSelectedIds(), sx, sy, e.shiftKey);
        } else if (type === 'resize') {
          this.transform.updateResize(sx, sy, e.shiftKey);
        } else if (type === 'rotate') {
          this.transform.updateRotate(sx, sy, e.shiftKey);
        }
        this.container.style.cursor = type === 'move' ? 'move' : type === 'resize' ? 'nwse-resize' : 'crosshair';
      } else if (this.selectionState.rubberBand) {
        this.selection.updateRubberBand(sx, sy);
      } else {
        // Hover cursor (rotation-aware for single selection)
        const scenePt = screenToScene([sx, sy], this.viewport);
        const selIds = Array.from(this.selectionState.selectedElementIds);
        if (selIds.length === 1) {
          const single = this.scene.getElement(selIds[0]);
          const rawBounds = single
            ? { minX: single.x, minY: single.y, maxX: single.x + single.width, maxY: single.y + single.height }
            : computeSelectionBounds(selIds, this.scene);
          const rotation = single ? single.rotation : 0;
          if (rawBounds) {
            if (hitTestResizeHandle(scenePt[0], scenePt[1], rawBounds, this.viewport.zoom, this.theme, rotation)) {
              this.container.style.cursor = 'nwse-resize';
              return;
            }
            if (hitTestRotateHandle(scenePt[0], scenePt[1], rawBounds, this.viewport.zoom, this.theme, rotation)) {
              this.container.style.cursor = 'crosshair';
              return;
            }
          }
        }
        const hit = this.selection.hitTest(scenePt[0], scenePt[1]);
        this.container.style.cursor = hit ? 'move' : 'default';
      }
    } else if (this.activeTool !== 'text') {
      this.drawTool.handlePointerMove(e, this.container.getBoundingClientRect());
      // Mark interactive canvas dirty so the draw preview is rendered each frame
      this.needsInteractiveRender = true;
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.container) return;

    if (this.activeTool === 'select') {
      if (this.transform.isTransforming()) {
        const [sx, sy] = this.getCanvasXY(e);
        const type = this.transform.getActiveTransformType();
        if (!this.pointerMovedBeyondThreshold) {
          // Click without drag: cancel the preview (no document mutation, no
          // version bump) and close the empty batch. Collapse deferred
          // multi-selection here (Phase 19 A6).
          this.transform.cancelTransform();
          this.history.endBatch();
          if (this.pendingCollapseIds) {
            this.selection.setSelection(new Set(this.pendingCollapseIds));
            this.pendingCollapseIds = null;
          }
        } else if (type === 'move') {
          // Commit final positions via commitMove (calls commitPreview internally),
          // then close the history batch so the drag is a single undo step.
          this.transform.commitMove(this.selection.getSelectedIds(), sx, sy, e.shiftKey);
          this.history.endBatch();
          this.pendingCollapseIds = null;
        } else if (type === 'resize') {
          this.history.startBatch();
          try {
            this.transform.commitResize(sx, sy, e.shiftKey);
          } finally {
            this.history.endBatch();
          }
          this.pendingCollapseIds = null;
        } else if (type === 'rotate') {
          this.history.startBatch();
          try {
            this.transform.commitRotate(sx, sy, e.shiftKey);
          } finally {
            this.history.endBatch();
          }
          this.pendingCollapseIds = null;
        }
        this.pointerMovedBeyondThreshold = false;
        this.container.style.cursor = 'default';
        this.needsInteractiveRender = true;
      } else if (this.selectionState.rubberBand) {
        this.selection.finishRubberBand(e.shiftKey);
        this.needsInteractiveRender = true;
      } else if (this.pendingCollapseIds) {
        // Fallback: collapse even if transform never started.
        this.selection.setSelection(new Set(this.pendingCollapseIds));
        this.pendingCollapseIds = null;
      }
    } else if (this.activeTool !== 'text') {
      this.drawTool.handlePointerUp(e);
      this.needsInteractiveRender = true;
    }
  }

  /**
   * Handle pointercancel (touch interruption, browser gesture): resolve like
   * pointerup without committing — cancel transform, close batch, clear rubber.
   */
  private handlePointerCancel(_e: PointerEvent): void {
    if (this.transform.isTransforming()) {
      this.transform.cancelTransform();
      this.history.endBatch();
      this.pendingCollapseIds = null;
      this.pointerMovedBeyondThreshold = false;
      if (this.container) this.container.style.cursor = 'default';
      this.needsInteractiveRender = true;
    } else if (this.selectionState.rubberBand) {
      this.selection.cancelRubberBand();
      this.needsInteractiveRender = true;
    }
  }

  /**
   * Handle keyboard events for selection and editing shortcuts.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    // Escape: clear selection, commit text editing, or exit group editing mode.
    // Mid-drag Escape cancels the gesture atomically (batch closed, no partial commit).
    if (e.key === 'Escape') {
      if (this.transform.isTransforming()) {
        this.transform.cancelTransform();
        this.history.endBatch();
        this.pendingCollapseIds = null;
        this.container!.style.cursor = 'default';
        this.needsInteractiveRender = true;
        return;
      }
      if (this.textEditor?.isEditing()) {
        // Escape during text edit: commit (not cancel) — consistent with blur behavior
        this.textEditor.finishEditing();
      } else if (this.selectionState.editingGroupId) {
        // Exit group editing mode
        this.selection.exitGroupEditingMode();
        this.selection.clearSelection();
        this.needsInteractiveRender = true;
      } else if (this.selectionState.selectedElementIds.size > 0) {
        this.selection.clearSelection();
        this.needsInteractiveRender = true;
      }
    }
  }

  /**
   * Resolve a hit element id to the ids that should be selected in normal
   * mode: all members of the outermost group, or the single id.
   */
  private resolveGroupSelection(hitId: string): string[] {
    const outerGroupId = getOutermostGroupId(this.scene, hitId);
    if (!outerGroupId) return [hitId];
    const members = getGroupMembers(this.scene, hitId);
    return members.length > 0 ? members : [hitId];
  }

  /** Check whether the current selection is exactly the given id set. */
  private isSelectionExact(ids: string[]): boolean {
    const current = this.selectionState.selectedElementIds;
    if (current.size !== ids.length) return false;
    for (const id of ids) {
      if (!current.has(id)) return false;
    }
    return true;
  }

  /** Replace selection with group-resolved ids (used by right-click path). */
  private resolveAndSelect(hitId: string, additive: boolean): void {
    if (this.selectionState.editingGroupId) {
      if (additive) this.selection.toggleSelection(hitId);
      else this.selection.setSelection(new Set([hitId]));
      return;
    }
    const ids = this.resolveGroupSelection(hitId);
    if (additive) {
      for (const sid of ids) this.selection.toggleSelection(sid);
    } else {
      this.selection.setSelection(new Set(ids));
    }
  }

  // ─── Interactive Canvas Loop ─────────────────────────────────

  private startInteractiveLoop(): void {
    const tick = (): void => {
      if (this.needsInteractiveRender && this.canvasLayers) {
        this.renderInteractive();
      }
      this.interactiveRafId = requestAnimationFrame(tick);
    };
    this.interactiveRafId = requestAnimationFrame(tick);
  }

  private stopInteractiveLoop(): void {
    if (this.interactiveRafId !== null) {
      cancelAnimationFrame(this.interactiveRafId);
      this.interactiveRafId = null;
    }
  }

  private renderInteractive(): void {
    if (!this.canvasLayers) return;
    const { interactiveCtx: ctx, interactiveCanvas: canvas } = this.canvasLayers;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    if (this.activeTool === 'select') {
      // Selection overlays (rotation-aware for single selection so handles
      // sit on the true visual corners, not the AABB corners).
      const selIds = Array.from(this.selectionState.selectedElementIds);
      let overlayRotation = 0;
      if (selIds.length === 1) {
        overlayRotation = this.scene.getElement(selIds[0])?.rotation ?? 0;
      }
      renderSelectionOverlay(ctx, this.selectionState, this.scene, this.viewport, this.theme, overlayRotation);

      // Transform preview
      const previews = this.transform.getPreviewElements();
      const isTransforming = this.transform.isTransforming();
      const activeType = this.transform.getActiveTransformType();

      if (isTransforming && previews.length > 0 && activeType !== 'move') {
        ctx.save();
        ctx.translate(this.viewport.scrollX * this.viewport.zoom, this.viewport.scrollY * this.viewport.zoom);
        ctx.scale(this.viewport.zoom, this.viewport.zoom);
        ctx.globalAlpha = 0.5;
        for (const el of previews) {
          renderElement(ctx, el, this.viewport);
        }
        ctx.restore();
      }

      // Combined bounding box for multi-selection
      const ids = Array.from(this.selectionState.selectedElementIds);
      if (ids.length > 1) {
        const bounds = computeSelectionBounds(ids, this.scene);
        if (bounds) {
          const tl = sceneToScreen([bounds.minX, bounds.minY], this.viewport);
          const br = sceneToScreen([bounds.maxX, bounds.maxY], this.viewport);
          ctx.strokeStyle = this.theme.colors.selectionOutline;
          ctx.lineWidth = this.theme.sizes.selectionOutlineWidth;
          ctx.setLineDash([]);
          ctx.strokeRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]);
        }
      }
    }

    if (this.activeTool !== 'select' && this.activeTool !== 'text') {
      // Draw tool preview
      const previewEl = this.drawTool.getPreviewElement();
      if (previewEl) {
        ctx.save();
        ctx.translate(this.viewport.scrollX * this.viewport.zoom, this.viewport.scrollY * this.viewport.zoom);
        ctx.scale(this.viewport.zoom, this.viewport.zoom);
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = this.theme.colors.selectionOutline;
        ctx.lineWidth = previewEl.strokeWidth || 1;
        ctx.setLineDash([5, 5]);
        renderElement(ctx, previewEl, this.viewport);
        ctx.restore();
      }
    }

    ctx.restore();
    this.needsInteractiveRender = false;
  }
}

/**
 * Create a new Editor instance.
 * @param config - Optional configuration (theme, shapes, enabledTools)
 * @returns A fully initialized Editor
 */
export function createEditor(config?: FazelidrawConfig): Editor {
  return Editor.create(config);
}

/** Deep-merge a partial theme override onto the accumulated override. */
function deepMergeThemeOverride(base: ThemeOverride, patch: ThemeOverride): ThemeOverride {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const prev = (out[key] as Record<string, unknown> | undefined) ?? {};
      out[key] = { ...prev, ...(value as Record<string, unknown>) };
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as ThemeOverride;
}
