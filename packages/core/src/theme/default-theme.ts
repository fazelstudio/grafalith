import type { FazelidrawTheme } from './types';

/**
 * Default theme — values match the hardcoded constants from v1 exactly,
 * ensuring zero visual regression when no custom theme is provided.
 */
export const defaultTheme: FazelidrawTheme = {
  colors: {
    canvasBackground: '#ffffff',
    selectionOutline: '#4a90d9',
    handleFill: '#ffffff',
    handleStroke: '#4a90d9',
    rubberBandFill: 'rgba(74, 144, 217, 0.15)',
    rubberBandStroke: 'rgba(74, 144, 217, 0.8)',
    gridLine: '#e0e0e0',
    canvasOutOfBoundsOverlay: 'rgba(0, 0, 0, 0.08)',
    canvasBoundsBorder: 'rgba(0, 0, 0, 0.2)',
  },
  fonts: {
    family: 'Virgil, Hand-drawn, sans-serif',
    availableFamilies: ['Virgil', 'Hand-drawn', 'sans-serif'],
  },
  sizes: {
    handleSize: 8,
    rotateHandleRadius: 6,
    rotateHandleOffset: 24,
    selectionOutlineWidth: 1.5,
    rotateHandleLineWidth: 1,
    handleLineWidth: 1.5,
    boundingBoxHitThreshold: 4,
  },
  borderRadius: {
    handle: 0,
    panel: 8,
  },
};
