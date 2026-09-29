import { Scene, Element } from '../scene';
import { Viewport, getViewportBounds } from './viewport';
import { CanvasLayers } from './canvas-layers';
import { renderElement } from '../shapes';
import type { FazelidrawTheme } from '../theme/types';
import { defaultTheme } from '../theme/default-theme';
import { renderCanvasBoundary } from './canvas-bounds';
import type { CanvasMode } from './canvas-mode';
import { DEFAULT_CANVAS_MODE } from './canvas-mode';
import type { ComponentRegistry } from '../components/component-registry';
import { defaultComponentRegistry } from '../components/component-registry';
import { resolveInstance, InstanceResolveCache } from '../components/instance-sync';
import type { InstanceElement } from '../scene/types';

/** Grid rendering configuration. */
export interface GridConfig {
  /** Whether to show the grid on the static canvas. */
  showGrid: boolean;
  /** Grid cell size in scene units. */
  gridSize: number;
}

/**
 * Interaction state for the interactive canvas.
 * This will be expanded in future phases.
 */
export interface InteractionState {
  // Placeholder for future interaction state
  [key: string]: unknown;
}

/**
 * Render loop that manages canvas updates.
 * Uses requestAnimationFrame and sceneNonce for efficient rendering.
 */
export class RenderLoop {
  private scene: Scene;
  private canvasLayers: CanvasLayers;
  private viewport: Viewport;
  private theme: FazelidrawTheme;
  private canvasMode: CanvasMode;
  private interactionState: InteractionState = {};
  private lastSceneNonce: number = -1;
  private lastScrollX: number = NaN;
  private lastScrollY: number = NaN;
  private lastZoom: number = NaN;
  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private suppressStaticRender: boolean = false;
  private gridConfig: GridConfig = { showGrid: false, gridSize: 20 };
  private componentRegistry: ComponentRegistry = defaultComponentRegistry;
  private instanceCache: InstanceResolveCache = new InstanceResolveCache();
  /** Set by theme/grid/mode/registry setters to force a static repaint. */
  private configDirty: boolean = false;

  /**
   * Create a new render loop.
   * @param scene - Scene to render
   * @param canvasLayers - Canvas layers to render to
   * @param viewport - Initial viewport state
   * @param theme - Resolved theme (from resolveTheme, called once at init)
   * @param canvasMode - Canvas mode configuration (infinite or bounded)
   */
  constructor(scene: Scene, canvasLayers: CanvasLayers, viewport: Viewport, theme?: FazelidrawTheme, canvasMode?: CanvasMode) {
    this.scene = scene;
    this.canvasLayers = canvasLayers;
    this.viewport = viewport;
    this.theme = theme ?? defaultTheme;
    this.canvasMode = canvasMode ?? DEFAULT_CANVAS_MODE;
  }

  /**
   * Get the resolved theme.
   */
  getTheme(): FazelidrawTheme {
    return this.theme;
  }

  /**
   * Update the theme. Should be called only when the developer changes the
   * theme at runtime (rare). The new theme is applied from the next frame.
   * @param theme - New resolved theme
   */
  setTheme(theme: FazelidrawTheme): void {
    this.theme = theme;
    this.configDirty = true;
  }

  /**
   * Get the canvas mode.
   */
  getCanvasMode(): CanvasMode {
    return this.canvasMode;
  }

  /**
   * Update the canvas mode.
   * @param mode - New canvas mode
   */
  setCanvasMode(mode: CanvasMode): void {
    this.canvasMode = mode;
    this.configDirty = true;
  }

  /**
   * Start the render loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tick();
  }

  /**
   * Stop the render loop.
   */
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.isRunning = false;
  }

  /**
   * Update the viewport state.
   * @param viewport - New viewport state
   */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  /**
   * Update the interaction state.
   * @param state - New interaction state
   */
  setInteractionState(state: InteractionState): void {
    this.interactionState = state;
  }

  /**
   * Suppress static canvas rendering (used during drag to avoid ghosting).
   * The interactive canvas continues to render normally.
   */
  setSuppressStaticRender(suppress: boolean): void {
    this.suppressStaticRender = suppress;
  }

  /**
   * Set grid rendering configuration.
   * @param config - Grid config (showGrid, gridSize)
   */
  setGridConfig(config: GridConfig): void {
    this.gridConfig = config;
    this.configDirty = true;
  }

  /**
   * Get the current grid configuration.
   */
  getGridConfig(): GridConfig {
    return this.gridConfig;
  }

  /**
   * Set the component registry for instance resolution.
   * @param registry - ComponentRegistry to use
   */
  setComponentRegistry(registry: ComponentRegistry): void {
    this.componentRegistry = registry;
    this.configDirty = true;
  }

  /**
   * Get the instance resolve cache (for manual invalidation if needed).
   */
  getInstanceCache(): InstanceResolveCache {
    return this.instanceCache;
  }

  /**
   * Invalidate instance cache (call when master or overrides change).
   */
  invalidateInstanceCache(): void {
    this.instanceCache.invalidateAll();
  }

  /**
   * Get the canvas layers (for manual rendering during suppressed state).
   */
  getCanvasLayers(): CanvasLayers {
    return this.canvasLayers;
  }

  /**
   * Main render loop tick.
   */
  private tick = (): void => {
    if (!this.isRunning) return;

    this.render();
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  /**
   * Perform a single render cycle.
   */
  private render(): void {
    const currentNonce = this.scene.getSceneNonce();
    const vp = this.viewport;

    // Check if we need to re-render static canvas
    const viewportChanged =
      vp.scrollX !== this.lastScrollX || vp.scrollY !== this.lastScrollY || vp.zoom !== this.lastZoom;
    const staticNeedsUpdate = currentNonce !== this.lastSceneNonce || viewportChanged || this.configDirty;

    if (staticNeedsUpdate && !this.suppressStaticRender) {
      // Invalidate instance cache when scene changes (master elements may have changed)
      if (currentNonce !== this.lastSceneNonce) {
        this.instanceCache.invalidateAll();
      }
      this.renderStaticScene();
      this.lastSceneNonce = currentNonce;
      this.lastScrollX = vp.scrollX;
      this.lastScrollY = vp.scrollY;
      this.lastZoom = vp.zoom;
      this.configDirty = false;
    }

    // Always render interactive canvas (it changes every frame during interaction)
    this.renderInteractiveScene();
  }

  /**
   * Render the static canvas (elements).
   */
  private renderStaticScene(): void {
    const { staticCtx, staticCanvas } = this.canvasLayers;
    const dpr = window.devicePixelRatio || 1;

    // Clear canvas
    staticCtx.save();
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    staticCtx.clearRect(0, 0, staticCanvas.width / dpr, staticCanvas.height / dpr);

    // Apply viewport transform
    staticCtx.translate(this.viewport.scrollX * this.viewport.zoom, this.viewport.scrollY * this.viewport.zoom);
    staticCtx.scale(this.viewport.zoom, this.viewport.zoom);

    // Compute canvas dimensions in CSS pixels
    const canvasWidth = staticCanvas.width / dpr;
    const canvasHeight = staticCanvas.height / dpr;

    // Render canvas boundary overlay (behind everything) for bounded mode
    renderCanvasBoundary(staticCtx, this.canvasMode, this.viewport, this.theme, canvasWidth, canvasHeight);

    // Render grid (behind all elements)
    if (this.gridConfig.showGrid && this.gridConfig.gridSize > 0) {
      this.renderGrid(staticCtx, canvasWidth, canvasHeight);
    }

    // Get visible elements via spatial grid query
    const vpBounds = getViewportBounds(this.viewport, canvasWidth, canvasHeight);
    const viewportBounds = {
      minX: vpBounds.x,
      minY: vpBounds.y,
      maxX: vpBounds.x + vpBounds.width,
      maxY: vpBounds.y + vpBounds.height,
    };
    const grid = this.scene.getSpatialGrid();
    const candidateIds = grid.queryBounds(viewportBounds);

    const visibleElements: Element[] = [];
    for (const id of candidateIds) {
      const el = this.scene.getElement(id);
      if (el && !el.isDeleted && !el.hidden) {
        // Resolve instance elements into their final visual children
        if (el.type === 'instance') {
          const instance = el as InstanceElement;
          const component = this.componentRegistry.get(instance.componentId);
          if (component) {
            // Check cache first
            const masterVersions: number[] = component.rootElementIds.map((rid) => {
              const master = this.scene.getElement(rid);
              return master?.version ?? 0;
            });
            const cached = this.instanceCache.get(instance.id, instance.version, masterVersions);
            if (cached) {
              visibleElements.push(...cached);
            } else {
              const resolved = resolveInstance(instance, component, this.scene);
              this.instanceCache.set(instance.id, instance.version, masterVersions, resolved);
              visibleElements.push(...resolved);
            }
          }
        } else {
          visibleElements.push(el);
        }
      }
    }

    // Paint in z-order: grid query order is spatial, not z-order. Without
    // this sort, bringToFront/sendToBack may have no visual effect.
    const orderIndex = new Map<string, number>();
    const elementOrder = this.scene.getElementOrder();
    for (let i = 0; i < elementOrder.length; i++) orderIndex.set(elementOrder[i], i);
    visibleElements.sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    // Partition: framed children are drawn ONLY inside their frame's clip
    // pass (not in the base pass). Otherwise clipped overflow stays visible
    // via the first pass and children double-draw (alpha double-blend).
    const framedChildIds = new Set<string>();
    const frameIdsInView = new Set<string>();
    for (const el of visibleElements) {
      if (el.type === 'frame') frameIdsInView.add(el.id);
    }
    for (const el of visibleElements) {
      if (el.type !== 'frame' && typeof el.frameId === 'string' && el.frameId && frameIdsInView.has(el.frameId)) {
        framedChildIds.add(el.id);
      }
    }
    // Separate frames from other elements for clipping pass
    const frames = visibleElements.filter((el) => el.type === 'frame');
    const nonFrameElements = visibleElements.filter((el) => el.type !== 'frame' && !framedChildIds.has(el.id));

    // Render non-frame elements first (behind frames)
    for (const element of nonFrameElements) {
      renderElement(staticCtx, element, this.viewport);
    }

    // Collect visible-frame children once (O(N) total, not O(F·N)): index by frameId.
    const childrenByFrame = new Map<string, Element[]>();
    for (const el of visibleElements) {
      if (el.type !== 'frame' && typeof el.frameId === 'string' && el.frameId) {
        const list = childrenByFrame.get(el.frameId);
        if (list) list.push(el);
        else childrenByFrame.set(el.frameId, [el]);
      }
    }

    // Render frames with clipping if clipContent is true
    for (const frame of frames) {
      if (frame.type === 'frame' && frame.clipContent) {
        // Save context state
        staticCtx.save();
        // Clip to frame bounds
        staticCtx.beginPath();
        staticCtx.rect(frame.x, frame.y, frame.width, frame.height);
        staticCtx.clip();
      }

      // Render the frame itself
      renderElement(staticCtx, frame, this.viewport);

      // Render children of this frame (already culled + z-sorted via visibleElements order)
      const children = childrenByFrame.get(frame.id) ?? [];
      for (const child of children) {
        // Child may belong to a frame outside the viewport query (culled frame
        // but visible child): still respect clip by only drawing when the frame
        // itself is in view (this pass), which holds by construction.
        renderElement(staticCtx, child, this.viewport);
      }

      if (frame.type === 'frame' && frame.clipContent) {
        // Restore context state
        staticCtx.restore();
      }
    }

    staticCtx.restore();
  }

  /**
   * Render grid lines on the static canvas.
   */
  private renderGrid(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
    const { gridSize } = this.gridConfig;
    const vp = this.viewport;

    // Compute visible bounds in scene coordinates
    const topLeft = [0 / vp.zoom - vp.scrollX, 0 / vp.zoom - vp.scrollY] as [number, number];
    const bottomRight = [canvasWidth / vp.zoom - vp.scrollX, canvasHeight / vp.zoom - vp.scrollY] as [number, number];

    const startX = Math.floor(topLeft[0] / gridSize) * gridSize;
    const endX = Math.ceil(bottomRight[0] / gridSize) * gridSize;
    const startY = Math.floor(topLeft[1] / gridSize) * gridSize;
    const endY = Math.ceil(bottomRight[1] / gridSize) * gridSize;

    ctx.strokeStyle = this.theme.colors.gridLine;
    ctx.lineWidth = 0.5 / vp.zoom; // constant screen-space width
    ctx.setLineDash([]);

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();
  }

  /**
   * Render the interactive canvas (UI overlays).
   * Currently a no-op — the consumer (e.g. demo app) manages interactive canvas
   * rendering via its own rAF loop and dirty-flag. This method is reserved for
   * future built-in interactive rendering in the core package.
   */
  private renderInteractiveScene(): void {
    // Intentionally empty: interactive canvas is managed by the consumer.
    // Do NOT clear the canvas here — it would fight with the consumer's
    // own rendering loop and cause selection overlays to flicker.
  }

}
