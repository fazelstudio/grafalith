//! Grid + object snapping math.
//!
//! TS source: `packages/core/src/interaction/snap.ts`
//! (`defaultSnapConfig.snapThreshold = 5` screen px, zoom-normalized via
//! `/ zoom`; grid values and edge/center guides pinned by `snap.test.ts`).
//!
//! Pure functions over explicit candidate sets: the geometry layer takes
//! precomputed [`Bounds`] slices, never elements — the interaction layer
//! maps elements through their bounds first, which also keeps this crate
//! free of document types. The math itself stays host-independent.

use crate::rect::Bounds;
use crate::transform::screen_to_world_tolerance;
use std::collections::HashSet;

// Config and result types (TS `SnapConfig`, `SnapGuide`, `SnapResult`).

/// Default grid cell size in scene units (TS `gridSize: 20`).
pub const DEFAULT_GRID_SIZE: f64 = 20.0;

/// Default snap threshold in screen px (TS `snapThreshold: 5`).
pub const DEFAULT_SNAP_THRESHOLD_PX: f64 = 5.0;

/// Snapping configuration (TS `SnapConfig`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SnapConfig {
    /// Grid spacing in scene units.
    pub grid_size: f64,
    /// Whether snap-to-grid is enabled.
    pub snap_to_grid: bool,
    /// Whether to show the grid visual on canvas (host hint, no math).
    pub show_grid: bool,
    /// Whether snap-to-object is enabled.
    pub snap_to_objects: bool,
    /// Threshold in screen px; divided by zoom at call time so feel is
    /// zoom-independent.
    pub snap_threshold: f64,
}

impl SnapConfig {
    /// TS `defaultSnapConfig` (grid off, objects on, threshold 5px).
    pub fn defaults() -> Self {
        Self {
            grid_size: DEFAULT_GRID_SIZE,
            snap_to_grid: false,
            show_grid: false,
            snap_to_objects: true,
            snap_threshold: DEFAULT_SNAP_THRESHOLD_PX,
        }
    }
}

/// A snap guideline for the interaction overlay (TS `SnapGuide`).
///
/// Positions are scene coordinates: `position` is x for vertical guides
/// and y for horizontal ones; the segment runs
/// `(start_x, start_y)` → `(end_x, end_y)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SnapGuide {
    /// Guide orientation.
    pub vertical: bool,
    /// Guide line position (x when vertical, y when horizontal).
    pub position: f64,
    /// Segment start x.
    pub start_x: f64,
    /// Segment start y.
    pub start_y: f64,
    /// Segment end x.
    pub end_x: f64,
    /// Segment end y.
    pub end_y: f64,
}

impl SnapGuide {
    /// Returns `true` for vertical (x-alignment) guides.
    pub fn is_vertical(&self) -> bool {
        self.vertical
    }

    /// Returns `true` for horizontal (y-alignment) guides.
    pub fn is_horizontal(&self) -> bool {
        !self.vertical
    }
}

/// Snap outcome: the snapped *center* of the moving element plus the
/// active guides (TS `SnapResult`; `x`/`y` are center coordinates there —
/// callers convert back to top-left).
#[derive(Debug, Clone, PartialEq)]
pub struct SnapResult {
    /// Snapped center x (scene units).
    pub x: f64,
    /// Snapped center y (scene units).
    pub y: f64,
    /// Active guides for the interaction overlay.
    pub guides: Vec<SnapGuide>,
}

// Pure snap functions.

/// Snaps a value to the nearest grid multiple (TS `snapToGridValue`).
pub fn snap_to_grid_value(value: f64, grid_size: f64) -> f64 {
    (value / grid_size).round() * grid_size
}

/// Snaps a position to the grid when enabled (TS `snapPositionToGrid`).
///
/// Returns the input unchanged when `snap_to_grid` is off or the grid
/// size is not positive.
pub fn snap_position_to_grid(x: f64, y: f64, config: &SnapConfig) -> (f64, f64) {
    if !config.snap_to_grid || config.grid_size <= 0.0 {
        return (x, y);
    }
    (
        snap_to_grid_value(x, config.grid_size),
        snap_to_grid_value(y, config.grid_size),
    )
}

/// Left/center/right (x) and top/center/bottom (y) alignment edges.
fn edge_positions(bounds: &Bounds) -> ([f64; 3], [f64; 3]) {
    let cx = (bounds.min_x + bounds.max_x) / 2.0;
    let cy = (bounds.min_y + bounds.max_y) / 2.0;
    (
        [bounds.min_x, cx, bounds.max_x],
        [bounds.min_y, cy, bounds.max_y],
    )
}

/// Finds edge/center alignment of `moving_bounds` against candidates.
///
/// Exact port of TS `findSnapToObject` over precomputed bounds: for each
/// axis the closest moving-edge → candidate-edge pair within
/// `threshold / zoom` wins; the moving element offsets so the edges align
/// exactly, and a guide spans both boxes ± 20 scene units. `exclude`
/// holds candidate indices to skip (the moving element itself — the
/// caller maps ids to indices). With no snap the moving *center* returns
/// unchanged and `guides` is empty (TS quirk preserved).
pub fn find_snap_to_object(
    moving_bounds: &Bounds,
    candidates: &[Bounds],
    threshold: f64,
    exclude: &HashSet<usize>,
    zoom: f64,
) -> SnapResult {
    let effective = screen_to_world_tolerance(threshold, zoom);
    let moving_cx = (moving_bounds.min_x + moving_bounds.max_x) / 2.0;
    let moving_cy = (moving_bounds.min_y + moving_bounds.max_y) / 2.0;
    let (mxs, mys) = edge_positions(moving_bounds);

    let mut best_dx = f64::INFINITY;
    let mut best_dy = f64::INFINITY;
    let mut snap_offset_x = 0.0;
    let mut snap_offset_y = 0.0;
    let mut guide_x: Option<SnapGuide> = None;
    let mut guide_y: Option<SnapGuide> = None;

    for (index, candidate) in candidates.iter().enumerate() {
        if exclude.contains(&index) {
            continue;
        }
        let (cxs, cys) = edge_positions(candidate);
        for mx in mxs {
            for cx in cxs {
                let dist = (mx - cx).abs();
                if dist < effective && dist < best_dx {
                    best_dx = dist;
                    snap_offset_x = cx - mx;
                    guide_x = Some(SnapGuide {
                        vertical: true,
                        position: cx,
                        start_x: cx,
                        start_y: moving_bounds.min_y.min(candidate.min_y) - 20.0,
                        end_x: cx,
                        end_y: moving_bounds.max_y.max(candidate.max_y) + 20.0,
                    });
                }
            }
        }
        for my in mys {
            for cy in cys {
                let dist = (my - cy).abs();
                if dist < effective && dist < best_dy {
                    best_dy = dist;
                    snap_offset_y = cy - my;
                    guide_y = Some(SnapGuide {
                        vertical: false,
                        position: cy,
                        start_x: moving_bounds.min_x.min(candidate.min_x) - 20.0,
                        start_y: cy,
                        end_x: moving_bounds.max_x.max(candidate.max_x) + 20.0,
                        end_y: cy,
                    });
                }
            }
        }
    }

    let mut guides = Vec::new();
    let mut result_x = moving_cx;
    let mut result_y = moving_cy;
    if let Some(guide) = guide_x {
        if best_dx < effective {
            result_x = moving_cx + snap_offset_x;
            guides.push(guide);
        }
    }
    if let Some(guide) = guide_y {
        if best_dy < effective {
            result_y = moving_cy + snap_offset_y;
            guides.push(guide);
        }
    }
    SnapResult {
        x: result_x,
        y: result_y,
        guides,
    }
}

/// Applies combined grid + object snap (TS `applySnap`).
///
/// Object snapping takes priority: when it produces guides, the object
/// result wins outright; otherwise the (possibly grid-snapped) position
/// stands. `x`/`y` are the moving element's center.
pub fn apply_snap(
    x: f64,
    y: f64,
    moving_bounds: &Bounds,
    config: &SnapConfig,
    candidates: &[Bounds],
    exclude: &HashSet<usize>,
    zoom: f64,
) -> SnapResult {
    let mut result_x = x;
    let mut result_y = y;
    let mut guides = Vec::new();

    if config.snap_to_grid && config.grid_size > 0.0 {
        let (gx, gy) = snap_position_to_grid(x, y, config);
        result_x = gx;
        result_y = gy;
    }

    if config.snap_to_objects && !candidates.is_empty() {
        let object = find_snap_to_object(
            moving_bounds,
            candidates,
            config.snap_threshold,
            exclude,
            zoom,
        );
        if !object.guides.is_empty() {
            result_x = object.x;
            result_y = object.y;
            guides = object.guides;
        }
    }

    SnapResult {
        x: result_x,
        y: result_y,
        guides,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_values_match_ts_table() {
        // snap.test.ts table @ grid 20.
        assert_eq!(snap_to_grid_value(0.0, 20.0), 0.0);
        assert_eq!(snap_to_grid_value(9.0, 20.0), 0.0);
        assert_eq!(snap_to_grid_value(11.0, 20.0), 20.0);
        assert_eq!(snap_to_grid_value(30.0, 20.0), 40.0);
        assert_eq!(snap_to_grid_value(-5.0, 20.0), -0.0);
        assert_eq!(snap_to_grid_value(-15.0, 20.0), -20.0);
    }

    #[test]
    fn grid_position_respects_the_toggle() {
        let on = SnapConfig {
            snap_to_grid: true,
            ..SnapConfig::defaults()
        };
        assert_eq!(snap_position_to_grid(13.0, 37.0, &on), (20.0, 40.0));
        let off = SnapConfig::defaults();
        assert_eq!(snap_position_to_grid(13.0, 37.0, &off), (13.0, 37.0));
    }

    #[test]
    fn vertical_edge_snap_aligns_and_guides() {
        // snap.test.ts: moving left edge 155 vs target right edge 150,
        // threshold 10 → center 180 − 5 = 175 + vertical guide.
        let target = Bounds::new(100.0, 0.0, 150.0, 50.0);
        let moving = Bounds::new(155.0, 0.0, 205.0, 50.0);
        let result = find_snap_to_object(&moving, &[target], 10.0, &HashSet::new(), 1.0);
        assert_eq!(result.x, 175.0);
        assert!(result.guides.iter().any(|g| g.is_vertical()));
    }

    #[test]
    fn horizontal_edge_snap_aligns_and_guides() {
        let target = Bounds::new(0.0, 100.0, 50.0, 150.0);
        let moving = Bounds::new(0.0, 155.0, 50.0, 205.0);
        let result = find_snap_to_object(&moving, &[target], 10.0, &HashSet::new(), 1.0);
        assert_eq!(result.y, 175.0);
        assert!(result.guides.iter().any(|g| g.is_horizontal()));
    }

    #[test]
    fn far_candidates_and_excluded_ids_yield_no_guides() {
        let far = Bounds::new(500.0, 500.0, 550.0, 550.0);
        let moving = Bounds::new(0.0, 0.0, 50.0, 50.0);
        let empty = find_snap_to_object(&moving, &[far], 5.0, &HashSet::new(), 1.0);
        assert!(empty.guides.is_empty());
        // Excluded self never snaps even when coincident.
        let here = Bounds::new(100.0, 0.0, 150.0, 50.0);
        let excluded: HashSet<usize> = HashSet::from([0]);
        let skipped = find_snap_to_object(&moving, &[here], 10.0, &excluded, 1.0);
        assert!(skipped.guides.is_empty());
    }

    #[test]
    fn apply_snap_prefers_object_over_grid() {
        // Grid-only when objects are disabled.
        let grid_only = SnapConfig {
            snap_to_grid: true,
            snap_to_objects: false,
            ..SnapConfig::defaults()
        };
        let moving = Bounds::new(13.0, 37.0, 63.0, 87.0);
        let result = apply_snap(13.0, 37.0, &moving, &grid_only, &[], &HashSet::new(), 1.0);
        assert_eq!((result.x, result.y), (20.0, 40.0));
        assert!(result.guides.is_empty());
    }

    #[test]
    fn snap_threshold_is_zoom_independent() {
        // remediation.test.ts: 4 scene units snap at zoom 1 (4px < 5px)
        // but not at zoom 10 (40px > 5px). The y gap is far so only x
        // decides, isolating the zoom behavior.
        let other = Bounds::new(54.0, 200.0, 104.0, 250.0);
        let moving = Bounds::new(0.0, 0.0, 50.0, 50.0);
        let near = find_snap_to_object(
            &moving,
            &[other],
            DEFAULT_SNAP_THRESHOLD_PX,
            &HashSet::new(),
            1.0,
        );
        assert!(!near.guides.is_empty());
        let far = find_snap_to_object(
            &moving,
            &[other],
            DEFAULT_SNAP_THRESHOLD_PX,
            &HashSet::new(),
            10.0,
        );
        assert!(far.guides.is_empty());
    }
}
