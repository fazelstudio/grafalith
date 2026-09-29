import type { Bounds } from '../shapes/geometry';

/**
 * Grid-based spatial hash index for fast bounds queries.
 * Maps element IDs to grid cells based on their AABB overlap.
 */
export class SpatialGrid {
  private cellSize: number;
  private cells: Map<string, Set<string>> = new Map();
  private elementCells: Map<string, string[]> = new Map();

  /**
   * Create a new SpatialGrid.
   * @param cellSize - Size of each grid cell in scene units (default 200)
   */
  constructor(cellSize: number = 200) {
    this.cellSize = cellSize;
  }

  /** Get cell key from cell coordinates. */
  private cellKey(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /** Get the range of cell coordinates that overlap with bounds. */
  private getCellRange(bounds: Bounds): { minCX: number; maxCX: number; minCY: number; maxCY: number } {
    const minCX = Math.floor(bounds.minX / this.cellSize);
    const maxCX = Math.floor(bounds.maxX / this.cellSize);
    const minCY = Math.floor(bounds.minY / this.cellSize);
    const maxCY = Math.floor(bounds.maxY / this.cellSize);
    return { minCX, maxCX, minCY, maxCY };
  }

  /** Get or create a cell set. */
  private getCell(key: string): Set<string> {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set();
      this.cells.set(key, cell);
    }
    return cell;
  }

  /**
   * Insert an element's bounds into the spatial grid.
   * @param elementId - The element's unique ID
   * @param bounds - The element's axis-aligned bounding box
   */
  insert(elementId: string, bounds: Bounds): void {
    const { minCX, maxCX, minCY, maxCY } = this.getCellRange(bounds);
    const cellKeys: string[] = [];

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = this.cellKey(cx, cy);
        this.getCell(key).add(elementId);
        cellKeys.push(key);
      }
    }

    this.elementCells.set(elementId, cellKeys);
  }

  /**
   * Remove an element from all cells it occupies.
   * @param elementId - The element's unique ID
   */
  remove(elementId: string): void {
    const cellKeys = this.elementCells.get(elementId);
    if (!cellKeys) return;

    for (const key of cellKeys) {
      const cell = this.cells.get(key);
      if (cell) {
        cell.delete(elementId);
        if (cell.size === 0) {
          this.cells.delete(key);
        }
      }
    }

    this.elementCells.delete(elementId);
  }

  /**
   * Update an element's position in the grid (remove + insert).
   * @param elementId - The element's unique ID
   * @param bounds - The new axis-aligned bounding box
   */
  update(elementId: string, bounds: Bounds): void {
    this.remove(elementId);
    this.insert(elementId, bounds);
  }

  /**
   * Query all element IDs whose bounds overlap with the given query bounds.
   * Returns deduplicated results (element spanning multiple cells appears once).
   * @param bounds - Query bounds
   * @returns Set of element IDs that may overlap (false positives possible, no false negatives)
   */
  queryBounds(bounds: Bounds): Set<string> {
    const { minCX, maxCX, minCY, maxCY } = this.getCellRange(bounds);
    const result = new Set<string>();

    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = this.cellKey(cx, cy);
        const cell = this.cells.get(key);
        if (cell) {
          for (const id of cell) {
            result.add(id);
          }
        }
      }
    }

    return result;
  }

  /**
   * Query all element IDs whose bounds overlap with the given query bounds.
   * Returns an array (for direct use where Array is needed).
   * @param bounds - Query bounds
   * @returns Array of element IDs that may overlap
   */
  queryBoundsArray(bounds: Bounds): string[] {
    return Array.from(this.queryBounds(bounds));
  }

  /** Clear all cells and element mappings. */
  clear(): void {
    this.cells.clear();
    this.elementCells.clear();
  }

  /** Get the number of elements in the index. */
  getSize(): number {
    return this.elementCells.size;
  }
}
