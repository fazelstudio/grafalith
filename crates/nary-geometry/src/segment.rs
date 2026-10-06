//! Segment distances, polyline stroke tests, and polygon tests.
//!
//! TS sources: `distSqToSegment`, `distToSegment` in
//! `packages/core/src/shapes/geometry.ts`; `pointInPolygon` and
//! `hitTestStroke` in `packages/core/src/shapes/path.ts`; segment use in
//! `packages/core/src/interaction/path-edit.ts` (`distToSegment`).
//!
//! These are the shared distance primitives behind line, arrow, freedraw,
//! and path hit-testing (all use the `strokeWidth / 2 + 4` threshold — see
//! [`crate::transform::stroke_hit_threshold`]). Pure math, no element
//! types: callers pass absolute scene-space points.

use crate::point::{distance, Point};

/// Squared distance from point `p` to line segment `ab`.
///
/// Exact port of TS `distSqToSegment`, including the degenerate
/// (`a == b`) path and the `t` clamp to `[0, 1]`.
pub fn dist_sq_to_segment(p: &Point, a: &Point, b: &Point) -> f64 {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len_sq = dx * dx + dy * dy;

    if len_sq == 0.0 {
        // Degenerate segment (a == b).
        let ex = p[0] - a[0];
        let ey = p[1] - a[1];
        return ex * ex + ey * ey;
    }

    let mut t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len_sq;
    t = t.clamp(0.0, 1.0);

    let proj_x = a[0] + t * dx;
    let proj_y = a[1] + t * dy;
    let ex = p[0] - proj_x;
    let ey = p[1] - proj_y;
    ex * ex + ey * ey
}

/// Distance from point `p` to line segment `ab`.
///
/// Exact port of TS `distToSegment` (`sqrt` of [`dist_sq_to_segment`]).
pub fn dist_to_segment(p: &Point, a: &Point, b: &Point) -> f64 {
    dist_sq_to_segment(p, a, b).sqrt()
}

/// Returns `true` when point `p` is within `threshold` of any segment of
/// the polyline (squared-distance comparison, no `sqrt` per segment).
///
/// Ports TS `hitTestStroke` from `shapes/path.ts`. A polyline with fewer
/// than two points never hits.
pub fn polyline_hits_stroke(p: &Point, polyline: &[Point], threshold: f64) -> bool {
    if polyline.len() < 2 {
        return false;
    }
    let threshold_sq = threshold * threshold;
    for i in 0..polyline.len() - 1 {
        if dist_sq_to_segment(p, &polyline[i], &polyline[i + 1]) <= threshold_sq {
            return true;
        }
    }
    false
}

/// Ray-casting point-in-polygon test.
///
/// Exact port of TS `pointInPolygon` from `shapes/path.ts` (including the
/// `< 3 vertices` early-`false`). Used for closed, filled paths.
pub fn point_in_polygon(px: f64, py: f64, polygon: &[Point]) -> bool {
    if polygon.len() < 3 {
        return false;
    }
    let mut inside = false;
    let mut j = polygon.len() - 1;
    for i in 0..polygon.len() {
        let xi = polygon[i][0];
        let yi = polygon[i][1];
        let xj = polygon[j][0];
        let yj = polygon[j][1];
        let intersect = (yi > py) != (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi;
        if intersect {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// Distance from a point to the closest segment of a polyline.
///
/// Convenience for path-edit segment hover (`SEGMENT_HIT_THRESHOLD`
/// callers). Returns `INFINITY` for polylines with fewer than two points.
pub fn dist_to_polyline(p: &Point, polyline: &[Point]) -> f64 {
    if polyline.len() < 2 {
        return f64::INFINITY;
    }
    let mut best = f64::INFINITY;
    for i in 0..polyline.len() - 1 {
        let d = distance(
            p,
            &closest_point_on_segment(p, &polyline[i], &polyline[i + 1]),
        );
        if d < best {
            best = d;
        }
    }
    best
}

/// Closest point on segment `ab` to point `p` (projection clamped to the
/// segment, mirroring [`dist_sq_to_segment`]).
pub fn closest_point_on_segment(p: &Point, a: &Point, b: &Point) -> Point {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len_sq = dx * dx + dy * dy;
    if len_sq == 0.0 {
        return *a;
    }
    let t = (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len_sq).clamp(0.0, 1.0);
    [a[0] + t * dx, a[1] + t * dy]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::approx_eq;

    #[test]
    fn segment_distance_matches_ts_contract() {
        // On-segment projection.
        assert!(approx_eq(
            dist_to_segment(&[50.0, 0.0], &[0.0, 0.0], &[100.0, 0.0]),
            0.0,
            1e-12
        ));
        // Perpendicular distance.
        assert!(approx_eq(
            dist_to_segment(&[50.0, 3.0], &[0.0, 0.0], &[100.0, 0.0]),
            3.0,
            1e-12
        ));
        // Beyond the endpoint: distance to the cap, not the infinite line.
        assert!(approx_eq(
            dist_to_segment(&[150.0, 0.0], &[0.0, 0.0], &[100.0, 0.0]),
            50.0,
            1e-12
        ));
        // Degenerate segment behaves as a point.
        assert!(approx_eq(
            dist_to_segment(&[3.0, 4.0], &[0.0, 0.0], &[0.0, 0.0]),
            5.0,
            1e-12
        ));
    }

    #[test]
    fn stroke_test_uses_squared_threshold_without_sqrt() {
        let line: Vec<Point> = vec![[0.0, 0.0], [100.0, 0.0]];
        // Threshold 5 (strokeWidth 2 → 1 + 4): 3px hits, 10px misses —
        // the exact `shapes.test.ts` line assertions.
        assert!(polyline_hits_stroke(&[50.0, 3.0], &line, 5.0));
        assert!(!polyline_hits_stroke(&[50.0, 10.0], &line, 5.0));
        assert!(!polyline_hits_stroke(&[50.0, 0.0], &[[0.0, 0.0]], 5.0));
    }

    #[test]
    fn polygon_ray_casting_matches_ts() {
        let square: Vec<Point> = vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
        assert!(point_in_polygon(50.0, 50.0, &square));
        assert!(!point_in_polygon(150.0, 50.0, &square));
        assert!(!point_in_polygon(0.0, 0.0, &[[0.0, 0.0], [1.0, 1.0]]));
    }
}
