import { Viewport, clampZoom, screenToScene } from '../render/viewport';

/**
 * Pan and zoom interaction handler.
 * Handles middle-mouse drag for pan, scroll wheel for zoom.
 */
export class PanZoom {
  private viewport: Viewport;
  private container: HTMLElement;
  private isPanning: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private spacePressed: boolean = false;
  private onUpdate: (viewport: Viewport) => void;

  /**
   * Create a new pan/zoom handler.
   * @param container - Container element to attach events to
   * @param viewport - Initial viewport state
   * @param onUpdate - Callback when viewport changes
   */
  constructor(container: HTMLElement, viewport: Viewport, onUpdate: (viewport: Viewport) => void) {
    this.container = container;
    this.viewport = { ...viewport };
    this.onUpdate = onUpdate;

    this.bindEvents();
  }

  /**
   * Get current viewport state.
   */
  getViewport(): Viewport {
    return { ...this.viewport };
  }

  /**
   * Check if a pan operation is currently in progress.
   */
  isPanningActive(): boolean {
    return this.isPanning;
  }

  /**
   * Set viewport state programmatically.
   * @param viewport - New viewport state
   */
  setViewport(viewport: Viewport): void {
    this.viewport = { ...viewport };
    this.onUpdate(this.viewport);
  }

  /**
   * Bind all event listeners.
   */
  private bindEvents(): void {
    // Mouse events for pan
    this.container.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);

    // Wheel event for zoom
    this.container.addEventListener('wheel', this.handleWheel, { passive: false });

    // Keyboard events for space+drag pan
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    // Prevent context menu on middle click
    this.container.addEventListener('contextmenu', this.handleContextMenu);
  }

  /**
   * Remove all event listeners.
   */
  destroy(): void {
    this.container.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    this.container.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.container.removeEventListener('contextmenu', this.handleContextMenu);
  }

  /** Named handler so destroy() can remove it (anonymous arrow would leak). */
  private handleContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /**
   * Handle mouse down for pan start.
   */
  private handleMouseDown = (e: MouseEvent): void => {
    // Middle mouse button or space+left click
    if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
      this.isPanning = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      e.preventDefault();
    }
  };

  /**
   * Handle mouse move for pan.
   */
  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.isPanning) return;

    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;

    this.viewport.scrollX += dx / this.viewport.zoom;
    this.viewport.scrollY += dy / this.viewport.zoom;

    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    this.onUpdate(this.viewport);
  };

  /**
   * Handle mouse up for pan end.
   */
  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 1 || (e.button === 0 && this.spacePressed)) {
      this.isPanning = false;
    }
  };

  /**
   * Handle wheel event for zoom.
   * Zoom is centered at cursor position.
   */
  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();

    // Determine if this is a zoom or pan
    const isZoom = e.ctrlKey || e.metaKey;

    if (isZoom) {
      // Zoom
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = clampZoom(this.viewport.zoom * zoomFactor);

      // Get cursor position in screen coordinates
      const rect = this.container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      // Get cursor position in scene coordinates before zoom
      const scenePoint = screenToScene([cursorX, cursorY], this.viewport);

      // Apply new zoom
      this.viewport.zoom = newZoom;

      // Calculate new scroll to keep cursor at same scene point
      // After zoom, the cursor should still be at the same scene point
      this.viewport.scrollX = cursorX / newZoom - scenePoint[0];
      this.viewport.scrollY = cursorY / newZoom - scenePoint[1];
    } else {
      // Pan (scroll)
      this.viewport.scrollX -= e.deltaX / this.viewport.zoom;
      this.viewport.scrollY -= e.deltaY / this.viewport.zoom;
    }

    this.onUpdate(this.viewport);
  };

  /**
   * Handle key down for space bar (pan mode).
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !e.repeat) {
      this.spacePressed = true;
      this.container.style.cursor = 'grab';
    }
  };

  /**
   * Handle key up for space bar.
   */
  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spacePressed = false;
      this.container.style.cursor = 'default';
    }
  };
}
