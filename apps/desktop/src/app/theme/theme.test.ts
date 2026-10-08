import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_THEME_MODE,
  THEME_MODES,
  isThemeMode,
  resolveThemeMode,
  themeTokens,
} from './tokens';
describe('theme system', () => {
  test('system is the default mode alongside light and dark', () => {
    expect(DEFAULT_THEME_MODE).toBe('system');
    expect([...THEME_MODES]).toEqual(['system', 'light', 'dark']);
  });

  test('system resolves from the OS preference without reload logic', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });

  test('persisted values are guarded', () => {
    expect(isThemeMode('system')).toBe(true);
    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('sepia')).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });

  test('each resolved theme supplies every token category', () => {
    for (const tokens of Object.values(themeTokens)) {
      for (const color of Object.values(tokens.colors)) {
        expect(color.length).toBeGreaterThan(0);
      }
      for (const color of Object.values(tokens.canvasOverlay)) {
        expect(color.length).toBeGreaterThan(0);
      }
      expect(Object.keys(tokens.spacing).length).toBeGreaterThan(0);
      expect(Object.keys(tokens.typography).length).toBeGreaterThan(0);
      expect(Object.keys(tokens.radii).length).toBeGreaterThan(0);
      expect(Object.keys(tokens.depth).length).toBeGreaterThan(0);
      expect(Object.keys(tokens.motion).length).toBeGreaterThan(0);
    }
  });

  test('light and dark themes differ on base surfaces', () => {
    expect(themeTokens.light.colors.bgBase).not.toBe(themeTokens.dark.colors.bgBase);
    expect(themeTokens.light.colors.fgPrimary).not.toBe(themeTokens.dark.colors.fgPrimary);
  });

  test('key surfaces differ across all three modes (system resolves, never renders)', () => {
    const surfaces = [
      'bgBase',
      'bgElevated',
      'fgPrimary',
      'borderSubtle',
      'accent',
      'focusRing',
      'canvasBg',
    ] as const;
    for (const role of surfaces) {
      expect(themeTokens.light.colors[role]).not.toBe(themeTokens.dark.colors[role]);
    }
    // System has no token set of its own; it resolves to one concrete theme.
    expect(THEME_MODES).toContain('system');
    expect(Object.keys(themeTokens).sort()).toEqual(['dark', 'light']);
  });
});

describe('theme css audit', () => {
  async function css(): Promise<string> {
    return Bun.file(new URL('./tokens.css', import.meta.url)).text();
  }

  function blockVariables(source: string, selector: string): Set<string> {
    const start = source.indexOf(selector);
    if (start === -1) return new Set();
    const open = source.indexOf('{', start);
    // The dark block ends at the first closing brace after its variables.
    const close = source.indexOf('}', open);
    const body = source.slice(open, close);
    const names = new Set<string>();
    for (const match of body.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]);
    return names;
  }

  test('light and dark blocks define the same variable set', async () => {
    const source = await css();
    const light = blockVariables(source, ":root[data-theme='light']");
    const dark = blockVariables(source, ":root[data-theme='dark']");
    expect(light.size).toBeGreaterThan(20);
    expect(dark.size).toBeGreaterThan(0);
    // Dark inherits shared scale tokens; every color token must be overridden.
    const colors = [...light].filter(
      (name) =>
        /--(bg|fg|border|accent|destructive|success|warning|canvas)-/.test(name) ||
        name === '--focus-ring' ||
        name === '--selection',
    );
    expect(colors.length).toBeGreaterThan(10);
    for (const name of colors) {
      expect(dark.has(name), `dark theme missing ${name}`).toBe(true);
    }
    expect(source).toContain('color-scheme: light');
    expect(source).toContain('color-scheme: dark');
  });

  test('keyboard focus and reduced motion are honored in every mode', async () => {
    const source = await css();
    expect(source).toContain(':focus-visible');
    expect(source).toContain('--focus-ring');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
