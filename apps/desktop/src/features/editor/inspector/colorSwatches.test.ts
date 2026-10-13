import { describe, expect, test } from 'bun:test';
import {
  COLOR_TEMPLATES,
  clearColorRecents,
  copyColorRecents,
  emptyFillModeMemory,
  fillEquals,
  fillToCss,
  fillToPatch,
  gradientOfFill,
  hexToHsv,
  hsvToHex,
  isGradientFill,
  loadColorRecents,
  normalizeHexColor,
  paintToFill,
  pruneColorRecents,
  recordColorRecent,
  solidOfFill,
  stopOffsetAt,
  switchFillMode,
  visibleSwatches,
  type FillValue,
} from './colorSwatches';

/** Temporary in-memory `window.localStorage` restored after each test. */
function installMemoryWindow(): () => void {
  const data = new Map<string, string>();
  const keys: string[] = [];
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (!data.has(key)) keys.push(key);
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
      const index = keys.indexOf(key);
      if (index >= 0) keys.splice(index, 1);
    },
    key: (index: number) => keys[index] ?? null,
    get length() {
      return keys.length;
    },
  };
  const globals = globalThis as Record<string, unknown>;
  const previous = globals['window'];
  globals['window'] = { localStorage: storage };
  return () => {
    if (previous === undefined) delete globals['window'];
    else globals['window'] = previous;
  };
}

describe('color swatches', () => {
  test('templates seed the swatch row', () => {
    const restore = installMemoryWindow();
    try {
      expect(COLOR_TEMPLATES.length).toBeGreaterThan(0);
      expect(visibleSwatches('project-a')).toEqual([...COLOR_TEMPLATES]);
    } finally {
      restore();
    }
  });

  test('recents replace template slots newest-first with a FIFO cap', () => {
    const restore = installMemoryWindow();
    try {
      for (let index = 0; index < COLOR_TEMPLATES.length + 3; index++) {
        const hex = `#${index.toString(16).padStart(6, '0')}`;
        recordColorRecent('project-a', hex);
      }
      const recents = loadColorRecents('project-a');
      expect(recents).toHaveLength(COLOR_TEMPLATES.length);
      expect(recents[0]).toBe('#00000a');
      expect(recents).not.toContain('#000000');
      expect(recents).not.toContain('#000001');
      expect(recents).not.toContain('#000002');
      const shown = visibleSwatches('project-a');
      expect(shown).toHaveLength(COLOR_TEMPLATES.length);
      expect(shown[0]).toBe('#00000a');
    } finally {
      restore();
    }
  });

  test('re-recording moves the fill to the front without duplicating it', () => {
    const restore = installMemoryWindow();
    try {
      recordColorRecent('project-a', '#ff0000');
      recordColorRecent('project-a', '#00ff00');
      recordColorRecent('project-a', '#ff0000');
      expect(loadColorRecents('project-a')).toEqual(['#ff0000', '#00ff00']);
      expect(visibleSwatches('project-a')[0]).toBe('#ff0000');
    } finally {
      restore();
    }
  });

  test('recents stay per project and survive invalid stored payloads', () => {
    const restore = installMemoryWindow();
    try {
      recordColorRecent('project-a', '#ff0000');
      expect(loadColorRecents('project-b')).toEqual([]);
      expect(visibleSwatches('project-b')).toEqual([...COLOR_TEMPLATES]);
      window.localStorage.setItem('grafalith:color-recents:project-c', 'not-json');
      expect(loadColorRecents('project-c')).toEqual([]);
      window.localStorage.setItem(
        'grafalith:color-recents:project-d',
        JSON.stringify(['#ff0000', 42, null, { type: 'gradient' }]),
      );
      expect(loadColorRecents('project-d')).toEqual(['#ff0000']);
    } finally {
      restore();
    }
  });

  test('gradients round-trip through recents with structural equality', () => {
    const restore = installMemoryWindow();
    try {
      const gradient: FillValue = {
        type: 'gradient',
        gradientType: 'linear',
        angle: 90,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      };
      recordColorRecent('project-a', gradient);
      recordColorRecent('project-a', '#00ff00');
      recordColorRecent('project-a', {
        type: 'gradient',
        gradientType: 'linear',
        angle: 90,
        stops: [
          { offset: 0, color: '#FF0000' },
          { offset: 1, color: '#0000ff' },
        ],
      });
      const recents = loadColorRecents('project-a');
      expect(recents).toHaveLength(2);
      expect(isGradientFill(recents[0])).toBe(true);
    } finally {
      restore();
    }
  });

  test('duplicate copies recents, permanent delete clears them, prune drops orphans', () => {
    const restore = installMemoryWindow();
    try {
      recordColorRecent('project-a', '#ff0000');
      copyColorRecents('project-a', 'project-b');
      expect(loadColorRecents('project-b')).toEqual(['#ff0000']);
      clearColorRecents('project-a');
      expect(loadColorRecents('project-a')).toEqual([]);
      recordColorRecent('ghost', '#00ff00');
      pruneColorRecents(['project-b']);
      expect(loadColorRecents('ghost')).toEqual([]);
      expect(loadColorRecents('project-b')).toEqual(['#ff0000']);
    } finally {
      restore();
    }
  });
});

describe('fill values', () => {
  test('paints map to editable fills', () => {
    expect(paintToFill({ type: 'solid', color: '#ff0000' })).toBe('#ff0000');
    expect(
      paintToFill({
        type: 'linear',
        angle: 45,
        stops: [
          { offset: 1, color: '#0000ff' },
          { offset: 0, color: '#ff0000' },
        ],
      }),
    ).toEqual({
      type: 'gradient',
      gradientType: 'linear',
      angle: 45,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    });
    expect(paintToFill({ type: 'radial', stops: [] })).toBe('#000000');
  });

  test('patches match the engine wire shape', () => {
    expect(fillToPatch('#ff0000')).toBe('#ff0000');
    expect(
      fillToPatch({
        type: 'gradient',
        gradientType: 'linear',
        angle: 90,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      }),
    ).toEqual({
      type: 'gradient',
      gradientType: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    });
  });

  test('css previews cover solid, transparent, and gradients', () => {
    expect(fillToCss('#ff0000')).toBe('#ff0000');
    expect(fillToCss('transparent')).toBe('transparent');
    expect(
      fillToCss({
        type: 'gradient',
        gradientType: 'linear',
        angle: 0,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      }),
    ).toContain('linear-gradient');
    expect(
      fillToCss({
        type: 'gradient',
        gradientType: 'radial',
        angle: 0,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      }),
    ).toContain('radial-gradient');
  });

  test('hex normalization accepts shorthand and rejects the rest', () => {
    expect(normalizeHexColor('#ff0000')).toBe('#ff0000');
    expect(normalizeHexColor('#FF0000')).toBe('#ff0000');
    expect(normalizeHexColor('#f00')).toBe('#ff0000');
    expect(normalizeHexColor('transparent')).toBeNull();
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor(42)).toBeNull();
    expect(fillEquals('#FF0000', '#ff0000')).toBe(true);
    expect(fillEquals('#ff0000', '#00ff00')).toBe(false);
  });

  test('bar double-click maps pointer to a clamped two-decimal offset', () => {
    expect(stopOffsetAt(50, 0, 200)).toBe(0.25);
    expect(stopOffsetAt(0, 0, 200)).toBe(0);
    expect(stopOffsetAt(200, 0, 200)).toBe(1);
    expect(stopOffsetAt(-10, 0, 200)).toBe(0);
    expect(stopOffsetAt(250, 0, 200)).toBe(1);
    expect(stopOffsetAt(50, 0, 0)).toBe(0);
    expect(stopOffsetAt(Number.NaN, 0, 200)).toBe(0);
  });

  test('hex/hsv round-trips through primaries and achromatics', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 100, v: 100 });
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 100, v: 100 });
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 100, v: 100 });
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 100 });
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('bogus')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToHex(0, 100, 100)).toBe('#ff0000');
    expect(hsvToHex(120, 100, 100)).toBe('#00ff00');
    expect(hsvToHex(240, 100, 100)).toBe('#0000ff');
    expect(hsvToHex(360, 100, 100)).toBe('#ff0000');
    expect(hsvToHex(-120, 100, 100)).toBe('#0000ff');
    expect(hsvToHex(0, 0, 100)).toBe('#ffffff');
  });

  test('mode toggle restores each side instead of rebuilding', () => {
    const gradient: FillValue = {
      type: 'gradient',
      gradientType: 'linear',
      angle: 45,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    // Leaving gradient remembers it; solid falls back to the first stop.
    const toSolid = switchFillMode(emptyFillModeMemory(), gradient, 'solid');
    expect(toSolid.next).toBe('#ff0000');
    expect(toSolid.memory.gradient).toEqual(gradient);
    // Returning restores the remembered gradient verbatim.
    const backToGradient = switchFillMode(toSolid.memory, toSolid.next, 'gradient');
    expect(backToGradient.next).toEqual(gradient);
    expect(backToGradient.memory.solid).toBe('#ff0000');
    // Fresh solid with no memory derives a two-stop gradient instead.
    const fresh = switchFillMode(emptyFillModeMemory(), '#00ff00', 'gradient');
    expect(fresh.next).toEqual(gradientOfFill('#00ff00'));
    expect(solidOfFill(gradient)).toBe('#ff0000');
    expect(solidOfFill('#FF0000')).toBe('#ff0000');
    // Toggling into the current mode keeps the draft untouched.
    expect(switchFillMode(toSolid.memory, toSolid.next, 'solid').next).toBe('#ff0000');
  });
});
