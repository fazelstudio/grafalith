import { Scene, Element } from '../scene';
import type { BaseElement, PathElement } from '../scene/types';
import { Viewport, screenToScene } from '../render/viewport';
import { Point } from '../scene/types';
import { defaultShapeRegistry } from '../shapes/registry';
import { PenTool } from './pen-tool';

/** Available drawing tool types — any registered shape type. */
export type DrawToolType = string;

/** Callback when an element is created. */
export type OnElementCreated = (element: Element) => void;

/** Callback when a path is being created (for preview). */
export type OnPathPreview = (element: PathElement | null) => void;

/**
 * State machine for drawing shapes via pointer drag.
 * Dispatches to the ShapeRegistry — no hardcoded if/else per type.
 * For the 'path' tool, delegates to PenTool for multi-click interaction.
 */
export class DrawTool {
  private scene: Scene;
  private viewport: Viewport;
  private activeTool: DrawToolType | null = null;
  private isDrawing = false;
  private startPoint: Point = [0, 0];
  private currentElement: Element | null = null;
  private onElementCreated: OnElementCreated;
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private penTool: PenTool;
  private onPathPreview: OnPathPreview | null = null;

  /**
   * Create a new draw tool handler.
   * @param scene - Scene to add elements to
   * @param viewport - Current viewport for coordinate conversion
   * @param onElementCreated - Callback when element creation starts (for preview)
   */
  constructor(
    scene: Scene,
    viewport: Viewport,
    onElementCreated: OnElementCreated,
  ) {
    this.scene = scene;
    this.viewport = viewport;
    this.onElementCreated = onElementCreated;
    this.penTool = new PenTool(
      scene,
      viewport,
      (el) => this.onElementCreated(el),
      (preview) => this.handlePathPreview(preview),
    );
  }

  /** Set callback for path preview updates (used for rendering pen tool preview). */
  setOnPathPreview(callback: OnPathPreview): void {
    this.onPathPreview = callback;
  }

  /** Get the pen tool instance (for external access to edit mode). */
  getPenTool(): PenTool {
    return this.penTool;
  }

  /** Set the active drawing tool. */
  setTool(tool: DrawToolType | null): void {
    if (this.activeTool === 'path' && tool !== 'path') {
      this.penTool.cancelPath();
    }
    this.activeTool = tool;
    this.cancelDrawing();
  }

  /** Get the active tool. */
  getTool(): DrawToolType | null {
    return this.activeTool;
  }

  /** Update viewport state. */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /** Set the preview canvas for live rendering during draw. */
  setPreviewCanvas(canvas: HTMLCanvasElement): void {
    this.previewCanvas = canvas;
    this.previewCtx = canvas.getContext('2d');
  }

  /** Handle pointer down event. */
  handlePointerDown(e: PointerEvent, containerRect: DOMRect): void {
    if (!this.activeTool) return;

    // Delegate to pen tool for path creation
    if (this.activeTool === 'path') {
      this.penTool.handlePointerDown(e, containerRect);
      return;
    }

    const screenX = e.clientX - containerRect.left;
    const screenY = e.clientY - containerRect.top;
    this.startPoint = screenToScene([screenX, screenY], this.viewport);
    this.isDrawing = true;

    this.currentElement = this.createElement(this.startPoint, this.startPoint);
    this.renderPreview();
  }

  /** Handle pointer move event. */
  handlePointerMove(e: PointerEvent, containerRect: DOMRect): void {
    if (!this.activeTool) return;

    // Delegate to pen tool for path creation
    if (this.activeTool === 'path') {
      this.penTool.handlePointerMove(e, containerRect);
      return;
    }

    if (!this.isDrawing || !this.currentElement) return;

    const screenX = e.clientX - containerRect.left;
    const screenY = e.clientY - containerRect.top;
    const currentPoint = screenToScene([screenX, screenY], this.viewport);

    this.currentElement = this.updateElement(this.currentElement, this.startPoint, currentPoint);
    this.renderPreview();
  }

  /** Handle pointer up event. Finalizes the element into the scene. */
  handlePointerUp(e: PointerEvent): void {
    if (!this.activeTool) return;

    // Delegate to pen tool for path creation
    if (this.activeTool === 'path') {
      this.penTool.handlePointerUp(e);
      return;
    }

    if (!this.isDrawing || !this.currentElement) return;

    this.isDrawing = false;

    if (this.hasMinimumSize(this.currentElement)) {
      this.scene.upsertElement(this.currentElement);
      this.onElementCreated(this.currentElement);
    }

    this.currentElement = null;
    this.clearPreview();
  }

  /** Cancel the current drawing operation. */
  cancelDrawing(): void {
    if (this.activeTool === 'path') {
      this.penTool.cancelPath();
      return;
    }
    this.isDrawing = false;
    this.currentElement = null;
    this.clearPreview();
  }

  /** Handle double-click event (for pen tool path completion). */
  handleDoubleClick(e: PointerEvent): void {
    if (this.activeTool === 'path') {
      this.penTool.handleDoubleClick(e);
    }
  }

  /** Handle keydown event (for pen tool Enter/Escape). */
  handleKeyDown(e: KeyboardEvent): void {
    if (this.activeTool === 'path') {
      this.penTool.handleKeyDown(e);
    }
  }

  /** Handle path preview updates from pen tool. */
  private handlePathPreview(preview: PathElement | null): void {
    if (this.onPathPreview) {
      this.onPathPreview(preview);
    }
  }

  /** Get the current preview element being drawn. */
  getPreviewElement(): Element | null {
    return this.currentElement;
  }

  private createElement(start: Point, end: Point): Element {
    const definition = this.activeTool ? defaultShapeRegistry.get(this.activeTool) : undefined;

    const id = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseProps: Record<string, unknown> = {
      id,
      ...this.getBaseDefaults(),
      ...(definition?.getDefaultProps() ?? {}),
    };

    // Apply onCreateDrag to get initial position/size
    if (definition?.onCreateDrag) {
      const dragProps = definition.onCreateDrag(start, start, baseProps as unknown as BaseElement);
      Object.assign(baseProps, dragProps);
    } else {
      // Fallback for types without a definition
      baseProps.x = Math.min(start[0], end[0]);
      baseProps.y = Math.min(start[1], end[1]);
      baseProps.width = Math.abs(end[0] - start[0]);
      baseProps.height = Math.abs(end[1] - start[1]);
    }

    return baseProps as unknown as Element;
  }

  private updateElement(element: Element, start: Point, end: Point): Element {
    const definition = defaultShapeRegistry.get(element.type);

    if (definition?.onCreateDrag) {
      const updates = definition.onCreateDrag(start, end, element);
      return { ...element, ...updates } as Element;
    }

    // Fallback: update x/y/width/height generically
    return {
      ...element,
      x: Math.min(start[0], end[0]),
      y: Math.min(start[1], end[1]),
      width: Math.abs(end[0] - start[0]),
      height: Math.abs(end[1] - start[1]),
    };
  }

  private hasMinimumSize(el: Element): boolean {
    const definition = defaultShapeRegistry.get(el.type);

    if (definition?.hasMinimumSize) {
      return definition.hasMinimumSize(el);
    }

    // Default: width > 2 && height > 2
    return el.width > 2 && el.height > 2;
  }

  private renderPreview(): void {
    if (!this.previewCanvas || !this.previewCtx || !this.currentElement) return;

    const ctx = this.previewCtx;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.previewCanvas.width / dpr, this.previewCanvas.height / dpr);

    // Apply viewport transform
    ctx.translate(this.viewport.scrollX * this.viewport.zoom, this.viewport.scrollY * this.viewport.zoom);
    ctx.scale(this.viewport.zoom, this.viewport.zoom);

    // Draw preview element with dashed stroke
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#4a90d9';
    ctx.lineWidth = this.currentElement.strokeWidth || 1;
    ctx.setLineDash([5, 5]);

    // Use the shape registry to render the preview
    const definition = defaultShapeRegistry.get(this.currentElement.type);
    if (definition) {
      definition.render(ctx, this.currentElement, this.viewport);
    } else {
      ctx.strokeRect(this.currentElement.x, this.currentElement.y, this.currentElement.width, this.currentElement.height);
    }

    ctx.restore();
  }

  private clearPreview(): void {
    if (!this.previewCanvas || !this.previewCtx) return;
    const dpr = window.devicePixelRatio || 1;
    this.previewCtx.save();
    this.previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.previewCtx.clearRect(0, 0, this.previewCanvas.width / dpr, this.previewCanvas.height / dpr);
    this.previewCtx.restore();
  }

  private getBaseDefaults(): Record<string, unknown> {
    return {
      type: this.activeTool,
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
    };
  }
}
