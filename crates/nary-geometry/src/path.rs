//! Cubic-Bezier path flattening for hit-testing.
//!
//! TS sources: `flattenPath` / `flattenBezierSegment` in
//! `packages/core/src/shapes/path.ts` (`FLATTEN_SAMPLES = 10`).
//!
//! Rendering draws true Beziers; hit-testing walks the flattened polyline
//! (with [`crate::segment`] stroke/polygon tests). The sample count is a
//! pinned contract — changing it shifts hit results on curves.

use crate::point::Point;

/// Samples per Bezier segment when flattening (TS `FLATTEN_SAMPLES`).
pub const FLATTEN_SAMPLES: usize = 10;

/// One path anchor with optional relative Bezier handles.
///
/// Mirrors TS `PathSegment` without depending on the document model:
/// handles are offsets relative to the anchor, already shifted into
/// absolute scene space by the caller (`el.x + …`, as in TS
/// `flattenBezierSegment`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PathAnchor {
    /// Anchor position (absolute scene coordinates).
    pub point: Point,
    /// Incoming control offset (absolute scene coordinates), if curved.
    pub handle_in: Option<Point>,
    /// Outgoing control offset (absolute scene coordinates), if curved.
    pub handle_out: Option<Point>,
}

impl PathAnchor {
    /// Sharp (straight-line) anchor.
    pub fn corner(x: f64, y: f64) -> Self {
        Self {
            point: [x, y],
            handle_in: None,
            handle_out: None,
        }
    }
}

/// Flattens anchors into a polyline of absolute scene points.
///
/// Exact port of TS `flattenPath`: the first anchor seeds the result; each
/// consecutive pair appends its endpoint (straight pairs) or
/// [`FLATTEN_SAMPLES`] Bezier samples ending at the endpoint (curved
/// pairs); closed paths additionally flatten the last→first segment.
/// Returns an empty vector for zero anchors.
pub fn flatten_anchors(anchors: &[PathAnchor], closed: bool) -> Vec<Point> {
    let mut result = Vec::new();
    if anchors.is_empty() {
        return result;
    }
    result.push(anchors[0].point);
    for i in 0..anchors.len().saturating_sub(1) {
        flatten_bezier_segment(&anchors[i], &anchors[i + 1], &mut result);
    }
    if closed && anchors.len() > 1 {
        let last = anchors.len() - 1;
        flatten_bezier_segment(&anchors[last], &anchors[0], &mut result);
    }
    result
}

/// Flattens one anchor-to-anchor segment, appending to `result`.
///
/// Exact port of TS `flattenBezierSegment`: straight pairs append the
/// endpoint; curved pairs sample the cubic at `t = 1/10 … 1` (endpoint
/// always appended, so open polylines keep their exact endpoint).
pub fn flatten_bezier_segment(prev: &PathAnchor, curr: &PathAnchor, result: &mut Vec<Point>) {
    if prev.handle_out.is_none() && curr.handle_in.is_none() {
        result.push(curr.point);
        return;
    }
    let (px, py) = (prev.point[0], prev.point[1]);
    let (cx, cy) = (curr.point[0], curr.point[1]);
    // TS treats missing handles as zero offsets (relative to the anchor);
    // here handles are already absolute, so a missing handle falls back to
    // its own anchor point.
    let [cp1x, cp1y] = prev.handle_out.unwrap_or(prev.point);
    let [cp2x, cp2y] = curr.handle_in.unwrap_or(curr.point);
    for t in 1..=FLATTEN_SAMPLES {
        let tt = t as f64 / FLATTEN_SAMPLES as f64;
        let u = 1.0 - tt;
        let (u2, u3) = (u * u, u * u * u);
        let (t2, t3) = (tt * tt, tt * tt * tt);
        result.push([
            u3 * px + 3.0 * u2 * tt * cp1x + 3.0 * u * t2 * cp2x + t3 * cx,
            u3 * py + 3.0 * u2 * tt * cp1y + 3.0 * u * t2 * cp2y + t3 * cy,
        ]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point::approx_eq;

    #[test]
    fn straight_pairs_keep_exact_endpoints() {
        let anchors = vec![PathAnchor::corner(0.0, 0.0), PathAnchor::corner(100.0, 0.0)];
        assert_eq!(
            flatten_anchors(&anchors, false),
            vec![[0.0, 0.0], [100.0, 0.0]]
        );
    }

    #[test]
    fn empty_anchors_flatten_to_nothing() {
        assert!(flatten_anchors(&[], false).is_empty());
        // A single anchor seeds one point (TS pushes `segments[0]` first).
        assert_eq!(
            flatten_anchors(&[PathAnchor::corner(5.0, 5.0)], false),
            vec![[5.0, 5.0]]
        );
    }

    #[test]
    fn curved_pairs_sample_ten_points_ending_on_anchor() {
        // shapes.test.ts p5: (0,0) out (50,0) → (100,0) in (0,50) relative;
        // in absolute form the handles sit at (50,0) and (100,50).
        let anchors = vec![
            PathAnchor {
                point: [0.0, 0.0],
                handle_in: None,
                handle_out: Some([50.0, 0.0]),
            },
            PathAnchor {
                point: [100.0, 0.0],
                handle_in: Some([100.0, 50.0]),
                handle_out: None,
            },
        ];
        let flat = flatten_anchors(&anchors, false);
        assert_eq!(flat.len(), 1 + FLATTEN_SAMPLES);
        let last = flat[flat.len() - 1];
        assert!(approx_eq(last[0], 100.0, 1e-9) && approx_eq(last[1], 0.0, 1e-9));
        // The curve bulges downward (positive y) mid-span.
        assert!(flat.iter().any(|p| p[1] > 5.0));
    }

    #[test]
    fn closed_paths_flatten_the_closing_segment() {
        let square = vec![
            PathAnchor::corner(0.0, 0.0),
            PathAnchor::corner(100.0, 0.0),
            PathAnchor::corner(100.0, 100.0),
            PathAnchor::corner(0.0, 100.0),
        ];
        let flat = flatten_anchors(&square, true);
        assert_eq!(flat.len(), 5);
        assert_eq!(flat[flat.len() - 1], [0.0, 0.0]);
    }
}
