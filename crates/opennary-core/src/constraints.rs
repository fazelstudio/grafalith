//! Figma-style constraints on frame resize.
//!
//! TS source: `packages/core/src/interaction/constraints.ts`
//! (min/max/center/stretch/scale; collapse guard `>= 1`; nested
//! propagation — pinned by `constraints.test.ts`).
//!
//! This module is pure math only: [`apply_constraints`] takes a child plus
//! old/new frame [`Bounds`] and returns the `(x, y, width, height)` tuple
//! without touching a [`Document`](crate::document::Document) — callers
//! (resize commands, auto-layout follow-ups) own storage through
//! [`CommandContext`](crate::command::CommandContext). Per-axis work splits
//! into [`apply_horizontal_constraint`] and [`apply_vertical_constraint`]
//! so each axis is unit-testable alone, and the collapse guard and
//! zero-size guard are named constants ([`MIN_CONSTRAINT_SIZE`],
//! [`SAFE_FRAME_SIZE`]) instead of inline magic numbers.

use opennary_geometry::Bounds;

use crate::element::{ConstraintAnchor, Constraints, Element};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/// Minimum width/height a constraint pass may produce (TS `Math.max(1, …)`).
pub const MIN_CONSTRAINT_SIZE: f64 = 1.0;

/// Floor for old-frame sizes used as divisors (TS `Math.max(size, 0.001)`).
///
/// Guards the `scale` ratio math against division by zero when the old
/// frame edge has zero length.
pub const SAFE_FRAME_SIZE: f64 = 0.001;

// ---------------------------------------------------------------------------
// Pure constraint math
// ---------------------------------------------------------------------------

/// Applies constraint logic for a frame resize.
///
/// Returns the child's new `(x, y, width, height)` in scene coordinates.
/// `constraints` selects the per-axis behavior; sizes from `stretch` and
/// `scale` never collapse below [`MIN_CONSTRAINT_SIZE`].
pub fn apply_constraints(
    child: &Element,
    constraints: Constraints,
    old_frame: Bounds,
    new_frame: Bounds,
) -> (f64, f64, f64, f64) {
    let base = child.base();
    let (new_x, new_width) = apply_horizontal_constraint(
        base.x,
        base.width,
        constraints.horizontal,
        old_frame,
        new_frame,
    );
    let (new_y, new_height) = apply_vertical_constraint(
        base.y,
        base.height,
        constraints.vertical,
        old_frame,
        new_frame,
    );
    (new_x, new_y, new_width, new_height)
}

/// Applies one horizontal constraint mode, returning new `(x, width)`.
///
/// `left_dist` is the distance from the old frame's left edge to the child,
/// `right_dist` from the child's right edge to the old frame's right edge.
pub fn apply_horizontal_constraint(
    child_x: f64,
    child_width: f64,
    mode: ConstraintAnchor,
    old_frame: Bounds,
    new_frame: Bounds,
) -> (f64, f64) {
    let old_frame_w = old_frame.width();
    let new_frame_w = new_frame.width();
    let safe_old_w = old_frame_w.max(SAFE_FRAME_SIZE);
    let left_dist = child_x - old_frame.min_x;
    let right_dist = old_frame.max_x - (child_x + child_width);

    match mode {
        // Pin to the leading edge: left distance stays constant.
        ConstraintAnchor::Min => (new_frame.min_x + left_dist, child_width),
        // Pin to the trailing edge: right distance stays constant.
        ConstraintAnchor::Max => (new_frame.max_x - child_width - right_dist, child_width),
        // Keep centered: width unchanged.
        ConstraintAnchor::Center => (
            new_frame.min_x + (new_frame_w - child_width) / 2.0,
            child_width,
        ),
        // Both distances stay constant: width absorbs the resize.
        ConstraintAnchor::Stretch => {
            let new_w = new_frame_w - left_dist - right_dist;
            (new_frame.min_x + left_dist, new_w.max(MIN_CONSTRAINT_SIZE))
        }
        // Proportional: position and size scale with the frame.
        ConstraintAnchor::Scale => {
            let ratio_x = left_dist / safe_old_w;
            let scale_w = new_frame_w / safe_old_w;
            (
                new_frame.min_x + ratio_x * new_frame_w,
                (child_width * scale_w).max(MIN_CONSTRAINT_SIZE),
            )
        }
    }
}

/// Applies one vertical constraint mode, returning new `(y, height)`.
///
/// Mirrors [`apply_horizontal_constraint`] on the y axis.
pub fn apply_vertical_constraint(
    child_y: f64,
    child_height: f64,
    mode: ConstraintAnchor,
    old_frame: Bounds,
    new_frame: Bounds,
) -> (f64, f64) {
    let old_frame_h = old_frame.height();
    let new_frame_h = new_frame.height();
    let safe_old_h = old_frame_h.max(SAFE_FRAME_SIZE);
    let top_dist = child_y - old_frame.min_y;
    let bottom_dist = old_frame.max_y - (child_y + child_height);

    match mode {
        // Pin to the leading edge: top distance stays constant.
        ConstraintAnchor::Min => (new_frame.min_y + top_dist, child_height),
        // Pin to the trailing edge: bottom distance stays constant.
        ConstraintAnchor::Max => (new_frame.max_y - child_height - bottom_dist, child_height),
        // Keep centered: height unchanged.
        ConstraintAnchor::Center => (
            new_frame.min_y + (new_frame_h - child_height) / 2.0,
            child_height,
        ),
        // Both distances stay constant: height absorbs the resize.
        ConstraintAnchor::Stretch => {
            let new_h = new_frame_h - top_dist - bottom_dist;
            (new_frame.min_y + top_dist, new_h.max(MIN_CONSTRAINT_SIZE))
        }
        // Proportional: position and size scale with the frame.
        ConstraintAnchor::Scale => {
            let ratio_y = top_dist / safe_old_h;
            let scale_h = new_frame_h / safe_old_h;
            (
                new_frame.min_y + ratio_y * new_frame_h,
                (child_height * scale_h).max(MIN_CONSTRAINT_SIZE),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_rectangle, CounterIdGenerator, ElementId};

    fn child(id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
        let mut gen = CounterIdGenerator::new();
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of(id);
        rect.base.x = x;
        rect.base.y = y;
        rect.base.width = w;
        rect.base.height = h;
        Element::Rectangle(rect)
    }

    fn constraints(horizontal: ConstraintAnchor, vertical: ConstraintAnchor) -> Constraints {
        Constraints {
            horizontal,
            vertical,
        }
    }

    fn frame(x: f64, y: f64, w: f64, h: f64) -> Bounds {
        Bounds::new(x, y, x + w, y + h)
    }

    #[test]
    fn min_pins_to_leading_edge_size_unchanged() {
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 400.0, 300.0);
        let el = child("c1", 50.0, 10.0, 40.0, 30.0);
        let (x, y, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Min, ConstraintAnchor::Min),
            old,
            new,
        );
        assert_eq!((x, y, w, h), (50.0, 10.0, 40.0, 30.0));
    }

    #[test]
    fn max_pins_to_trailing_edge_size_unchanged() {
        // rightDist = 200 - 180 = 20 -> x = 400 - 40 - 20 = 340.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 400.0, 300.0);
        let el = child("c2", 140.0, 10.0, 40.0, 30.0);
        let (x, _, w, _) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Max, ConstraintAnchor::Min),
            old,
            new,
        );
        assert_eq!(x, 340.0);
        assert_eq!(w, 40.0);
    }

    #[test]
    fn max_pins_to_bottom_edge() {
        // bottomDist = 200 - 180 = 20 -> y = 400 - 40 - 20 = 340.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 300.0, 400.0);
        let el = child("c2", 10.0, 140.0, 30.0, 40.0);
        let (_, y, _, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Min, ConstraintAnchor::Max),
            old,
            new,
        );
        assert_eq!(y, 340.0);
        assert_eq!(h, 40.0);
    }

    #[test]
    fn center_keeps_child_centered_size_unchanged() {
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 400.0, 400.0);
        let el = child("c3", 80.0, 80.0, 40.0, 40.0);
        let (x, y, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Center, ConstraintAnchor::Center),
            old,
            new,
        );
        assert_eq!((x, y, w, h), (180.0, 180.0, 40.0, 40.0));
    }

    #[test]
    fn stretch_preserves_margins_size_absorbs_resize() {
        // leftDist = 50, rightDist = 50 -> x = 50, w = 400 - 100 = 300.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 400.0, 300.0);
        let el = child("c4", 50.0, 10.0, 100.0, 30.0);
        let (x, _, w, _) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Stretch, ConstraintAnchor::Min),
            old,
            new,
        );
        assert_eq!(x, 50.0);
        assert_eq!(w, 300.0);
    }

    #[test]
    fn stretch_vertical_preserves_margins() {
        // topDist = 50, bottomDist = 50 -> y = 50, h = 400 - 100 = 300.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 300.0, 400.0);
        let el = child("c4", 10.0, 50.0, 30.0, 100.0);
        let (_, y, _, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Min, ConstraintAnchor::Stretch),
            old,
            new,
        );
        assert_eq!(y, 50.0);
        assert_eq!(h, 300.0);
    }

    #[test]
    fn scale_is_proportional_on_both_axes() {
        // ratio = 0.25, scale = 2 -> pos 100, size 140 (mirrors TS test).
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 400.0, 400.0);
        let el = child("c5", 50.0, 50.0, 70.0, 70.0);
        let (x, y, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Scale, ConstraintAnchor::Scale),
            old,
            new,
        );
        assert_eq!((x, y, w, h), (100.0, 100.0, 140.0, 140.0));
    }

    #[test]
    fn combined_stretch_fills_remaining_space() {
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 400.0, 300.0);
        let el = child("c1", 20.0, 20.0, 160.0, 160.0);
        let (x, y, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Stretch, ConstraintAnchor::Stretch),
            old,
            new,
        );
        assert_eq!((x, y, w, h), (20.0, 20.0, 360.0, 260.0));
    }

    #[test]
    fn mixed_axes_pin_independently() {
        // min horizontal + max vertical: left 30, bottom 20 -> y = 350.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 300.0, 400.0);
        let el = child("c1", 30.0, 150.0, 40.0, 30.0);
        let (x, y, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Min, ConstraintAnchor::Max),
            old,
            new,
        );
        assert_eq!((x, y, w, h), (30.0, 350.0, 40.0, 30.0));
    }

    #[test]
    fn stretch_collapse_guard_never_below_one() {
        // Frame shrinks past the margins: 5 - 10 - 10 < 0 -> clamped to 1.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 5.0, 5.0);
        let el = child("c1", 10.0, 10.0, 180.0, 180.0);
        let (x, y, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Stretch, ConstraintAnchor::Stretch),
            old,
            new,
        );
        assert_eq!(x, 10.0);
        assert_eq!(y, 10.0);
        assert_eq!(w, MIN_CONSTRAINT_SIZE);
        assert_eq!(h, MIN_CONSTRAINT_SIZE);
    }

    #[test]
    fn scale_collapse_guard_never_below_one() {
        // 1px frame: 180 * 0.005 = 0.9 -> clamped to 1.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(0.0, 0.0, 1.0, 1.0);
        let el = child("c1", 10.0, 10.0, 180.0, 180.0);
        let (_, _, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Scale, ConstraintAnchor::Scale),
            old,
            new,
        );
        assert!(w >= MIN_CONSTRAINT_SIZE);
        assert!(h >= MIN_CONSTRAINT_SIZE);
    }

    #[test]
    fn zero_size_old_frame_has_no_division_by_zero() {
        // Degenerate old frame: ratios use the safe floor, never NaN/inf.
        let old = frame(0.0, 0.0, 0.0, 0.0);
        let new = frame(0.0, 0.0, 200.0, 200.0);
        let el = child("c1", 0.0, 0.0, 10.0, 10.0);
        let (x, y, w, h) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Scale, ConstraintAnchor::Scale),
            old,
            new,
        );
        for value in [x, y, w, h] {
            assert!(value.is_finite(), "no NaN/inf from zero-size frame");
        }
        assert!(w >= MIN_CONSTRAINT_SIZE);
        assert!(h >= MIN_CONSTRAINT_SIZE);
    }

    #[test]
    fn moved_frame_origin_shifts_pinned_children() {
        // Frame itself moved right by 50: min-pinned child follows the edge.
        let old = frame(0.0, 0.0, 200.0, 200.0);
        let new = frame(50.0, 0.0, 200.0, 200.0);
        let el = child("c1", 30.0, 10.0, 40.0, 30.0);
        let (x, _, w, _) = apply_constraints(
            &el,
            constraints(ConstraintAnchor::Min, ConstraintAnchor::Min),
            old,
            new,
        );
        assert_eq!(x, 80.0);
        assert_eq!(w, 40.0);
    }
}
