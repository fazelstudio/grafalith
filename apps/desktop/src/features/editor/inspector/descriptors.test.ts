import { describe, expect, test } from 'bun:test';
import { allInspectorSections, groupFieldRows, roundToTenth } from './descriptors';

function field(id: string, row?: string) {
  return row === undefined ? { id } : { id, row };
}

function transformField(id: string) {
  const section = allInspectorSections().find((entry) => entry.id === 'transform');
  const found = section?.fields.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing transform field "${id}"`);
  return found;
}

function styleField(id: string) {
  const section = allInspectorSections().find((entry) => entry.id === 'style');
  const found = section?.fields.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing style field "${id}"`);
  return found;
}

describe('groupFieldRows', () => {
  test('groups consecutive fields sharing a row', () => {
    const groups = groupFieldRows([field('x', 'position'), field('y', 'position')]);
    expect(groups).toEqual([{ kind: 'row', key: 'position', fields: [field('x', 'position'), field('y', 'position')] }]);
  });

  test('leaves ungrouped fields as singles in order', () => {
    const groups = groupFieldRows([field('rotation'), field('x', 'position'), field('y', 'position'), field('opacity')]);
    expect(groups.map((group) => group.kind)).toEqual(['single', 'row', 'single']);
  });

  test('a lone grouped id renders full width', () => {
    const groups = groupFieldRows([field('x', 'position'), field('rotation')]);
    expect(groups).toEqual([
      { kind: 'single', field: field('x', 'position') },
      { kind: 'single', field: field('rotation') },
    ]);
  });

  test('non-consecutive repeats form separate groups', () => {
    const groups = groupFieldRows([field('x', 'position'), field('rotation'), field('y', 'position')]);
    expect(groups.map((group) => group.kind)).toEqual(['single', 'single', 'single']);
  });

  test('empty input yields no groups', () => {
    expect(groupFieldRows([])).toEqual([]);
  });
});

describe('roundToTenth', () => {
  test('keeps one decimal and normalizes negative zero', () => {
    expect(roundToTenth(619.2807238537029)).toBe(619.3);
    expect(roundToTenth(100.2)).toBe(100.2);
    expect(roundToTenth(100)).toBe(100);
    expect(roundToTenth(-0.04)).toBe(0);
  });
});

describe('transform precision and reset', () => {
  test('x, y, width, height, and rotation step by a tenth', () => {
    for (const id of ['x', 'y', 'width', 'height', 'rotation']) {
      expect(transformField(id).step).toBe(0.1);
    }
  });

  test('x, y, and rotation reset to zero', () => {
    for (const id of ['x', 'y', 'rotation']) {
      expect(transformField(id).resetValue).toBe(0);
    }
    expect(transformField('width').resetValue).toBeUndefined();
    expect(transformField('height').resetValue).toBeUndefined();
  });

  test('rotation stacks its label above a half-width input', () => {
    expect(transformField('rotation').stacked).toBe(true);
    for (const id of ['x', 'y', 'width', 'height']) {
      expect(transformField(id).stacked).toBeUndefined();
    }
  });

  test('rotation control is capped at half width like rowed inputs', () => {
    expect(transformField('rotation').halfWidth).toBe(true);
    for (const id of ['x', 'y', 'width', 'height']) {
      expect(transformField(id).halfWidth).toBeUndefined();
    }
  });

  test('width and height reserve reset space to match x/y input widths', () => {
    expect(transformField('width').reserveResetSpace).toBe(true);
    expect(transformField('height').reserveResetSpace).toBe(true);
    for (const id of ['x', 'y', 'rotation']) {
      expect(transformField(id).reserveResetSpace).toBeUndefined();
    }
  });

  test('opacity spans 0-100 as a button with quarter-step presets and no unit', () => {
    const opacity = styleField('opacity');
    expect(opacity.control).toBe('opacity');
    expect(opacity.min).toBe(0);
    expect(opacity.max).toBe(100);
    expect(opacity.unit).toBeUndefined();
    expect(opacity.presets).toEqual([0, 25, 50, 75, 100]);
  });
});
