import { TextElement } from '../scene/types';
import { Scene } from '../scene/scene';
import { Viewport, sceneToScreen } from '../render/viewport';
import { measureText } from '../shapes/text';

const LINE_HEIGHT_MULTIPLIER = 1.25;

/** Callback invoked after text editing commits or cancels. */
export type OnTextEditComplete = () => void;

/**
 * Manages in-place text editing via an HTML textarea overlay.
 * The textarea is positioned over the text element using sceneToScreen,
 * styled to match the canvas rendering (WYSIWYG), and auto-resizes.
 */
export class TextEditor {
  private scene: Scene;
  private viewport: Viewport;
  private container: HTMLDivElement;
  private onComplete: OnTextEditComplete;
  private textarea: HTMLTextAreaElement | null = null;
  private activeElementId: string | null = null;
  private isNewElement: boolean = false;

  constructor(
    scene: Scene,
    viewport: Viewport,
    container: HTMLDivElement,
    onComplete: OnTextEditComplete,
  ) {
    this.scene = scene;
    this.viewport = viewport;
    this.container = container;
    this.onComplete = onComplete;
  }

  /** Update viewport reference (called on pan/zoom). */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    if (this.textarea && this.activeElementId) {
      const el = this.scene.getElement(this.activeElementId);
      if (el && el.type === 'text') {
        this.positionTextarea(el);
      }
    }
  }

  /** Whether text editing is currently active. */
  isEditing(): boolean {
    return this.textarea !== null && this.activeElementId !== null;
  }

  /** Get the ID of the element being edited. */
  getEditingElementId(): string | null {
    return this.activeElementId;
  }

  /**
   * Start editing a text element. Creates and positions a textarea overlay.
   * @param elementId - The text element to edit
   * @param isNew - Whether this element was just created (auto-size on finish)
   * @param clickSceneX - Optional click position in scene X (for caret placement)
   * @param clickSceneY - Optional click position in scene Y (for caret placement)
   */
  startEditing(elementId: string, isNew: boolean = false, clickSceneX?: number, clickSceneY?: number): void {
    const el = this.scene.getElement(elementId);
    if (!el || el.type !== 'text') return;

    this.finishEditing();

    this.activeElementId = elementId;
    this.isNewElement = isNew;

    const ta = document.createElement('textarea');
    ta.value = el.text;
    ta.style.position = 'absolute';
    ta.style.overflow = 'hidden';
    ta.style.background = 'transparent';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.padding = '0';
    ta.style.margin = '0';
    ta.style.resize = 'none';
    ta.style.zIndex = '10';
    ta.style.lineHeight = `${LINE_HEIGHT_MULTIPLIER}`;
    ta.style.whiteSpace = 'pre';
    ta.style.wordWrap = 'normal';
    ta.style.fontFamily = el.fontFamily;
    ta.style.fontSize = `${el.fontSize}px`;
    ta.style.textAlign = el.textAlign;
    ta.style.color = el.strokeColor;
    ta.style.opacity = String(el.opacity / 100);

    this.textarea = ta;
    this.container.appendChild(ta);

    this.positionTextarea(el);

    ta.addEventListener('input', () => {
      this.onInput(ta, el);
    });

    ta.addEventListener('blur', () => {
      this.finishEditing();
    });

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // Escape commits (same as blur) — consistent with Figma/TLDraw convention
        this.finishEditing();
      }
    });

    // Auto-focus
    ta.focus();

    // Place caret near click position, or select all for new elements
    if (isNew || clickSceneX === undefined || clickSceneY === undefined) {
      ta.select();
    } else {
      // Estimate character position from click coordinates
      const caretIndex = this.estimateCaretPosition(el, clickSceneX, clickSceneY);
      ta.setSelectionRange(caretIndex, caretIndex);
    }
  }

  /**
   * Start editing at a canvas position. If a text element exists there, edit it.
   * Otherwise, create a new text element and start editing it.
   * @param sceneX - X position in scene coordinates
   * @param sceneY - Y position in scene coordinates
   * @param defaultFontSize - Font size for new text elements
   * @param defaultFontFamily - Font family for new text elements
   */
  startEditingAtPosition(
    sceneX: number,
    sceneY: number,
    defaultFontSize: number = 16,
    defaultFontFamily: string = 'Virgil',
    defaultStrokeColor: string = '#000000',
    defaultOpacity: number = 100,
  ): string {
    // Check if we clicked on an existing text element
    const elements = this.scene.getAllElements();
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.type === 'text' && !el.isDeleted) {
        if (
          sceneX >= el.x &&
          sceneX <= el.x + el.width &&
          sceneY >= el.y &&
          sceneY <= el.y + el.height
        ) {
          this.startEditing(el.id, false, sceneX, sceneY);
          return el.id;
        }
      }
    }

    // Create a new text element
    const id = crypto.randomUUID();
    const newEl = {
      id,
      type: 'text' as const,
      x: sceneX,
      y: sceneY,
      width: 100,
      height: defaultFontSize * LINE_HEIGHT_MULTIPLIER,
      rotation: 0,
      strokeColor: defaultStrokeColor,
      backgroundColor: { type: 'solid' as const, color: 'transparent' },
      strokeWidth: 1,
      strokeStyle: 'solid' as const,
      fillStyle: 'solid' as const,
      opacity: defaultOpacity,
      seed: Math.floor(Math.random() * 2_000_000_000),
      version: 0,
      versionNonce: Math.floor(Math.random() * 2_000_000_000),
      isDeleted: false,
      groupIds: [],
      locked: false,
      hidden: false,
      frameId: null,
      text: '',
      fontSize: defaultFontSize,
      fontFamily: defaultFontFamily,
      textAlign: 'left' as const,
      containerId: null,
    };

    this.scene.upsertElement(newEl);

    this.startEditing(id, true);
    return id;
  }

  /**
   * Finish editing and commit the current text to the scene.
   */
  finishEditing(): void {
    if (!this.textarea || !this.activeElementId) return;

    const el = this.scene.getElement(this.activeElementId);
    if (el && el.type === 'text') {
      const newText = this.textarea.value.trim();

      if (newText === '') {
        // Delete if empty via canonical path (version bump, grid removal).
        this.scene.deleteElement(el.id);
      } else if (this.isNewElement) {
        // New text element: auto-size box to fit content
        const tempCtx = getSharedMeasureContext();
        if (tempCtx) {
          const measured = measureText(tempCtx, newText, el.fontSize, el.fontFamily);
          const newWidth = Math.max(measured.width, 10);
          const newHeight = Math.max(measured.height, el.fontSize * LINE_HEIGHT_MULTIPLIER);

          this.scene.upsertElement({
            ...el,
            text: newText,
            width: newWidth,
            height: newHeight,
          });
        }
      } else {
        // Existing text element: re-measure so bounds do not go stale, but
        // keep the user's box unless content overflows it.
        const tempCtx = getSharedMeasureContext();
        let newWidth = el.width;
        let newHeight = el.height;
        if (tempCtx) {
          const measured = measureText(tempCtx, newText, el.fontSize, el.fontFamily);
          newWidth = Math.max(el.width, measured.width);
          newHeight = Math.max(el.height, measured.height, el.fontSize * LINE_HEIGHT_MULTIPLIER);
        }
        this.scene.upsertElement({
          ...el,
          text: newText,
          width: newWidth,
          height: newHeight,
        });
      }
    }

    this.removeTextarea();
    this.onComplete();
  }

  /**
   * Cancel editing without saving changes.
   */
  cancelEditing(): void {
    this.removeTextarea();
    this.onComplete();
  }

  /**
   * Estimate character index for caret placement based on click position.
   * Uses approximate character width from font size to map X coordinate to character index.
   */
  private estimateCaretPosition(el: TextElement, clickSceneX: number, clickSceneY: number): number {
    if (!el.text) return 0;

    // Approximate character width: ~0.6 * fontSize for most sans-serif fonts
    const approxCharWidth = el.fontSize * 0.6;

    // Calculate relative X position within the text element
    const relativeX = clickSceneX - el.x;

    // Calculate relative Y position for multi-line text
    const lineHeight = el.fontSize * LINE_HEIGHT_MULTIPLIER;
    const relativeY = clickSceneY - el.y;
    const lineIndex = Math.max(0, Math.floor(relativeY / lineHeight));

    // Split text into lines
    const lines = el.text.split('\n');

    // Clamp line index
    const clampedLineIndex = Math.min(lineIndex, lines.length - 1);

    // Calculate character index within the line
    const charIndexInLine = Math.round(relativeX / approxCharWidth);

    // Sum up characters from previous lines
    let index = 0;
    for (let i = 0; i < clampedLineIndex; i++) {
      index += lines[i].length + 1; // +1 for newline
    }

    // Add character index within the line (clamped to line length)
    index += Math.max(0, Math.min(charIndexInLine, lines[clampedLineIndex].length));

    return Math.max(0, Math.min(index, el.text.length));
  }

  private removeTextarea(): void {
    if (this.textarea) {
      this.textarea.remove();
      this.textarea = null;
      this.activeElementId = null;
    }
  }

  private positionTextarea(el: TextElement): void {
    if (!this.textarea) return;

    const [sx, sy] = sceneToScreen([el.x, el.y], this.viewport);
    const scaledWidth = el.width * this.viewport.zoom;
    const scaledHeight = el.height * this.viewport.zoom;

    this.textarea.style.left = `${sx}px`;
    this.textarea.style.top = `${sy}px`;
    this.textarea.style.width = `${Math.max(scaledWidth, 20)}px`;
    this.textarea.style.height = `${Math.max(scaledHeight, 20)}px`;
    this.textarea.style.fontSize = `${el.fontSize * this.viewport.zoom}px`;
  }

  private onInput(ta: HTMLTextAreaElement, _initialEl: TextElement): void {
    if (!this.activeElementId) return;
    const el = this.scene.getElement(this.activeElementId) as TextElement;
    if (!el || el.type !== 'text') return;

    // Auto-resize textarea as user types (visual only — don't update scene yet)
    const tempCtx = getSharedMeasureContext();
    if (tempCtx) {
      const measured = measureText(tempCtx, ta.value, el.fontSize, el.fontFamily);

      // Resize the textarea to match
      const scaledWidth = Math.max(measured.width, 10) * this.viewport.zoom;
      const scaledHeight = Math.max(measured.height, el.fontSize * LINE_HEIGHT_MULTIPLIER) * this.viewport.zoom;
      ta.style.width = `${Math.max(scaledWidth, 20)}px`;
      ta.style.height = `${Math.max(scaledHeight, 20)}px`;
    }
  }

  /** Release the overlay and stale container references (mount/unmount safety). */
  destroy(): void {
    this.removeTextarea();
  }
}

/** Shared canvas 2D context for text measurement (avoids per-keystroke alloc). */
let sharedMeasureCtx: CanvasRenderingContext2D | null | undefined;
function getSharedMeasureContext(): CanvasRenderingContext2D | null {
  if (sharedMeasureCtx !== undefined) return sharedMeasureCtx;
  try {
    const canvas = document.createElement('canvas');
    sharedMeasureCtx = canvas.getContext('2d');
  } catch {
    sharedMeasureCtx = null;
  }
  return sharedMeasureCtx;
}
