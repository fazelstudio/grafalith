//! Grid spatial hash for culling and hit-testing.
//!
//! TS source: `packages/core/src/spatial/spatial-grid.ts`
//! (`cellSize = 200` scene units; owned by the `Scene` instance, not global).
//!
//! Instance-scoped index with explicit owner and invalidation rules:
//! the document (or a render pass) owns the grid and calls
//! [`SpatialGrid::update`] on every move and [`SpatialGrid::remove`] on
//! every delete. Queries return *candidates* — cell overlap may report
//! false positives (same-cell neighbors) but never false negatives, so
//! callers always follow with an exact bounds/hit check.

use crate::rect::Bounds;
use std::collections::{HashMap, HashSet};

/// Default cell size in scene units (TS constructor default `200`).
pub const DEFAULT_CELL_SIZE: f64 = 200.0;

/// Cell-hash index from element ids to the cells their bounds overlap.
#[derive(Debug, Clone, Default)]
pub struct SpatialGrid {
    /// Cell edge length in scene units.
    cell_size: f64,
    /// Cell key → member ids.
    cells: HashMap<(i64, i64), HashSet<String>>,
    /// Element id → occupied cell keys (for targeted removal).
    element_cells: HashMap<String, Vec<(i64, i64)>>,
}

impl SpatialGrid {
    /// Creates an empty index with the given cell size.
    pub fn new(cell_size: f64) -> Self {
        Self {
            cell_size,
            cells: HashMap::new(),
            element_cells: HashMap::new(),
        }
    }

    /// Creates an empty index with [`DEFAULT_CELL_SIZE`].
    pub fn with_default_cell_size() -> Self {
        Self::new(DEFAULT_CELL_SIZE)
    }

    /// Cell size in scene units.
    pub fn cell_size(&self) -> f64 {
        self.cell_size
    }

    /// Cell-coordinate range overlapped by `bounds` (TS `getCellRange`).
    fn cell_range(&self, bounds: &Bounds) -> (i64, i64, i64, i64) {
        (
            (bounds.min_x / self.cell_size).floor() as i64,
            (bounds.max_x / self.cell_size).floor() as i64,
            (bounds.min_y / self.cell_size).floor() as i64,
            (bounds.max_y / self.cell_size).floor() as i64,
        )
    }

    /// Inserts an element's bounds into the grid (TS `insert`).
    ///
    /// Self-healing: previous cells for `element_id` are cleared first, so
    /// re-inserting a moved element without an explicit
    /// [`SpatialGrid::remove`] cannot leave stale cells behind. (TS keeps
    /// the stale cells on a bare `insert` and requires callers to use
    /// `update` for moves; the Rust port removes that footgun while
    /// [`SpatialGrid::update`] keeps the TS `remove + insert` shape for
    /// parity.)
    pub fn insert(&mut self, element_id: &str, bounds: &Bounds) {
        // Clear first: without this, a re-insert at new bounds overwrites
        // the id→cells map while the old cells keep the id (stale hits).
        self.remove(element_id);
        let (min_cx, max_cx, min_cy, max_cy) = self.cell_range(bounds);
        let mut keys = Vec::new();
        for cx in min_cx..=max_cx {
            for cy in min_cy..=max_cy {
                self.cells
                    .entry((cx, cy))
                    .or_default()
                    .insert(element_id.to_string());
                keys.push((cx, cy));
            }
        }
        self.element_cells.insert(element_id.to_string(), keys);
    }

    /// Removes an element from every cell it occupies (TS `remove`).
    ///
    /// Unknown ids are silent no-ops; emptied cells are dropped.
    pub fn remove(&mut self, element_id: &str) {
        let Some(keys) = self.element_cells.remove(element_id) else {
            return;
        };
        for key in keys {
            if let Some(cell) = self.cells.get_mut(&key) {
                cell.remove(element_id);
                if cell.is_empty() {
                    self.cells.remove(&key);
                }
            }
        }
    }

    /// Moves an element to new bounds (TS `update` = remove + insert).
    pub fn update(&mut self, element_id: &str, bounds: &Bounds) {
        self.remove(element_id);
        self.insert(element_id, bounds);
    }

    /// Ids whose cells overlap `bounds` (TS `queryBounds`).
    ///
    /// Deduplicated: a multi-cell element appears once. May contain false
    /// positives (cell neighbors whose exact bounds miss); never misses a
    /// true overlap.
    pub fn query_bounds(&self, bounds: &Bounds) -> HashSet<String> {
        let (min_cx, max_cx, min_cy, max_cy) = self.cell_range(bounds);
        let mut result = HashSet::new();
        for cx in min_cx..=max_cx {
            for cy in min_cy..=max_cy {
                if let Some(cell) = self.cells.get(&(cx, cy)) {
                    result.extend(cell.iter().cloned());
                }
            }
        }
        result
    }

    /// Same as [`SpatialGrid::query_bounds`] as a vector (TS
    /// `queryBoundsArray`, for callers needing an array).
    pub fn query_bounds_vec(&self, bounds: &Bounds) -> Vec<String> {
        self.query_bounds(bounds).into_iter().collect()
    }

    /// Short alias of [`SpatialGrid::query_bounds_vec`]: ids whose cells
    /// overlap `bounds`, as a vector.
    ///
    /// Both names share the same candidate contract (deduplicated, false
    /// positives possible, never false negatives); `query_ids` exists so
    /// document-layer call sites read naturally.
    pub fn query_ids(&self, bounds: &Bounds) -> Vec<String> {
        self.query_bounds_vec(bounds)
    }

    /// Drops every cell and mapping (TS `clear`).
    pub fn clear(&mut self) {
        self.cells.clear();
        self.element_cells.clear();
    }

    /// Number of indexed elements (TS `getSize`).
    pub fn len(&self) -> usize {
        self.element_cells.len()
    }

    /// Returns `true` when no element is indexed.
    pub fn is_empty(&self) -> bool {
        self.element_cells.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Bounds {
        Bounds::new(min_x, min_y, max_x, max_y)
    }

    #[test]
    fn insert_and_query_single_element() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        assert!(grid
            .query_bounds(&bounds(0.0, 0.0, 100.0, 100.0))
            .contains("a"));
        assert_eq!(grid.len(), 1);
    }

    #[test]
    fn multi_cell_element_found_from_any_covered_cell() {
        let mut grid = SpatialGrid::new(100.0);
        grid.insert("big", &bounds(10.0, 10.0, 210.0, 210.0));
        assert!(grid
            .query_bounds(&bounds(0.0, 0.0, 50.0, 50.0))
            .contains("big"));
        assert!(grid
            .query_bounds(&bounds(150.0, 150.0, 250.0, 250.0))
            .contains("big"));
    }

    #[test]
    fn empty_area_and_empty_grid_return_nothing() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        assert!(grid
            .query_bounds(&bounds(500.0, 500.0, 600.0, 600.0))
            .is_empty());
        let blank = SpatialGrid::new(200.0);
        assert!(blank
            .query_bounds(&bounds(0.0, 0.0, 100.0, 100.0))
            .is_empty());
    }

    #[test]
    fn remove_updates_results_and_size() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        grid.insert("b", &bounds(60.0, 60.0, 90.0, 90.0));
        grid.remove("a");
        let result = grid.query_bounds(&bounds(0.0, 0.0, 100.0, 100.0));
        assert!(!result.contains("a") && result.contains("b"));
        assert_eq!(grid.len(), 1);
    }

    #[test]
    fn update_moves_between_cells() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        grid.update("a", &bounds(300.0, 300.0, 350.0, 350.0));
        assert!(!grid
            .query_bounds(&bounds(0.0, 0.0, 100.0, 100.0))
            .contains("a"));
        assert!(grid
            .query_bounds(&bounds(250.0, 250.0, 400.0, 400.0))
            .contains("a"));
    }

    #[test]
    fn same_cell_members_all_returned() {
        let mut grid = SpatialGrid::new(200.0);
        for id in ["a", "b", "c"] {
            grid.insert(id, &bounds(10.0, 10.0, 70.0, 70.0));
        }
        assert_eq!(grid.query_bounds(&bounds(0.0, 0.0, 100.0, 100.0)).len(), 3);
    }

    #[test]
    fn negative_coordinates_hash_correctly() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("neg", &bounds(-100.0, -100.0, -10.0, -10.0));
        assert!(grid
            .query_bounds(&bounds(-150.0, -150.0, 0.0, 0.0))
            .contains("neg"));
    }

    #[test]
    fn partial_overlap_is_reported() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(100.0, 100.0, 300.0, 300.0));
        assert!(grid
            .query_bounds(&bounds(0.0, 0.0, 150.0, 150.0))
            .contains("a"));
    }

    #[test]
    fn clear_empties_the_index() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        grid.clear();
        assert!(grid.is_empty());
        assert!(grid
            .query_bounds(&bounds(0.0, 0.0, 100.0, 100.0))
            .is_empty());
    }

    #[test]
    fn vec_query_and_ghost_remove_and_double_insert() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        grid.insert("b", &bounds(60.0, 60.0, 90.0, 90.0));
        let mut vec = grid.query_bounds_vec(&bounds(0.0, 0.0, 100.0, 100.0));
        vec.sort();
        assert_eq!(vec, vec!["a".to_string(), "b".to_string()]);
        // Ghost remove is a no-op (TS `not.toThrow` parity).
        grid.remove("nonexistent");
        // Double insert collapses in results (cells are sets).
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        assert_eq!(grid.query_bounds(&bounds(0.0, 0.0, 100.0, 100.0)).len(), 2);
    }

    #[test]
    fn reinsert_without_remove_leaves_no_stale_cells() {
        // Unlike TS `insert` (which orphans the old cells on a bare
        // re-insert), the Rust port clears first: the old area must stop
        // reporting the id and the size must not grow.
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        grid.insert("a", &bounds(500.0, 500.0, 550.0, 550.0));
        assert!(grid
            .query_bounds(&bounds(0.0, 0.0, 100.0, 100.0))
            .is_empty());
        assert!(grid
            .query_bounds(&bounds(400.0, 400.0, 600.0, 600.0))
            .contains("a"));
        assert_eq!(grid.len(), 1);
    }

    #[test]
    fn query_ids_matches_vec_query() {
        let mut grid = SpatialGrid::new(200.0);
        grid.insert("a", &bounds(10.0, 10.0, 50.0, 50.0));
        grid.insert("b", &bounds(60.0, 60.0, 90.0, 90.0));
        let mut ids = grid.query_ids(&bounds(0.0, 0.0, 100.0, 100.0));
        ids.sort();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn scale_smoke_five_thousand_elements_query_exactly() {
        // Correctness at 5k with timing printed for manual inspection
        // (`-- --nocapture`). No timing assertion — wall-clock timing is
        // too noisy for automated gates.
        use std::time::Instant;
        let mut grid = SpatialGrid::new(200.0);
        let start = Instant::now();
        for i in 0..5_000 {
            let x = f64::from(i % 100) * 50.0;
            let y = f64::from(i / 100) * 50.0;
            grid.insert(&format!("el-{i}"), &bounds(x, y, x + 40.0, y + 40.0));
        }
        let build = start.elapsed();
        let start = Instant::now();
        let found = grid.query_bounds(&bounds(0.0, 0.0, 500.0, 500.0));
        let query = start.elapsed();
        eprintln!(
            "spatial 5k build: {build:?}, cull query: {query:?}, hits: {}",
            found.len()
        );
        // Cells (0..=2, 0..=2) cover scene [0,600)²; every 40×40 box with
        // origin in {0,50,…,550}² touches that region → 12 × 12 = 144
        // candidates. The exact-overlap subset against the (0,0,500,500)
        // window is 11 × 11 = 121 — all present (no false negatives).
        assert_eq!(found.len(), 144);
        assert_eq!(grid.len(), 5_000);
        for cx in 0..11 {
            for cy in 0..11 {
                assert!(found.contains(&format!("el-{}", cy * 100 + cx)));
            }
        }
    }
}
