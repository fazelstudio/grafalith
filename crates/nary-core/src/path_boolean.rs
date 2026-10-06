//! Polygon boolean operations on flattened paths (ADR-0020).
//!
//! Closed, unrotated path inputs become world-space contours through the
//! same anchor math the hit-tester uses, flatten, and combine through
//! `i_overlay`. Results are exact **on the flattened polygons** (an
//! approximation of the true beziers bounded by flatten chord error) and
//! come back as sharp-anchor closed paths re-based to a tight origin box.
//!
//! Limits (explicit, never silent): closed paths only, unrotated only,
//! coordinates finite and within ±3e150 (below i_overlay's f64 ceiling —
//! its infallible API panics otherwise), `EvenOdd` fill rule, and no
//! holes in results (single-contour `PathElement` cannot hold them —
//! holed results are `Unsupported`, compound paths are the follow-up).

use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;

use crate::boolean::BooleanOp;
use crate::geometry::path::{flatten_anchors, PathAnchor};
use crate::geometry::point::Point;
use crate::EngineResult;

/// i_overlay's f64 ceiling is 2^500 (~3.27e150); stay clearly below it.
const MAX_OVERLAY_COORD: f64 = 3.0e150;

/// Minimum anchors for a meaningful closed contour.
const MIN_CONTOUR_POINTS: usize = 3;

/// Converts one closed path's segments to a world-space contour, mirroring
/// the hit-test anchor math exactly (origin + point, origin + point +
/// offset).
pub fn path_contour(origin: Point, segments: &[crate::element::PathSegment]) -> Vec<PathAnchor> {
    segments
        .iter()
        .map(|segment| {
            let anchor = [origin[0] + segment.point[0], origin[1] + segment.point[1]];
            PathAnchor {
                point: anchor,
                handle_in: segment
                    .handle_in
                    .map(|handle| [anchor[0] + handle[0], anchor[1] + handle[1]]),
                handle_out: segment
                    .handle_out
                    .map(|handle| [anchor[0] + handle[0], anchor[1] + handle[1]]),
            }
        })
        .collect()
}

/// Runs one boolean op over two closed world-space contours.
///
/// Returns the outer contour of every result shape (absolute scene
/// coordinates). degenerate inputs are `InvalidInput`; result shapes with
/// holes are `Unsupported` (no silent hole-dropping).
pub fn path_overlay(
    kind: BooleanOp,
    subject: &[Point],
    clip: &[Point],
) -> EngineResult<Vec<Vec<Point>>> {
    let op = kind.name();
    for (side, contour) in [("subject", subject), ("clip", clip)] {
        if contour.len() < MIN_CONTOUR_POINTS {
            return Err(crate::EngineError::InvalidInput(format!(
                "boolean.{op}: {side} contour is degenerate (fewer than 3 points)"
            )));
        }
        if contour.iter().any(|point| !point_is_bounded(point)) {
            return Err(crate::EngineError::InvalidInput(format!(
                "boolean.{op}: {side} contour leaves the supported coordinate range"
            )));
        }
    }
    let rule = match kind {
        BooleanOp::Union => OverlayRule::Union,
        BooleanOp::Subtract => OverlayRule::Difference,
        BooleanOp::Intersect => OverlayRule::Intersect,
        BooleanOp::Exclude => OverlayRule::Xor,
    };
    // Single closed contours on both sides (mirrors the documented
    // single-contour example shape of the overlay API).
    let subject_shapes = [subject.to_vec()];
    let shapes = subject_shapes.overlay(&clip.to_vec(), rule, FillRule::EvenOdd);
    let mut out = Vec::with_capacity(shapes.len());
    for shape in &shapes {
        let Some(outer) = shape.first() else {
            continue;
        };
        if shape.len() > 1 {
            return Err(crate::EngineError::Unsupported(format!(
                "boolean.{op} produced a holed result, which needs compound paths (follow-up)"
            )));
        }
        let mut contour: Vec<Point> = outer.to_vec();
        // Drop simplification noise (zero-area fragments carry no paint).
        if contour.len() < MIN_CONTOUR_POINTS {
            continue;
        }
        // Drop a duplicated closing point; closure is structural (`closed`).
        if contour.len() > 1 {
            let first = contour[0];
            let last = contour[contour.len() - 1];
            if (first[0] - last[0]).abs() <= f64::EPSILON
                && (first[1] - last[1]).abs() <= f64::EPSILON
            {
                contour.pop();
            }
        }
        if contour.len() >= MIN_CONTOUR_POINTS {
            out.push(contour);
        }
    }
    Ok(out)
}

/// Finite and within the overlay coordinate ceiling.
fn point_is_bounded(point: &Point) -> bool {
    point[0].is_finite()
        && point[1].is_finite()
        && point[0].abs() <= MAX_OVERLAY_COORD
        && point[1].abs() <= MAX_OVERLAY_COORD
}

/// Flattens closed path segments to a world-space contour (empty when the
/// path has fewer than two anchors — the caller reports degeneracy).
pub fn flatten_closed_path(origin: Point, segments: &[crate::element::PathSegment]) -> Vec<Point> {
    if segments.len() < 2 {
        return Vec::new();
    }
    flatten_anchors(&path_contour(origin, segments), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, size: f64) -> Vec<Point> {
        vec![[x, y], [x + size, y], [x + size, y + size], [x, y + size]]
    }

    fn area_of(contour: &[Point]) -> f64 {
        // Shoelace (absolute value: orientation-independent).
        let mut area = 0.0;
        for i in 0..contour.len() {
            let [x0, y0] = contour[i];
            let [x1, y1] = contour[(i + 1) % contour.len()];
            area += x0 * y1 - x1 * y0;
        }
        (area / 2.0).abs()
    }

    #[test]
    fn square_union_intersect_subtract_exclude_are_exact() {
        let a = square(0.0, 0.0, 10.0);
        let b = square(5.0, 5.0, 10.0);
        let union = path_overlay(BooleanOp::Union, &a, &b).unwrap();
        assert_eq!(union.len(), 1);
        assert!((area_of(&union[0]) - 175.0).abs() < 1e-9);
        let intersect = path_overlay(BooleanOp::Intersect, &a, &b).unwrap();
        assert_eq!(intersect.len(), 1);
        assert!((area_of(&intersect[0]) - 25.0).abs() < 1e-9);
        let subtract = path_overlay(BooleanOp::Subtract, &a, &b).unwrap();
        assert_eq!(subtract.len(), 1);
        assert!((area_of(&subtract[0]) - 75.0).abs() < 1e-9);
        let exclude = path_overlay(BooleanOp::Exclude, &a, &b).unwrap();
        assert_eq!(exclude.len(), 2);
        let total: f64 = exclude.iter().map(|contour| area_of(contour)).sum();
        assert!((total - 150.0).abs() < 1e-9);
    }

    #[test]
    fn disjoint_inputs_union_but_never_intersect() {
        let a = square(0.0, 0.0, 10.0);
        let far = square(50.0, 50.0, 10.0);
        let union = path_overlay(BooleanOp::Union, &a, &far).unwrap();
        assert_eq!(union.len(), 2);
        assert!(path_overlay(BooleanOp::Intersect, &a, &far)
            .unwrap()
            .is_empty());
        assert!(path_overlay(BooleanOp::Subtract, &a, &far).unwrap().len() == 1);
    }

    #[test]
    fn holed_results_are_unsupported_not_silent() {
        // B fully inside A: difference is A with a B-shaped hole.
        let a = square(0.0, 0.0, 10.0);
        let hole = square(3.0, 3.0, 4.0);
        assert!(matches!(
            path_overlay(BooleanOp::Subtract, &a, &hole),
            Err(crate::EngineError::Unsupported(_))
        ));
    }

    #[test]
    fn degenerate_and_wild_inputs_are_invalid() {
        let a = square(0.0, 0.0, 10.0);
        assert!(matches!(
            path_overlay(BooleanOp::Union, &a[..2], &a),
            Err(crate::EngineError::InvalidInput(_))
        ));
        let wild = vec![[1e301, 0.0], [1.0, 0.0], [0.0, 1.0]];
        assert!(matches!(
            path_overlay(BooleanOp::Union, &wild, &a),
            Err(crate::EngineError::InvalidInput(_))
        ));
    }
}
