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
use crate::transform::HandleType;
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
/// Exact port of TS `findSnapToObject` over precomputed bounds, extended to
/// Figma-style multi-edge guides: for each axis the snap offset still comes
/// from the single closest moving-edge → candidate-edge pair, but *every*
/// pair within `threshold / zoom` emits a guide (equal heights show both
/// the top and the bottom line). Guides at identical positions collapse to
/// one; the moving element offsets so the closest edges align exactly, and
/// each guide spans both boxes ± 20 scene units. `exclude` holds candidate
/// indices to skip (the moving element itself — the caller maps ids to
/// indices). With no snap the moving *center* returns unchanged and
/// `guides` is empty (TS quirk preserved).
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
    let mut guides_x: Vec<SnapGuide> = Vec::new();
    let mut guides_y: Vec<SnapGuide> = Vec::new();

    for (index, candidate) in candidates.iter().enumerate() {
        if exclude.contains(&index) {
            continue;
        }
        let (cxs, cys) = edge_positions(candidate);
        for mx in mxs {
            for cx in cxs {
                let dist = (mx - cx).abs();
                if dist < effective {
                    if dist < best_dx {
                        best_dx = dist;
                        snap_offset_x = cx - mx;
                    }
                    push_guide(
                        &mut guides_x,
                        SnapGuide {
                            vertical: true,
                            position: cx,
                            start_x: cx,
                            start_y: moving_bounds.min_y.min(candidate.min_y) - 20.0,
                            end_x: cx,
                            end_y: moving_bounds.max_y.max(candidate.max_y) + 20.0,
                        },
                    );
                }
            }
        }
        for my in mys {
            for cy in cys {
                let dist = (my - cy).abs();
                if dist < effective {
                    if dist < best_dy {
                        best_dy = dist;
                        snap_offset_y = cy - my;
                    }
                    push_guide(
                        &mut guides_y,
                        SnapGuide {
                            vertical: false,
                            position: cy,
                            start_x: moving_bounds.min_x.min(candidate.min_x) - 20.0,
                            start_y: cy,
                            end_x: moving_bounds.max_x.max(candidate.max_x) + 20.0,
                            end_y: cy,
                        },
                    );
                }
            }
        }
    }

    let mut guides = Vec::new();
    let mut result_x = moving_cx;
    let mut result_y = moving_cy;
    if best_dx < effective {
        result_x = moving_cx + snap_offset_x;
        guides.extend(guides_x);
    }
    if best_dy < effective {
        result_y = moving_cy + snap_offset_y;
        guides.extend(guides_y);
    }
    SnapResult {
        x: result_x,
        y: result_y,
        guides,
    }
}

/// Pushes a guide unless the same line is already present (shared edges
/// across candidates draw once, not once per pair).
fn push_guide(guides: &mut Vec<SnapGuide>, guide: SnapGuide) {
    let key = (guide.vertical, guide.position.to_bits());
    if !guides
        .iter()
        .any(|existing| (existing.vertical, existing.position.to_bits()) == key)
    {
        guides.push(guide);
    }
}

/// Snaps a resize preview box: dragged edges align to candidate edges.
///
/// Only the edges the handle moves participate — the anchored edges never
/// shift. Per free axis the snap offset comes from the closest moving-edge
/// → candidate-edge pair (candidate sides include centers, so sizing to a
/// midpoint works), while every in-threshold pair emits a guide, matching
/// move-drag behavior. The box keeps a minimum size of 1 scene unit per
/// axis. `exclude` holds candidate indices to skip.
pub fn snap_resize_box(
    preview: &Bounds,
    handle: HandleType,
    candidates: &[Bounds],
    threshold: f64,
    exclude: &HashSet<usize>,
    zoom: f64,
) -> (Bounds, Vec<SnapGuide>) {
    use HandleType::*;
    let west = matches!(handle, TopLeft | MiddleLeft | BottomLeft);
    let east = matches!(handle, TopRight | MiddleRight | BottomRight);
    let north = matches!(handle, TopLeft | TopCenter | TopRight);
    let south = matches!(handle, BottomLeft | BottomCenter | BottomRight);
    let effective = screen_to_world_tolerance(threshold, zoom);

    let mut best_dx = f64::INFINITY;
    let mut best_dy = f64::INFINITY;
    let mut snap_dx = 0.0;
    let mut snap_dy = 0.0;
    let mut guides: Vec<SnapGuide> = Vec::new();

    for (index, candidate) in candidates.iter().enumerate() {
        if exclude.contains(&index) {
            continue;
        }
        let (cxs, cys) = edge_positions(candidate);
        if west || east {
            let moving = if west { preview.min_x } else { preview.max_x };
            for edge in cxs {
                let dist = (moving - edge).abs();
                if dist < effective {
                    if dist < best_dx {
                        best_dx = dist;
                        snap_dx = edge - moving;
                    }
                    push_guide(
                        &mut guides,
                        SnapGuide {
                            vertical: true,
                            position: edge,
                            start_x: edge,
                            start_y: preview.min_y.min(candidate.min_y) - 20.0,
                            end_x: edge,
                            end_y: preview.max_y.max(candidate.max_y) + 20.0,
                        },
                    );
                }
            }
        }
        if north || south {
            let moving = if north { preview.min_y } else { preview.max_y };
            for edge in cys {
                let dist = (moving - edge).abs();
                if dist < effective {
                    if dist < best_dy {
                        best_dy = dist;
                        snap_dy = edge - moving;
                    }
                    push_guide(
                        &mut guides,
                        SnapGuide {
                            vertical: false,
                            position: edge,
                            start_x: preview.min_x.min(candidate.min_x) - 20.0,
                            start_y: edge,
                            end_x: preview.max_x.max(candidate.max_x) + 20.0,
                            end_y: edge,
                        },
                    );
                }
            }
        }
    }

    let mut out = *preview;
    if (west || east) && best_dx < effective {
        if west {
            out.min_x += snap_dx;
        } else {
            out.max_x += snap_dx;
        }
    }
    if (north || south) && best_dy < effective {
        if north {
            out.min_y += snap_dy;
        } else {
            out.max_y += snap_dy;
        }
    }
    if out.max_x - out.min_x < 1.0 {
        if west {
            out.min_x = out.max_x - 1.0;
        } else {
            out.max_x = out.min_x + 1.0;
        }
    }
    if out.max_y - out.min_y < 1.0 {
        if north {
            out.min_y = out.max_y - 1.0;
        } else {
            out.max_y = out.min_y + 1.0;
        }
    }
    (out, guides)
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
    fn equal_sizes_emit_both_edge_guides_with_closest_offset() {
        // Same height, tops 2 apart and bottoms 2 apart: both horizontal
        // guides show while the offset comes from the closest pair.
        let target = Bounds::new(200.0, 0.0, 250.0, 50.0);
        let moving = Bounds::new(0.0, 2.0, 50.0, 52.0);
        let result = find_snap_to_object(&moving, &[target], 10.0, &HashSet::new(), 1.0);
        let horizontals: Vec<f64> = result
            .guides
            .iter()
            .filter(|guide| guide.is_horizontal())
            .map(|guide| guide.position)
            .collect();
        assert!(horizontals.contains(&0.0));
        assert!(horizontals.contains(&50.0));
    }

    #[test]
    fn shared_edges_across_candidates_draw_once() {
        // Two candidates sharing one right edge produce a single guide.
        let first = Bounds::new(100.0, 0.0, 150.0, 50.0);
        let second = Bounds::new(100.0, 200.0, 150.0, 250.0);
        let moving = Bounds::new(152.0, 0.0, 202.0, 50.0);
        let result = find_snap_to_object(&moving, &[first, second], 10.0, &HashSet::new(), 1.0);
        let verticals: Vec<f64> = result
            .guides
            .iter()
            .filter(|guide| guide.is_vertical())
            .map(|guide| guide.position)
            .collect();
        assert_eq!(verticals, vec![150.0]);
        assert_eq!(result.x, 175.0);
    }

    #[test]
    fn resize_snaps_the_dragged_edge_and_guides_it() {
        use crate::transform::HandleType;
        // East handle 3 shy of the target right edge: edge snaps, one guide.
        let target = Bounds::new(200.0, 0.0, 300.0, 100.0);
        let preview = Bounds::new(0.0, 0.0, 297.0, 100.0);
        let (snapped, guides) = snap_resize_box(
            &preview,
            HandleType::MiddleRight,
            &[target],
            10.0,
            &HashSet::new(),
            1.0,
        );
        assert_eq!(snapped.max_x, 300.0);
        assert_eq!(snapped.min_x, 0.0);
        assert_eq!(guides.len(), 1);
        assert!(guides[0].is_vertical());
        assert_eq!(guides[0].position, 300.0);
    }

    #[test]
    fn resize_leaves_anchored_edges_and_ignores_locked_axes() {
        use crate::transform::HandleType;
        // North handle only moves y; a nearby x edge must not pull it.
        let target = Bounds::new(3.0, 200.0, 103.0, 300.0);
        let preview = Bounds::new(0.0, 197.0, 100.0, 297.0);
        let (snapped, guides) = snap_resize_box(
            &preview,
            HandleType::TopCenter,
            &[target],
            10.0,
            &HashSet::new(),
            1.0,
        );
        assert_eq!(snapped.min_y, 200.0);
        assert_eq!(snapped.max_y, 297.0);
        assert_eq!(snapped.min_x, 0.0);
        assert_eq!(snapped.max_x, 100.0);
        assert_eq!(guides.len(), 1);
        assert!(guides[0].is_horizontal());
    }

    #[test]
    fn resize_keeps_a_minimum_size() {
        use crate::transform::HandleType;
        // Snap pulling the edge past the anchor clamps at one scene unit:
        // max_x 8 snaps to the 0.5 edge, then clamps back to min_x + 1.
        let target = Bounds::new(0.0, 0.0, 0.5, 50.0);
        let preview = Bounds::new(0.0, 0.0, 8.0, 50.0);
        let (snapped, _) = snap_resize_box(
            &preview,
            HandleType::MiddleRight,
            &[target],
            10.0,
            &HashSet::new(),
            1.0,
        );
        assert_eq!(snapped.max_x, 1.0);
        assert!((snapped.max_x - snapped.min_x) >= 1.0);
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
