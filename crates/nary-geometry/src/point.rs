//! Points and vectors.
//!
//! TS source: `Point = [number, number]` in `packages/core/src/scene/types.ts`
//! (consumed by `packages/core/src/shapes/geometry.ts`).
//!
//! This module owns the point/vector primitives for the whole engine:
//! finiteness guards for persistent state, approximate equality with
//! explicit tolerances (bare `==` on floats is forbidden), and the small
//! vector algebra that rotation, resize, snapping, and hit-testing share.
//! No UI, document, or host dependency.

/// Scene-space 2D point, stored as `[x, y]`.
///
/// Mirrors the TS `Point` tuple. Points on line/arrow/freedraw/path elements
/// are relative to the element origin (`el.x`, `el.y`); absolute position is
/// `el.x + point[0]`, `el.y + point[1]`.
pub type Point = [f64; 2];

/// Returns `true` when both coordinates are finite.
///
/// Persistent state must never contain `NaN`/`Infinity`; the document
/// model rejects non-finite points on entry.
pub fn point_is_finite(point: &Point) -> bool {
    point[0].is_finite() && point[1].is_finite()
}

/// Returns `true` when every point in the slice is finite.
pub fn points_are_finite(points: &[Point]) -> bool {
    points.iter().all(point_is_finite)
}

/// Approximate equality for two floats with an explicit tolerance.
///
/// Bare `==` on floats is forbidden. Callers pass the tolerance that
/// matches the contract they pin (tests in this workspace typically use `1e-9` for exact ports of TS
/// math and `0.5` only where a TS `toBeCloseTo(value, 0)` bound is quoted).
pub fn approx_eq(a: f64, b: f64, epsilon: f64) -> bool {
    (a - b).abs() <= epsilon
}

/// Approximate equality for two points with an explicit tolerance.
pub fn points_approx_eq(a: &Point, b: &Point, epsilon: f64) -> bool {
    approx_eq(a[0], b[0], epsilon) && approx_eq(a[1], b[1], epsilon)
}

/// Adds two vectors (`a + b`).
pub fn add(a: &Point, b: &Point) -> Point {
    [a[0] + b[0], a[1] + b[1]]
}

/// Subtracts two vectors (`a - b`).
pub fn sub(a: &Point, b: &Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

/// Scales a vector by a scalar.
pub fn scale(point: &Point, factor: f64) -> Point {
    [point[0] * factor, point[1] * factor]
}

/// Dot product of two vectors.
pub fn dot(a: &Point, b: &Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

/// Squared length of a vector (avoids a `sqrt` when only comparing).
pub fn length_sq(point: &Point) -> f64 {
    dot(point, point)
}

/// Length of a vector.
pub fn length(point: &Point) -> f64 {
    length_sq(point).sqrt()
}

/// Squared distance between two points.
pub fn distance_sq(a: &Point, b: &Point) -> f64 {
    let dx = a[0] - b[0];
    let dy = a[1] - b[1];
    dx * dx + dy * dy
}

/// Distance between two points.
pub fn distance(a: &Point, b: &Point) -> f64 {
    distance_sq(a, b).sqrt()
}

/// Midpoint of two points.
pub fn midpoint(a: &Point, b: &Point) -> Point {
    [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
}

/// Linear interpolation between two points (`t = 0` yields `a`, `t = 1`
/// yields `b`).
pub fn lerp(a: &Point, b: &Point, t: f64) -> Point {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finite_check_rejects_nan_and_infinity() {
        assert!(point_is_finite(&[1.0, 2.0]));
        assert!(!point_is_finite(&[f64::NAN, 2.0]));
        assert!(!point_is_finite(&[1.0, f64::INFINITY]));
        assert!(!point_is_finite(&[f64::NEG_INFINITY, f64::NAN]));
    }

    #[test]
    fn approx_eq_uses_explicit_tolerance() {
        assert!(approx_eq(0.1 + 0.2, 0.3, 1e-9));
        assert!(!approx_eq(0.1 + 0.2, 0.31, 1e-9));
        assert!(approx_eq(14.64, 14.644_660_940_672_62, 0.5));
    }

    #[test]
    fn vector_algebra_matches_hand_computed_values() {
        assert_eq!(add(&[1.0, 2.0], &[3.0, 4.0]), [4.0, 6.0]);
        assert_eq!(sub(&[3.0, 4.0], &[1.0, 2.0]), [2.0, 2.0]);
        assert_eq!(scale(&[3.0, -4.0], 2.0), [6.0, -8.0]);
        assert!(approx_eq(dot(&[1.0, 0.0], &[0.0, 1.0]), 0.0, 1e-12));
        assert!(approx_eq(length(&[3.0, 4.0]), 5.0, 1e-12));
        assert!(approx_eq(distance(&[0.0, 0.0], &[3.0, 4.0]), 5.0, 1e-12));
        assert_eq!(midpoint(&[0.0, 0.0], &[10.0, 20.0]), [5.0, 10.0]);
        assert_eq!(lerp(&[0.0, 0.0], &[10.0, 20.0], 0.25), [2.5, 5.0]);
        assert!(points_approx_eq(&[0.1 + 0.2, 0.0], &[0.3, 0.0], 1e-9));
    }
}
