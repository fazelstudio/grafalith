/** Semantic color roles consumed by desktop UI. No raw colors in components. */
export interface ColorTokens {
  bgBase: string;
  bgElevated: string;
  bgSubtle: string;
  fgPrimary: string;
  fgSecondary: string;
  fgMuted: string;
  borderSubtle: string;
  borderStrong: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  success: string;
  warning: string;
  focusRing: string;
  selection: string;
  canvasBg: string;
  canvasGrid: string;
  canvasGuide: string;
}

/** Spacing scale steps; components map dimensions to these tokens. */
export interface SpacingTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  xxl: string;
  xxxl: string;
}

/** Text roles; components pick a role instead of raw font values. */
export interface TypographyTokens {
  display: string;
  sectionHeading: string;
  body: string;
  bodySmall: string;
  label: string;
  compact: string;
  code: string;
}

/** Shape and depth tokens. */
export interface ShapeTokens {
  radiusXs: string;
  radiusSm: string;
  radiusMd: string;
  radiusLg: string;
  radiusFull: string;
}

export interface DepthTokens {
  shadowSubtle: string;
  shadowMedium: string;
  shadowStrong: string;
}

/** Motion tokens; structural navigation stays unanimated. */
export interface MotionTokens {
  fast: string;
  standard: string;
  panelEnter: string;
}

export interface FocusTokens {
  ringWidth: string;
  ringOffset: string;
}

export interface ControlSizeTokens {
  sm: string;
  md: string;
  lg: string;
}

/** Full semantic token set for one resolved theme. */
export interface SemanticTokens {
  colors: ColorTokens;
  spacing: SpacingTokens;
  typography: TypographyTokens;
  radii: ShapeTokens;
  depth: DepthTokens;
  motion: MotionTokens;
  focus: FocusTokens;
  controlHeight: ControlSizeTokens;
}

export type ResolvedTheme = 'light' | 'dark';
export type ThemeMode = 'system' | ResolvedTheme;

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME_MODE: ThemeMode = 'system';

const spacing: SpacingTokens = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '48px',
};

const typography: TypographyTokens = {
  display: '600 24px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  sectionHeading: '600 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  body: '400 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  bodySmall: '400 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  label: '500 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  compact: '500 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  code: '400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
};

const radii: ShapeTokens = {
  radiusXs: '4px',
  radiusSm: '6px',
  radiusMd: '8px',
  radiusLg: '12px',
  radiusFull: '9999px',
};

const depth: DepthTokens = {
  shadowSubtle: '0 1px 2px rgba(0, 0, 0, 0.08)',
  shadowMedium: '0 2px 8px rgba(0, 0, 0, 0.12)',
  shadowStrong: '0 4px 16px rgba(0, 0, 0, 0.18)',
};

const motion: MotionTokens = {
  fast: '120ms ease',
  standard: '180ms ease',
  panelEnter: '220ms ease',
};

const focus: FocusTokens = {
  ringWidth: '2px',
  ringOffset: '2px',
};

const controlHeight: ControlSizeTokens = {
  sm: '28px',
  md: '32px',
  lg: '40px',
};

const lightColors: ColorTokens = {
  bgBase: '#ffffff',
  bgElevated: '#f5f5f4',
  bgSubtle: '#ececea',
  fgPrimary: '#1a1a1a',
  fgSecondary: '#4a4a45',
  fgMuted: '#73736e',
  borderSubtle: '#e2e2df',
  borderStrong: '#c9c9c4',
  accent: '#2f6fed',
  accentForeground: '#ffffff',
  destructive: '#c9362b',
  success: '#1f7a3d',
  warning: '#9a6700',
  focusRing: '#2f6fed',
  selection: 'rgba(47, 111, 237, 0.14)',
  canvasBg: '#f0efec',
  canvasGrid: '#e0dfda',
  canvasGuide: '#e5484d',
};

const darkColors: ColorTokens = {
  bgBase: '#1c1c1a',
  bgElevated: '#262624',
  bgSubtle: '#323230',
  fgPrimary: '#f2f1ec',
  fgSecondary: '#c9c8c1',
  fgMuted: '#9a998f',
  borderSubtle: '#35352f',
  borderStrong: '#4d4d45',
  accent: '#5b8def',
  accentForeground: '#0f1526',
  destructive: '#e5484d',
  success: '#46a758',
  warning: '#e8a100',
  focusRing: '#5b8def',
  selection: 'rgba(91, 141, 239, 0.22)',
  canvasBg: '#141412',
  canvasGrid: '#26261f',
  canvasGuide: '#e5484d',
};

/**
 * Token set per resolved theme. A future theme is added by supplying one
 * more entry here plus matching CSS variables; components stay unchanged.
 */
export const themeTokens: Record<ResolvedTheme, SemanticTokens> = {
  light: {
    colors: lightColors,
    spacing,
    typography,
    radii,
    depth,
    motion,
    focus,
    controlHeight,
  },
  dark: {
    colors: darkColors,
    spacing,
    typography,
    radii,
    depth,
    motion,
    focus,
    controlHeight,
  },
};

/** Resolve a user-facing mode to a concrete theme using the OS preference. */
export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return prefersDark ? 'dark' : 'light';
}

/** Type guard for persisted theme values. */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}
