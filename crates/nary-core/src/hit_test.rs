//! Element hit-testing dispatch, z-order top-hit, and bounds queries.
//!
//! TS sources: `hitTestElement` / `getElementBounds` dispatch in
//! `packages/core/src/shapes/index.ts` (registry dispatch with a raw-box
//! fallback); per-shape tests in `shapes.ts` (`rectangle`, `ellipse`,
//! `line`, `freedraw`, `path`), `text.test.ts`, and the remediation
//! hit-testing slice (closed-path interior with transparent stroke,
//! arrowhead tip, rotation-aware image bounds); selection-side ordering in
//! `packages/core/src/interaction/selection.ts` (`hitTest` top-wins,
//! `queryElementsInBounds`, `boundsOverlap` inclusive-touch).
//!
//! The pure math lives in `nary-geometry` (`segment`, `hit`, `path`,
//! `rotation`, `transform`); this module binds it to [`Element`] — one
//! bounds function and one hit function per shape, shared by interaction
//! and rendering (no duplicated geometry).
//!
//! ## Preserved distinctions
//!
//! Freedraw hit-tests the **raw chords** while rendering draws smoothed
//! quadratic midpoints (known TS render-vs-hit quirk, preserved so pinned
//! vertex-hit behavior holds). Frames ignore rotation in both bounds and
//! hit (preserved TS `getFrameBounds` / `hitTestFrame` gap). Instances hit
//! the raw unrotated box (TS has no `instance` shape registration, so
//! dispatch falls back to the raw box). Line/arrow/freedraw/path
//! inverse-rotate about the **rotated-bounds center** (exactly what TS
//! `getLineBounds`-style calls return at both the render and hit sites, so
//! both agree vertex-for-vertex; for centrally-symmetric point sets this
//! equals the local-box center).

use crate::document::Document;
use crate::element::{Element, ElementId};
use crate::geometry::hit::{point_in_arrowhead, point_in_ellipse};
use crate::geometry::path::{flatten_anchors, PathAnchor};
use crate::geometry::point::Point;
use crate::geometry::rect::Bounds;
use crate::geometry::rotation::to_local_space;
use crate::geometry::segment::{point_in_polygon, polyline_hits_stroke};
use crate::geometry::transform::stroke_hit_threshold;

// ---------------------------------------------------------------------------
// Per-element dispatch (TS `hitTestElement`)
// ---------------------------------------------------------------------------

/// Hit-tests a world-space point against one element.
///
/// Ports TS `hitTestElement` with the registry already resolved (the Rust
/// `Element` union is closed): every known type dispatches to its shape
/// its shape rule; unknown/future shapes cannot occur, so the TS raw-box
/// fallback survives only as the documented `Instance` rule below.
pub fn hit_test_element(element: &Element, px: f64, py: f64) -> bool {
    match element {
        Element::Rectangle(el) => {
            let base = &el.base;
            let local = to_local_space(
                px,
                py,
                base.x + base.width / 2.0,
                base.y + base.height / 2.0,
                base.rotation,
            );
            local[0] >= base.x
                && local[0] <= base.x + base.width
                && local[1] >= base.y
                && local[1] <= base.y + base.height
        }
        Element::Ellipse(el) => {
            let base = &el.base;
            let cx = base.x + base.width / 2.0;
            let cy = base.y + base.height / 2.0;
            let local = to_local_space(px, py, cx, cy, base.rotation);
            point_in_ellipse(
                local[0],
                local[1],
                cx,
                cy,
                base.width / 2.0,
                base.height / 2.0,
            )
        }
        Element::Text(el) => {
            let base = &el.base;
            let local = to_local_space(
                px,
                py,
                base.x + base.width / 2.0,
                base.y + base.height / 2.0,
                base.rotation,
            );
            local[0] >= base.x
                && local[0] <= base.x + base.width
                && local[1] >= base.y
                && local[1] <= base.y + base.height
        }
        Element::Image(el) => {
            let base = &el.base;
            let local = to_local_space(
                px,
                py,
                base.x + base.width / 2.0,
                base.y + base.height / 2.0,
                base.rotation,
            );
            local[0] >= base.x
                && local[0] <= base.x + base.width
                && local[1] >= base.y
                && local[1] <= base.y + base.height
        }
        Element::Frame(el) => {
            // Rotation-ignoring plain box (preserved TS quirk).
            let base = &el.base;
            px >= base.x && px <= base.x + base.width && py >= base.y && py <= base.y + base.height
        }
        Element::Instance(el) => {
            // Raw-box fallback (preserved: TS never registers `instance`).
            let base = &el.base;
            px >= base.x && px <= base.x + base.width && py >= base.y && py <= base.y + base.height
        }
        Element::Line(el) => {
            if el.points.len() < 2 {
                return false;
            }
            let base = &el.base;
            let center = element.bounds().center();
            let local = to_local_space(px, py, center[0], center[1], base.rotation);
            let absolute: Vec<Point> = el
                .points
                .iter()
                .map(|p| [base.x + p[0], base.y + p[1]])
                .collect();
            polyline_hits_stroke(&local, &absolute, stroke_hit_threshold(base.stroke_width))
        }
        Element::Arrow(el) => {
            if el.points.len() < 2 {
                return false;
            }
            let base = &el.base;
            let center = element.bounds().center();
            let local = to_local_space(px, py, center[0], center[1], base.rotation);
            let absolute: Vec<Point> = el
                .points
                .iter()
                .map(|p| [base.x + p[0], base.y + p[1]])
                .collect();
            if polyline_hits_stroke(&local, &absolute, stroke_hit_threshold(base.stroke_width)) {
                return true;
            }
            // Rendered heads are hittable geometry (TS arrowhead branch).
            if el.end_arrowhead.is_some() && el.points.len() >= 2 {
                let n = el.points.len();
                let from = [base.x + el.points[n - 2][0], base.y + el.points[n - 2][1]];
                let tip = [base.x + el.points[n - 1][0], base.y + el.points[n - 1][1]];
                if point_in_arrowhead(local[0], local[1], &from, &tip, base.stroke_width) {
                    return true;
                }
            }
            if el.start_arrowhead.is_some() && el.points.len() >= 2 {
                let from = [base.x + el.points[1][0], base.y + el.points[1][1]];
                let tip = [base.x + el.points[0][0], base.y + el.points[0][1]];
                if point_in_arrowhead(local[0], local[1], &from, &tip, base.stroke_width) {
                    return true;
                }
            }
            false
        }
        Element::Freedraw(el) => {
            if el.points.len() < 2 {
                return false;
            }
            let base = &el.base;
            let center = element.bounds().center();
            let local = to_local_space(px, py, center[0], center[1], base.rotation);
            // Raw chords, NOT the smoothed render curve (preserved quirk).
            let absolute: Vec<Point> = el
                .points
                .iter()
                .map(|p| [base.x + p[0], base.y + p[1]])
                .collect();
            polyline_hits_stroke(&local, &absolute, stroke_hit_threshold(base.stroke_width))
        }
        Element::Path(el) => {
            if el.segments.len() < 2 {
                return false;
            }
            let base = &el.base;
            let center = element.bounds().center();
            let local = to_local_space(px, py, center[0], center[1], base.rotation);
            let anchors: Vec<PathAnchor> = el
                .segments
                .iter()
                .map(|seg| {
                    let ax = base.x + seg.point[0];
                    let ay = base.y + seg.point[1];
                    PathAnchor {
                        point: [ax, ay],
                        handle_in: seg.handle_in.map(|h| [ax + h[0], ay + h[1]]),
                        handle_out: seg.handle_out.map(|h| [ax + h[0], ay + h[1]]),
                    }
                })
                .collect();
            let polyline = flatten_anchors(&anchors, el.closed);
            if el.closed && has_fill(base) && point_in_polygon(local[0], local[1], &polyline) {
                return true;
            }
            polyline_hits_stroke(&local, &polyline, stroke_hit_threshold(base.stroke_width))
        }
        Element::Custom(el) => {
            // Custom shapes hit-test through their ShapeExtension when
            // registered; fallback is the raw box.
            let base = &el.base;
            px >= base.x && px <= base.x + base.width && py >= base.y && py <= base.y + base.height
        }
    }
}

/// Returns `true` when the element's fill paints (i.e. it is not a solid
/// `"transparent"`). Closed paths with fill hit by interior even with a
/// transparent stroke (remediation pin; consistent with rect/ellipse).
fn has_fill(base: &crate::element::BaseElement) -> bool {
    !matches!(
        &base.background_color,
        crate::element::FillStyle::Solid { color } if color == "transparent"
    )
}

// ---------------------------------------------------------------------------
// Z-order hit-testing (TS `SelectionManager.hitTest` top-wins)
// ---------------------------------------------------------------------------

/// What the top-hit search skips.
///
/// Mirrors TS `SelectionManager.hitTest` filters: deleted, locked, and
/// hidden elements never win a click. Kept as a struct (not bare bools)
/// so call sites read as intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HitTestFilter {
    /// Skip soft-deleted tombstones (always on in practice).
    pub skip_deleted: bool,
    /// Skip locked elements (selection clicks pass through them).
    pub skip_locked: bool,
    /// Skip hidden elements.
    pub skip_hidden: bool,
}

impl HitTestFilter {
    /// Selection-click semantics: skip deleted, locked, and hidden.
    pub fn selection() -> Self {
        Self {
            skip_deleted: true,
            skip_locked: true,
            skip_hidden: true,
        }
    }
}

impl Default for HitTestFilter {
    fn default() -> Self {
        Self::selection()
    }
}

/// Topmost element under a world-space point, or `None`.
///
/// Ports TS `SelectionManager.hitTest` ordering: candidates walk
/// back-to-front (last in z-order wins — "if an object is visually on top,
/// hit testing selects it") with the [`HitTestFilter::selection`] skips.
/// Group-aware expansion (click a member → outermost group) is editor-layer
/// logic; this returns the hit element itself, deterministically.
///
/// Linear scan (exact reference implementation). For large scenes prefer
/// [`hit_test_top_indexed`], which routes through the document's spatial
/// index and returns identical results.
pub fn hit_test_top(
    document: &Document,
    px: f64,
    py: f64,
    filter: HitTestFilter,
) -> Option<ElementId> {
    hit_test_all(document, px, py, filter).into_iter().next()
}

/// Every element under a world-space point, top-first (z-order descending).
///
/// Same filters and order as [`hit_test_top`]; useful for stacked-hit
/// tests and cycling.
pub fn hit_test_all(
    document: &Document,
    px: f64,
    py: f64,
    filter: HitTestFilter,
) -> Vec<ElementId> {
    let mut hits = Vec::new();
    for id in document.order().iter().rev() {
        let Some(element) = document.get(id.as_str()) else {
            continue;
        };
        let base = element.base();
        if filter.skip_deleted && base.is_deleted {
            continue;
        }
        if filter.skip_locked && base.locked {
            continue;
        }
        if filter.skip_hidden && base.hidden {
            continue;
        }
        if hit_test_element(element, px, py) {
            hits.push(id.clone());
        }
    }
    hits
}

/// Topmost element under a world-space point via the document's spatial
/// index, or `None`.
///
/// Same contract as [`hit_test_top`]: candidates come from the grid,
/// pre-sorted back-to-front by z-order rank
/// ([`Document::ranked_candidates`]), then the first exact
/// [`hit_test_element`] hit wins after the [`HitTestFilter`] skips. The
/// grid never yields false negatives, so membership matches the linear scan
/// exactly — only the candidate set is smaller. Non-finite points hit
/// nothing (mirrors the linear scan, whose comparisons are all false there,
/// and keeps degenerate grid probes out).
pub fn hit_test_top_indexed(
    document: &Document,
    px: f64,
    py: f64,
    filter: HitTestFilter,
) -> Option<ElementId> {
    if !px.is_finite() || !py.is_finite() {
        return None;
    }
    let probe = Bounds::point(px, py);
    for id in document.ranked_candidates(&probe) {
        let Some(element) = document.get(id.as_str()) else {
            continue;
        };
        let base = element.base();
        if filter.skip_deleted && base.is_deleted {
            continue;
        }
        if filter.skip_locked && base.locked {
            continue;
        }
        if filter.skip_hidden && base.hidden {
            continue;
        }
        if hit_test_element(element, px, py) {
            return Some(id);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Bounds queries (TS `queryElementsInBounds`, `computeSelectionBounds`)
// ---------------------------------------------------------------------------

/// Ids whose bounds inclusively overlap `bounds` (touching counts).
///
/// Ports TS `queryElementsInBounds` minus the grid: deleted and hidden
/// elements are excluded, overlap is [`Bounds::intersects`]
/// (inclusive-touch, pinned by `selection.test.ts`). Results come back in
/// z-order for determinism — unlike the TS grid-cell order, with identical
/// membership.
pub fn query_in_bounds(document: &Document, bounds: &Bounds) -> Vec<ElementId> {
    let mut result = Vec::new();
    for id in document.order() {
        let Some(element) = document.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted || element.base().hidden {
            continue;
        }
        if bounds.intersects(&element.bounds()) {
            result.push(id);
        }
    }
    result
}

/// Ids whose bounds inclusively overlap `bounds` via the document's spatial
/// index, in z-order.
///
/// Same contract as [`query_in_bounds`]: deleted and hidden elements are
/// excluded, overlap is inclusive-touch. Ranked candidates
/// ([`Document::ranked_candidates`]) arrive front-to-back, so the filter
/// below reverses into z-order. Non-finite bounds match nothing.
pub fn query_in_bounds_indexed(document: &Document, bounds: &Bounds) -> Vec<ElementId> {
    if !bounds.is_finite() {
        return Vec::new();
    }
    let mut result = Vec::new();
    for id in document.ranked_candidates(bounds).into_iter().rev() {
        let Some(element) = document.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted || element.base().hidden {
            continue;
        }
        if bounds.intersects(&element.bounds()) {
            result.push(id);
        }
    }
    result
}
/// Combined bounds of `ids` (union of element bounds), or `None` when no
/// id resolves to a stored element.
///
/// Ports TS `computeSelectionBounds` (missing ids skipped, not errors).
pub fn combined_bounds(document: &Document, ids: &[ElementId]) -> Option<Bounds> {
    let mut acc: Option<Bounds> = None;
    for id in ids {
        if let Some(element) = document.get(id.as_str()) {
            let bounds = element.bounds();
            acc = Some(match acc {
                Some(current) => current.union(&bounds),
                None => bounds,
            });
        }
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::CounterIdGenerator;

    // Minimal base builder for hit-shape unit tests (factories live in
    // `element.rs`; this keeps field lists local to the test).
    fn rect_base(
        gen: &mut CounterIdGenerator,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> crate::element::BaseElement {
        let mut el = crate::element::create_rectangle(gen);
        el.base.x = x;
        el.base.y = y;
        el.base.width = w;
        el.base.height = h;
        el.base
    }

    #[test]
    fn rectangle_hits_edges_and_rejects_outside_corner() {
        let mut gen = CounterIdGenerator::new();
        let el = Element::Rectangle(crate::element::RectangleElement {
            base: rect_base(&mut gen, 10.0, 20.0, 100.0, 80.0),
            roundness: None,
            corners: None,
        });
        assert!(hit_test_element(&el, 50.0, 50.0));
        assert!(hit_test_element(&el, 10.0, 50.0));
        assert!(!hit_test_element(&el, 200.0, 200.0));
        assert!(!hit_test_element(&el, 9.0, 19.0));
    }
}
