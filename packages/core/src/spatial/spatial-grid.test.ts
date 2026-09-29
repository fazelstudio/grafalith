import { describe, test, expect } from 'bun:test';
import { SpatialGrid } from './spatial-grid';

describe('SpatialGrid', () => {
  test('insert and query single element in one cell', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });

    const result = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result.has('a')).toBe(true);
    expect(grid.getSize()).toBe(1);
  });

  test('element spanning multiple cells is found in query covering any of those cells', () => {
    const grid = new SpatialGrid(100);
    // Element spans cells (0,0), (1,0), (0,1), (1,1) when cellSize=100
    grid.insert('big', { minX: 10, minY: 10, maxX: 210, maxY: 210 });

    // Query only cell (0,0) area
    const result1 = grid.queryBounds({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
    expect(result1.has('big')).toBe(true);

    // Query only cell (1,1) area
    const result2 = grid.queryBounds({ minX: 150, minY: 150, maxX: 250, maxY: 250 });
    expect(result2.has('big')).toBe(true);
  });

  test('query empty area returns no results', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });

    const result = grid.queryBounds({ minX: 500, minY: 500, maxX: 600, maxY: 600 });
    expect(result.size).toBe(0);
  });

  test('query with no elements returns empty set', () => {
    const grid = new SpatialGrid(200);
    const result = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result.size).toBe(0);
  });

  test('remove element removes it from query results', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });
    grid.insert('b', { minX: 60, minY: 60, maxX: 90, maxY: 90 });

    grid.remove('a');

    const result = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result.has('a')).toBe(false);
    expect(result.has('b')).toBe(true);
    expect(grid.getSize()).toBe(1);
  });

  test('update moves element to new cells', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });

    // Verify in original position
    const result1 = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result1.has('a')).toBe(true);

    // Move to new position
    grid.update('a', { minX: 300, minY: 300, maxX: 350, maxY: 350 });

    // Should NOT be in old area
    const result2 = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result2.has('a')).toBe(false);

    // Should be in new area
    const result3 = grid.queryBounds({ minX: 250, minY: 250, maxX: 400, maxY: 400 });
    expect(result3.has('a')).toBe(true);
  });

  test('multiple elements in same cell are all returned', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });
    grid.insert('b', { minX: 20, minY: 20, maxX: 60, maxY: 60 });
    grid.insert('c', { minX: 30, minY: 30, maxX: 70, maxY: 70 });

    const result = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result.size).toBe(3);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(true);
    expect(result.has('c')).toBe(true);
  });

  test('negative coordinates work correctly', () => {
    const grid = new SpatialGrid(200);
    grid.insert('neg', { minX: -100, minY: -100, maxX: -10, maxY: -10 });

    const result = grid.queryBounds({ minX: -150, minY: -150, maxX: 0, maxY: 0 });
    expect(result.has('neg')).toBe(true);
  });

  test('query bounds overlap (not containment) is detected', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 100, minY: 100, maxX: 300, maxY: 300 });

    // Query overlaps partially
    const result = grid.queryBounds({ minX: 0, minY: 0, maxX: 150, maxY: 150 });
    expect(result.has('a')).toBe(true);
  });

  test('clear removes all elements', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });
    grid.insert('b', { minX: 60, minY: 60, maxX: 90, maxY: 90 });

    grid.clear();

    expect(grid.getSize()).toBe(0);
    const result = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result.size).toBe(0);
  });

  test('queryBoundsArray returns array instead of set', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });
    grid.insert('b', { minX: 60, minY: 60, maxX: 90, maxY: 90 });

    const result = grid.queryBoundsArray({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result).toContain('a');
    expect(result).toContain('b');
  });

  test('removing non-existent element does not throw', () => {
    const grid = new SpatialGrid(200);
    expect(() => grid.remove('nonexistent')).not.toThrow();
  });

  test('inserting same element id twice does not duplicate in results', () => {
    const grid = new SpatialGrid(200);
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });
    grid.insert('a', { minX: 10, minY: 10, maxX: 50, maxY: 50 });

    const result = grid.queryBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
    expect(result.size).toBe(1);
    expect(result.has('a')).toBe(true);
  });
});
