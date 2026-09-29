/**
 * Canvas layers for dual-canvas architecture.
 * Static canvas for elements, interactive canvas for UI overlays.
 */
export interface CanvasLayers {
  staticCanvas: HTMLCanvasElement;
  interactiveCanvas: HTMLCanvasElement;
  staticCtx: CanvasRenderingContext2D;
  interactiveCtx: CanvasRenderingContext2D;
  container: HTMLDivElement;
  resize: (width: number, height: number) => void;
}

/**
 * Create dual-canvas setup with proper devicePixelRatio handling.
 * @param container - Parent container element
 * @returns Canvas layers object
 */
export function createCanvasLayers(container: HTMLDivElement): CanvasLayers {
  const dpr = window.devicePixelRatio || 1;

  // Create container div
  container.style.position = 'relative';
  container.style.overflow = 'hidden';

  // Create static canvas (for elements)
  const staticCanvas = document.createElement('canvas');
  staticCanvas.style.position = 'absolute';
  staticCanvas.style.top = '0';
  staticCanvas.style.left = '0';
  staticCanvas.style.width = '100%';
  staticCanvas.style.height = '100%';
  container.appendChild(staticCanvas);

  // Create interactive canvas (for UI overlays)
  const interactiveCanvas = document.createElement('canvas');
  interactiveCanvas.style.position = 'absolute';
  interactiveCanvas.style.top = '0';
  interactiveCanvas.style.left = '0';
  interactiveCanvas.style.width = '100%';
  interactiveCanvas.style.height = '100%';
  container.appendChild(interactiveCanvas);

  // Get contexts
  const staticCtx = staticCanvas.getContext('2d')!;
  const interactiveCtx = interactiveCanvas.getContext('2d')!;

  /**
   * Resize both canvases to match container size.
   * @param width - Width in CSS pixels
   * @param height - Height in CSS pixels
   */
  function resize(width: number, height: number): void {
    // Set CSS size
    staticCanvas.style.width = `${width}px`;
    staticCanvas.style.height = `${height}px`;
    interactiveCanvas.style.width = `${width}px`;
    interactiveCanvas.style.height = `${height}px`;

    // Set actual pixel size (multiply by dpr for sharp rendering)
    staticCanvas.width = width * dpr;
    staticCanvas.height = height * dpr;
    interactiveCanvas.width = width * dpr;
    interactiveCanvas.height = height * dpr;

    // Scale contexts for devicePixelRatio
    staticCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    interactiveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  return {
    staticCanvas,
    interactiveCanvas,
    staticCtx,
    interactiveCtx,
    container,
    resize,
  };
}
