/**
 * Theme tokens for all visual UI properties of the Fazelidraw engine.
 * These control the appearance of the engine chrome (selection outlines,
 * handles, rubber-band, canvas background) — NOT the colors of user-drawn
 * elements (those are `strokeColor` / `backgroundColor` on `BaseElement`).
 */
export interface FazelidrawTheme {
  colors: {
    /** Canvas background color (CSS color string). */
    canvasBackground: string;
    /** Selection outline color. */
    selectionOutline: string;
    /** Resize handle fill color. */
    handleFill: string;
    /** Resize handle stroke color. */
    handleStroke: string;
    /** Rubber-band selection fill (usually semi-transparent). */
    rubberBandFill: string;
    /** Rubber-band selection border color. */
    rubberBandStroke: string;
    /** Background grid line color (for future grid overlay). */
    gridLine: string;
    /** Overlay color for area outside bounded canvas (semi-transparent). */
    canvasOutOfBoundsOverlay: string;
    /** Border color for bounded canvas boundary. */
    canvasBoundsBorder: string;
  };
  fonts: {
    /** Default font family for new TextElement. */
    family: string;
    /** Available font families shown in font picker (Phase 10). */
    availableFamilies: string[];
  };
  sizes: {
    /** Resize handle size in px. */
    handleSize: number;
    /** Rotate handle circle radius in px. */
    rotateHandleRadius: number;
    /** Distance (px) from selection box top-edge to rotate handle. */
    rotateHandleOffset: number;
    /** Selection outline stroke width in px. */
    selectionOutlineWidth: number;
    /** Rotate handle connector line width in px. */
    rotateHandleLineWidth: number;
    /** Handle connector line width (stroke of resize handles). */
    handleLineWidth: number;
    /** Hit-test tolerance (px) for bounding box edge click. */
    boundingBoxHitThreshold: number;
  };
  borderRadius: {
    /** Border radius for resize handles. */
    handle: number;
    /** Border radius for UI panels (Phase 10). */
    panel: number;
  };
}

/** Partial theme override provided by the developer. All fields optional. */
export type ThemeOverride = Partial<FazelidrawTheme> & {
  colors?: Partial<FazelidrawTheme['colors']>;
  fonts?: Partial<FazelidrawTheme['fonts']>;
  sizes?: Partial<FazelidrawTheme['sizes']>;
  borderRadius?: Partial<FazelidrawTheme['borderRadius']>;
};
