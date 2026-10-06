//! Ellipse and arrowhead hit-test primitives.
//!
//! TS sources: `hitTestEllipse` in `packages/core/src/shapes/ellipse.ts`
//! (ellipse equation, corner-of-bbox rejection, zero-radius guard);
//! `drawArrowhead` / `pointInArrowhead` in
//! `packages/core/src/shapes/arrow.ts` (filled-triangle heads scale with
//! stroke width; barycentric sign test).
//!
//! These helpers are rotation-agnostic by design: callers map the scene
//! point into local space first ([`crate::rotation::to_local_space`]), so
//! the same equations serve hit-testing and snapping previews without
//! duplicating math.

use crate::point::Point;

/// Arrowhead triangle length in scene units (TS `ARROWHEAD_LENGTH`).
pub const ARROWHEAD_LENGTH: f64 = 12.0;

/// Arrowhead triangle width in scene units (TS `ARROWHEAD_WIDTH`).
pub const ARROWHEAD_WIDTH: f64 = 8.0;

/// Ellipse-equation hit test in local (unrotated) space.
///
/// Ports TS `hitTestEllipse` after the rotation preamble:
/// `((x-cx)/rx)^2 + ((y-cy)/ry)^2 <= 1`. Zero radii never hit (avoids a
/// division-by-zero `NaN` that would poison comparisons). Corners of the
/// bounding box correctly miss — the pinned distinction from a box check.
pub fn point_in_ellipse(px: f64, py: f64, cx: f64, cy: f64, rx: f64, ry: f64) -> bool {
    if rx == 0.0 || ry == 0.0 {
        return false;
    }
    let nx = (px - cx) / rx;
    let ny = (py - cy) / ry;
    nx * nx + ny * ny <= 1.0
}

/// Arrowhead triangle vertices (tip, left, right) in scene coordinates.
///
/// Exact port of the TS `drawArrowhead` vertex math: the head scales with
/// `max(1, strokeWidth / 2)`, extends `ARROWHEAD_LENGTH * scale` back along
/// the segment direction, and spreads `ARROWHEAD_WIDTH * scale` across it.
/// Hit-testing mirrors rendering vertex-for-vertex by design.
pub fn arrowhead_triangle(from: &Point, tip: &Point, stroke_width: f64) -> [Point; 3] {
    let scale = (stroke_width / 2.0).max(1.0);
    let len = ARROWHEAD_LENGTH * scale;
    let width = ARROWHEAD_WIDTH * scale;
    let angle = (tip[1] - from[1]).atan2(tip[0] - from[0]);
    let base_x = tip[0] - angle.cos() * len;
    let base_y = tip[1] - angle.sin() * len;
    let left = [
        base_x + (angle + std::f64::consts::FRAC_PI_2).cos() * (width / 2.0),
        base_y + (angle + std::f64::consts::FRAC_PI_2).sin() * (width / 2.0),
    ];
    let right = [
        base_x + (angle - std::f64::consts::FRAC_PI_2).cos() * (width / 2.0),
        base_y + (angle - std::f64::consts::FRAC_PI_2).sin() * (width / 2.0),
    ];
    [*tip, left, right]
}

/// Barycentric sign-test point-in-triangle.
///
/// Exact port of TS `pointInArrowhead`'s `sign` combination (points on the
/// edge count as inside).
pub fn point_in_triangle(px: f64, py: f64, a: &Point, b: &Point, c: &Point) -> bool {
    let d1 = sign(px, py, a[0], a[1], b[0], b[1]);
    let d2 = sign(px, py, b[0], b[1], c[0], c[1]);
    let d3 = sign(px, py, c[0], c[1], a[0], a[1]);
    let has_neg = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let has_pos = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(has_neg && has_pos)
}

/// Signed edge function (TS `sign` in `shapes/arrow.ts`).
pub fn sign(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    (px - bx) * (ay - by) - (ax - bx) * (py - by)
}

/// Arrowhead hit test: point inside the rendered head triangle.
///
/// Ports the `endArrowhead`/`startArrowhead` branch of TS `hitTestArrow`
/// (heads are visible geometry — clicks on the head must hit).
pub fn point_in_arrowhead(px: f64, py: f64, from: &Point, tip: &Point, stroke_width: f64) -> bool {
    let [a, b, c] = arrowhead_triangle(from, tip, stroke_width);
    point_in_triangle(px, py, &a, &b, &c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ellipse_rejects_bbox_corners_but_keeps_interior() {
        // shapes.test.ts: 100×100 circle at origin — corner (0,0) misses
        // (dist ≈ 70.7 > r 50), center hits.
        assert!(!point_in_ellipse(0.0, 0.0, 50.0, 50.0, 50.0, 50.0));
        assert!(point_in_ellipse(50.0, 50.0, 50.0, 50.0, 50.0, 50.0));
        // Just inside the right edge at center height hits; just outside misses.
        assert!(point_in_ellipse(98.0, 60.0, 60.0, 60.0, 50.0, 40.0));
        assert!(!point_in_ellipse(112.0, 60.0, 60.0, 60.0, 50.0, 40.0));
        // Zero radii never hit (division guard).
        assert!(!point_in_ellipse(5.0, 5.0, 5.0, 5.0, 0.0, 5.0));
    }

    #[test]
    fn arrowhead_tip_hits_and_far_point_misses() {
        // remediation.test.ts: tip (100,0) on a →-headed arrow hits.
        let from = [0.0, 0.0];
        let tip = [100.0, 0.0];
        assert!(point_in_arrowhead(100.0, 0.0, &from, &tip, 1.0));
        assert!(point_in_arrowhead(94.0, 0.0, &from, &tip, 1.0));
        assert!(!point_in_arrowhead(50.0, 50.0, &from, &tip, 1.0));
        // Head scales with stroke width: at stroke 8 (scale 4) the head
        // spans x 52–100, so (80,6) sits inside; at stroke 1 (scale 1)
        // the head spans x 88–100, so the same point misses entirely.
        assert!(point_in_arrowhead(80.0, 6.0, &from, &tip, 8.0));
        assert!(!point_in_arrowhead(80.0, 6.0, &from, &tip, 1.0));
    }
}
