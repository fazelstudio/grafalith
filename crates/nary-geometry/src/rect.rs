//! Axis-aligned and rotated bounds.
//!
//! TS sources: `Bounds`, `getRotatedBounds`, `pointInBounds` in
//! `packages/core/src/shapes/geometry.ts`; per-shape `getBounds` in
//! `packages/core/src/shapes/*.ts` (dispatched through
//! `getElementBounds` in `packages/core/src/shapes/index.ts`).
//!
//! Covers the `Bounds` owner plus `rotated_bounds` (exact port of
//! `getRotatedBounds`, including the `rotation == 0` fast path) and the
//! containment/intersection predicates the frame and selection logic needs.
//! Hit-testing, culling, and snapping reuse this type — no duplicated
//! geometry math between interaction and rendering.

/// Axis-aligned bounding box in scene coordinates.
///
/// All bounds in the engine are scene-space (ARCHITECTURE §3.5); conversion
/// to screen space happens only at the render/input boundary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    /// Minimum x (left edge).
    pub min_x: f64,
    /// Minimum y (top edge).
    pub min_y: f64,
    /// Maximum x (right edge).
    pub max_x: f64,
    /// Maximum y (bottom edge).
    pub max_y: f64,
}

impl Bounds {
    /// Creates bounds from explicit edges. Callers must uphold
    /// `min <= max`; constructors in this module always do.
    pub fn new(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    /// Creates bounds from an `x/y/width/height` box (element space).
    pub fn from_xywh(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self::new(x, y, x + width, y + height)
    }

    /// Degenerate bounds for a single point (empty point lists, zero-size
    /// elements). Mirrors the TS fallbacks that return `{x, y, x, y}`.
    pub fn point(x: f64, y: f64) -> Self {
        Self::new(x, y, x, y)
    }

    /// Center of the box.
    pub fn center(&self) -> [f64; 2] {
        [
            (self.min_x + self.max_x) / 2.0,
            (self.min_y + self.max_y) / 2.0,
        ]
    }

    /// Smallest box containing both `self` and `other`.
    ///
    /// Used for combined selection bounds (TS `computeSelectionBounds` /
    /// `computeCombinedBounds`) and snap-guide extents.
    pub fn union(&self, other: &Bounds) -> Bounds {
        Bounds::new(
            self.min_x.min(other.min_x),
            self.min_y.min(other.min_y),
            self.max_x.max(other.max_x),
            self.max_y.max(other.max_y),
        )
    }

    /// Width of the box (`max_x - min_x`).
    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    /// Height of the box (`max_y - min_y`).
    pub fn height(&self) -> f64 {
        self.max_y - self.min_y
    }

    /// Returns `true` when all four edges are finite.
    pub fn is_finite(&self) -> bool {
        self.min_x.is_finite()
            && self.min_y.is_finite()
            && self.max_x.is_finite()
            && self.max_y.is_finite()
    }

    /// Inclusive point containment. Mirrors TS `pointInBounds`.
    pub fn contains_point(&self, x: f64, y: f64) -> bool {
        x >= self.min_x && x <= self.max_x && y >= self.min_y && y <= self.max_y
    }

    /// Inclusive full containment (`other` inside `self`, touching edges
    /// count). Ports the `isContainedInFrame` check from
    /// `scene/frame-actions.ts`.
    pub fn contains(&self, other: &Bounds) -> bool {
        other.min_x >= self.min_x
            && other.max_x <= self.max_x
            && other.min_y >= self.min_y
            && other.max_y <= self.max_y
    }

    /// Inclusive overlap (touching edges count as overlap). Ports the
    /// `boundsOverlap` contract from `interaction/selection.ts`: touching
    /// counts, pinned by `selection.test.ts`.
    pub fn intersects(&self, other: &Bounds) -> bool {
        self.min_x <= other.max_x
            && self.max_x >= other.min_x
            && self.min_y <= other.max_y
            && self.max_y >= other.min_y
    }
}

/// Axis-aligned bounding box of a rectangle rotated about its center.
///
/// Exact port of TS `getRotatedBounds`, including the `rotation == 0` fast
/// path that returns the unrotated box bit-for-bit (no trig drift). Rotation
/// is in radians, matching `BaseElement.rotation`.
pub fn rotated_bounds(x: f64, y: f64, width: f64, height: f64, rotation: f64) -> Bounds {
    if rotation == 0.0 {
        return Bounds::new(x, y, x + width, y + height);
    }

    let cx = x + width / 2.0;
    let cy = y + height / 2.0;
    let hw = width / 2.0;
    let hh = height / 2.0;

    let cos = rotation.cos();
    let sin = rotation.sin();

    let corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)];

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for (px, py) in corners {
        let rx = px * cos - py * sin + cx;
        let ry = px * sin + py * cos + cy;
        if rx < min_x {
            min_x = rx;
        }
        if ry < min_y {
            min_y = ry;
        }
        if rx > max_x {
            max_x = rx;
        }
        if ry > max_y {
            max_y = ry;
        }
    }

    Bounds::new(min_x, min_y, max_x, max_y)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::approx_eq;

    #[test]
    fn unrotated_bounds_are_exact() {
        // Mirrors `getRectangleBounds` without rotation (`shapes.test.ts`).
        let b = rotated_bounds(10.0, 20.0, 100.0, 80.0, 0.0);
        assert_eq!(
            b,
            Bounds::new(10.0, 20.0, 110.0, 100.0),
            "rotation == 0 must take the fast path with no trig drift"
        );
    }

    #[test]
    fn rotated_square_expands_beyond_original() {
        // Mirrors the TS "returns expanded bounds with rotation" case.
        let b = rotated_bounds(0.0, 0.0, 100.0, 100.0, std::f64::consts::FRAC_PI_4);
        assert!(b.min_x < 0.0);
        assert!(b.min_y < 0.0);
        assert!(b.max_x > 100.0);
        assert!(b.max_y > 100.0);
    }

    #[test]
    fn rotated_line_matches_pinned_ts_values() {
        // Freedraw/line single-segment geometry from `shapes.test.ts`:
        // local (0,0,100,0) at 45 degrees. TS pins these with
        // `toBeCloseTo(value, 0)` (tolerance 0.5); we pin tighter.
        let b = rotated_bounds(0.0, 0.0, 100.0, 0.0, std::f64::consts::FRAC_PI_4);
        let eps = 1e-9;
        assert!(
            approx_eq(b.min_x, 14.644_660_940_672_62, eps),
            "min_x = {b:?}"
        );
        assert!(
            approx_eq(b.min_y, -35.355_339_059_327_38, eps),
            "min_y = {b:?}"
        );
        assert!(
            approx_eq(b.max_x, 85.355_339_059_327_38, eps),
            "max_x = {b:?}"
        );
        assert!(
            approx_eq(b.max_y, 35.355_339_059_327_38, eps),
            "max_y = {b:?}"
        );
    }

    #[test]
    fn containment_is_inclusive() {
        let outer = Bounds::new(0.0, 0.0, 100.0, 100.0);
        assert!(outer.contains(&Bounds::new(10.0, 10.0, 90.0, 90.0)));
        // Touching edges count (frame containment + selection overlap).
        assert!(outer.contains(&Bounds::new(0.0, 0.0, 100.0, 100.0)));
        assert!(!outer.contains(&Bounds::new(-1.0, 0.0, 100.0, 100.0)));
        assert!(outer.intersects(&Bounds::new(100.0, 100.0, 200.0, 200.0)));
        assert!(!outer.intersects(&Bounds::new(101.0, 0.0, 200.0, 200.0)));
        assert!(outer.contains_point(0.0, 0.0));
        assert!(!outer.contains_point(100.01, 50.0));
    }

    #[test]
    fn degenerate_point_bounds() {
        let b = Bounds::point(50.0, 50.0);
        assert_eq!(b.width(), 0.0);
        assert_eq!(b.height(), 0.0);
        assert!(b.is_finite());
        assert!(!Bounds::new(0.0, 0.0, f64::NAN, 1.0).is_finite());
    }

    #[test]
    fn union_and_center_cover_selection_bounds_math() {
        let a = Bounds::new(0.0, 0.0, 100.0, 80.0);
        let b = Bounds::new(200.0, 200.0, 250.0, 250.0);
        let u = a.union(&b);
        assert_eq!(u, Bounds::new(0.0, 0.0, 250.0, 250.0));
        assert_eq!(
            Bounds::from_xywh(10.0, 20.0, 100.0, 80.0).center(),
            [60.0, 60.0]
        );
    }
}
