import type { FazelidrawTheme, ThemeOverride } from './types';
import { defaultTheme } from './default-theme';

/**
 * Deep-merge a partial theme override onto the default theme.
 * Only the fields the developer provides are replaced; everything else
 * keeps the default value.
 *
 * This function should be called **once** at engine initialization.
 * The resolved result is stored and passed into render functions —
 * it must NOT be called per-frame (see ARCHITECTURE.md §9.6).
 *
 * @param override - Partial theme from the developer (all fields optional)
 * @returns Fully resolved theme with defaults for any missing fields
 */
export function resolveTheme(override?: ThemeOverride): FazelidrawTheme {
  // Always deep-copy to avoid mutating the defaultTheme or returned references.
  return {
    colors: { ...defaultTheme.colors, ...override?.colors },
    fonts: {
      ...defaultTheme.fonts,
      ...override?.fonts,
      availableFamilies: override?.fonts?.availableFamilies ?? defaultTheme.fonts.availableFamilies,
    },
    sizes: { ...defaultTheme.sizes, ...override?.sizes },
    borderRadius: { ...defaultTheme.borderRadius, ...override?.borderRadius },
  };
}
