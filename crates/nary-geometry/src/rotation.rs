//! Rotation primitives and inverse transforms.
//!
//! TS sources: per-shape inverse-rotation in `packages/core/src/shapes/*.ts`
//! (`hitTestRectangle`, `hitTestEllipse`, `hitTestLine`, `hitTestArrow`,
//! `hitTestFreedraw`, `hitTestText`, `hitTestImage`, `hitTestPath` — all map
//! the scene point into unrotated local space with `cos(-rotation)` /
//! `sin(-rotation)` about a center), and the rotate math in
//! `packages/core/src/interaction/transform.ts` (`updateRotate`).
//!
//! Every helper declares its space: `rotate_point_around`
//! moves a scene point about a scene center; `to_local_space` is the exact
//! inverse used before axis-aligned hit/bounds logic.

use crate::point::Point;
use std::f64::consts::PI;

/// Snap increment for Shift-rotate: 15 degrees (`Math.PI / 12` in TS
/// `updateRotate`, pinned by `transform.test.ts`).
pub const ROTATE_SNAP_INCREMENT: f64 = PI / 12.0;

/// Rotates point `p` around center `c` by `angle` radians.
pub fn rotate_point_around(p: &Point, c: &Point, angle: f64) -> Point {
    let cos = angle.cos();
    let sin = angle.sin();
    let dx = p[0] - c[0];
    let dy = p[1] - c[1];
    [dx * cos - dy * sin + c[0], dx * sin + dy * cos + c[1]]
}

/// Maps a scene point into the element's unrotated local frame.
///
/// Exact port of the TS hit-test preamble: rotate by `-rotation` about the
/// given center. When `rotation == 0.0` the point is returned unchanged
/// (no trig drift, mirroring the TS `rotation === 0` fast paths).
pub fn to_local_space(px: f64, py: f64, cx: f64, cy: f64, rotation: f64) -> Point {
    if rotation == 0.0 {
        return [px, py];
    }
    let cos = (-rotation).cos();
    let sin = (-rotation).sin();
    let dx = px - cx;
    let dy = py - cy;
    [dx * cos - dy * sin + cx, dx * sin + dy * cos + cy]
}

/// Maps a local-frame point back to scene space (forward rotation about
/// the same center). Together with [`to_local_space`], round-trips exactly
/// up to float error.
pub fn to_world_space(lx: f64, ly: f64, cx: f64, cy: f64, rotation: f64) -> Point {
    if rotation == 0.0 {
        return [lx, ly];
    }
    rotate_point_around(&[lx, ly], &[cx, cy], rotation)
}

/// Normalizes a rotation to `[-PI, PI]`.
///
/// Ports the wrap loop at the end of TS `updateRotate` verbatim
/// (strict `> PI` / `< -PI` comparisons — an input of exactly `-PI`
/// stays `-PI`).
pub fn normalize_rotation(mut rotation: f64) -> f64 {
    while rotation > PI {
        rotation -= 2.0 * PI;
    }
    while rotation < -PI {
        rotation += 2.0 * PI;
    }
    rotation
}

/// Computes the new rotation for a rotate gesture.
///
/// Exact port of TS `updateRotate`: the pointer angle delta about the
/// element center is added to the start rotation; with Shift the result
/// snaps to [`ROTATE_SNAP_INCREMENT`] before the `[-PI, PI]` wrap.
pub fn rotate_delta(
    start_rotation: f64,
    anchor: &Point,
    current: &Point,
    center: &Point,
    snap_to_increment: bool,
) -> f64 {
    let angle = (current[1] - center[1]).atan2(current[0] - center[0]);
    let start_angle = (anchor[1] - center[1]).atan2(anchor[0] - center[0]);
    let mut next = start_rotation + (angle - start_angle);
    if snap_to_increment {
        next = (next / ROTATE_SNAP_INCREMENT).round() * ROTATE_SNAP_INCREMENT;
    }
    normalize_rotation(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::{approx_eq, points_approx_eq};

    #[test]
    fn local_and_world_space_round_trip() {
        let center = [140.0, 130.0];
        let p = [180.0, 170.0];
        let rotation = std::f64::consts::FRAC_PI_4;
        let local = to_local_space(p[0], p[1], center[0], center[1], rotation);
        let back = to_world_space(local[0], local[1], center[0], center[1], rotation);
        assert!(points_approx_eq(&back, &p, 1e-9));
    }

    #[test]
    fn zero_rotation_is_identity_without_trig() {
        assert_eq!(to_local_space(3.0, 4.0, 100.0, 100.0, 0.0), [3.0, 4.0]);
        assert_eq!(to_world_space(3.0, 4.0, 100.0, 100.0, 0.0), [3.0, 4.0]);
    }

    #[test]
    fn rotate_matches_quarter_turn() {
        // (1, 0) about the origin by +90° → (0, 1).
        let out = rotate_point_around(&[1.0, 0.0], &[0.0, 0.0], std::f64::consts::FRAC_PI_2);
        assert!(points_approx_eq(&out, &[0.0, 1.0], 1e-12));
    }

    #[test]
    fn rotate_delta_ports_ts_update_rotate() {
        // transform.test.ts: start at center-right, drag to center-bottom
        // → ~90° rotation (> 0.1 rad asserted there).
        let center = [140.0, 130.0];
        let rotation = rotate_delta(0.0, &[190.0, 130.0], &[140.0, 180.0], &center, false);
        assert!(approx_eq(rotation, std::f64::consts::FRAC_PI_2, 1e-9));
        // Shift snaps to 15° increments.
        let snapped = rotate_delta(0.0, &[190.0, 130.0], &[180.0, 145.0], &center, true);
        let nearest = (snapped / ROTATE_SNAP_INCREMENT).round() * ROTATE_SNAP_INCREMENT;
        assert!(approx_eq(snapped, nearest, 0.01));
        // Wrap: PI + epsilon lands just above -PI; exact -PI is kept
        // (verbatim TS strict comparisons).
        assert!(normalize_rotation(PI + 0.1) < 0.0);
        assert_eq!(normalize_rotation(-PI), -PI);
    }
}
