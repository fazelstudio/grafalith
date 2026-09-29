import { describe, expect, test } from 'bun:test';
import { resolveTheme } from './theme-provider';
import { defaultTheme } from './default-theme';

describe('resolveTheme', () => {
  test('returns default theme when no override provided', () => {
    const theme = resolveTheme();
    expect(theme).toEqual(defaultTheme);
  });

  test('returns a copy, not the same reference as defaultTheme', () => {
    const theme = resolveTheme();
    expect(theme).not.toBe(defaultTheme);
    expect(theme.colors).not.toBe(defaultTheme.colors);
  });

  test('overrides a single color field, rest stays default', () => {
    const theme = resolveTheme({ colors: { selectionOutline: '#ff0000' } });
    expect(theme.colors.selectionOutline).toBe('#ff0000');
    expect(theme.colors.canvasBackground).toBe(defaultTheme.colors.canvasBackground);
    expect(theme.colors.handleFill).toBe(defaultTheme.colors.handleFill);
    expect(theme.colors.handleStroke).toBe(defaultTheme.colors.handleStroke);
    expect(theme.colors.rubberBandFill).toBe(defaultTheme.colors.rubberBandFill);
    expect(theme.colors.rubberBandStroke).toBe(defaultTheme.colors.rubberBandStroke);
    expect(theme.colors.gridLine).toBe(defaultTheme.colors.gridLine);
  });

  test('overrides a single size field, rest stays default', () => {
    const theme = resolveTheme({ sizes: { handleSize: 12 } });
    expect(theme.sizes.handleSize).toBe(12);
    expect(theme.sizes.rotateHandleRadius).toBe(defaultTheme.sizes.rotateHandleRadius);
    expect(theme.sizes.rotateHandleOffset).toBe(defaultTheme.sizes.rotateHandleOffset);
    expect(theme.sizes.selectionOutlineWidth).toBe(defaultTheme.sizes.selectionOutlineWidth);
  });

  test('overrides fonts field', () => {
    const theme = resolveTheme({
      fonts: { family: 'Arial, sans-serif', availableFamilies: ['Arial', 'Helvetica'] },
    });
    expect(theme.fonts.family).toBe('Arial, sans-serif');
    expect(theme.fonts.availableFamilies).toEqual(['Arial', 'Helvetica']);
  });

  test('overrides borderRadius field', () => {
    const theme = resolveTheme({ borderRadius: { handle: 4, panel: 12 } });
    expect(theme.borderRadius.handle).toBe(4);
    expect(theme.borderRadius.panel).toBe(12);
  });

  test('partial override in nested objects preserves sibling defaults', () => {
    const theme = resolveTheme({
      colors: { canvasBackground: '#000000' },
      sizes: { handleSize: 16 },
    });
    // colors: only canvasBackground changed
    expect(theme.colors.canvasBackground).toBe('#000000');
    expect(theme.colors.selectionOutline).toBe(defaultTheme.colors.selectionOutline);
    // sizes: only handleSize changed
    expect(theme.sizes.handleSize).toBe(16);
    expect(theme.sizes.rotateHandleRadius).toBe(defaultTheme.sizes.rotateHandleRadius);
    // fonts and borderRadius: completely default
    expect(theme.fonts).toEqual(defaultTheme.fonts);
    expect(theme.borderRadius).toEqual(defaultTheme.borderRadius);
  });

  test('empty override object returns default theme values', () => {
    const theme = resolveTheme({});
    expect(theme).toEqual(defaultTheme);
  });
});
