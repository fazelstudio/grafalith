//! Arrow endpoint binding (perimeter focus + follow-on-move).
//!
//! TS source: `packages/core/src/interaction/arrow-binding.ts`
//! (`BINDING_THRESHOLD = 20`; focus `[0, 1)` wrap; attachment inverse;
//! gap — pinned by `arrow-binding.test.ts`).
//!
//! Follow-on-move is routed through [`CommandContext`], never through hidden
//! `afterUpsert` side paths: [`update_bound_arrows`] is the single entry
//! point hosts call after a bound target moves, resizes, or is deleted, and
//! [`FollowBoundElement`] wraps it as an undoable [`Command`].

use crate::command::{Command, CommandContext, CommandOutcome};
use crate::document::Document;
use crate::element::{Binding, Element, ElementId};
use crate::geometry::point::Point;
use crate::geometry::rect::Bounds;
use crate::EngineResult;

/// Minimum distance (in scene units) from an arrow endpoint to an element for
/// binding to trigger.
///
/// Ports TS `BINDING_THRESHOLD`.
pub const BINDING_THRESHOLD: f64 = 20.0;

/// Distance from a point to the nearest edge of a bounding box.
///
/// Returns `0` when the point is inside the box (edges inclusive). Exact port
/// of TS `distanceToBounds`. Non-finite points yield `INFINITY` (never bind)
/// instead of the TS `NaN`, so callers can compare without a NaN guard.
pub fn distance_to_bounds(point: Point, bounds: &Bounds) -> f64 {
    if !point[0].is_finite() || !point[1].is_finite() {
        return f64::INFINITY;
    }
    if bounds.contains_point(point[0], point[1]) {
        return 0.0;
    }
    let dx = (bounds.min_x - point[0])
        .max(0.0)
        .max(point[0] - bounds.max_x);
    let dy = (bounds.min_y - point[1])
        .max(0.0)
        .max(point[1] - bounds.max_y);
    dx.hypot(dy)
}

/// Focus in `[0, 1)`: relative position along the bounds perimeter, clockwise
/// from the top-left corner (top edge, then right, bottom, left).
///
/// Exact port of TS `calculateFocus`, including the closest-edge tie-break
/// priority (top wins, then right, bottom, left). Two intentional
/// hardenings, both no-ops for non-degenerate boxes: a zero perimeter
/// returns `0`, and a zero-width/height edge contributes `0` instead of
/// dividing by zero (`NaN` in TS).
pub fn calculate_focus(point: Point, bounds: &Bounds) -> f64 {
    let w = bounds.max_x - bounds.min_x;
    let h = bounds.max_y - bounds.min_y;
    let perimeter = 2.0 * (w + h);
    if perimeter == 0.0 {
        return 0.0;
    }
    let px = point[0];
    let py = point[1];

    // Closest point per edge, written as max/min chains (exactly TS
    // `Math.max`/`Math.min`) so inverted boxes cannot panic the way
    // `clamp` would.
    let top_closest_x = px.min(bounds.max_x).max(bounds.min_x);
    let top_dist_sq = (px - top_closest_x).powi(2) + (py - bounds.min_y).powi(2);

    let right_closest_y = py.min(bounds.max_y).max(bounds.min_y);
    let right_dist_sq = (px - bounds.max_x).powi(2) + (py - right_closest_y).powi(2);

    let bottom_closest_x = px.min(bounds.max_x).max(bounds.min_x);
    let bottom_dist_sq = (px - bottom_closest_x).powi(2) + (py - bounds.max_y).powi(2);

    let left_closest_y = py.min(bounds.max_y).max(bounds.min_y);
    let left_dist_sq = (px - bounds.min_x).powi(2) + (py - left_closest_y).powi(2);

    let min_dist_sq = top_dist_sq
        .min(right_dist_sq)
        .min(bottom_dist_sq)
        .min(left_dist_sq);
    if min_dist_sq == top_dist_sq {
        let t = if w > 0.0 {
            (top_closest_x - bounds.min_x) / w
        } else {
            0.0
        };
        t * (w / perimeter)
    } else if min_dist_sq == right_dist_sq {
        let t = if h > 0.0 {
            (right_closest_y - bounds.min_y) / h
        } else {
            0.0
        };
        (w + t * h) / perimeter
    } else if min_dist_sq == bottom_dist_sq {
        let t = if w > 0.0 {
            (bounds.max_x - bottom_closest_x) / w
        } else {
            0.0
        };
        (w + h + t * w) / perimeter
    } else {
        let t = if h > 0.0 {
            (bounds.max_y - left_closest_y) / h
        } else {
            0.0
        };
        (2.0 * w + h + t * h) / perimeter
    }
}

/// Attachment point on the bounds perimeter for a focus value.
///
/// Exact port of TS `calculateAttachmentPoint`, including the
/// `((focus % 1) + 1) % 1` wrap for out-of-range focuses. A zero perimeter
/// collapses to the top-left corner (TS parity).
pub fn calculate_attachment_point(focus: f64, bounds: &Bounds) -> Point {
    let w = bounds.max_x - bounds.min_x;
    let h = bounds.max_y - bounds.min_y;
    let perimeter = 2.0 * (w + h);
    if perimeter == 0.0 {
        return [bounds.min_x, bounds.min_y];
    }
    let dist = ((focus % 1.0) + 1.0) % 1.0 * perimeter;
    if dist <= w {
        [bounds.min_x + dist, bounds.min_y]
    } else if dist <= w + h {
        [bounds.max_x, bounds.min_y + (dist - w)]
    } else if dist <= 2.0 * w + h {
        [bounds.max_x - (dist - w - h), bounds.max_y]
    } else {
        [bounds.min_x, bounds.max_y - (dist - 2.0 * w - h)]
    }
}

/// Gap between a point and the bounds edge (endpoint-to-perimeter distance).
///
/// Ports TS `calculateGap`: a `distance_to_bounds` alias kept as a named
/// concept so bind call sites read as intent.
pub fn calculate_gap(point: Point, bounds: &Bounds) -> f64 {
    distance_to_bounds(point, bounds)
}

/// Nearest bindable element to a point, excluding one id.
///
/// Skips soft-deleted elements and arrows (arrows never bind to arrows, TS
/// parity) and applies the [`BINDING_THRESHOLD`] cutoff (inclusive).
/// Returns the target id and the edge distance.
pub fn find_nearest_element(
    doc: &Document,
    point: Point,
    exclude: &ElementId,
) -> Option<(ElementId, f64)> {
    let mut nearest: Option<(ElementId, f64)> = None;
    for element in doc.get_all_including_deleted() {
        if element.id() == exclude || element.base().is_deleted {
            continue;
        }
        if matches!(element, Element::Arrow(_)) {
            continue;
        }
        let dist = distance_to_bounds(point, &element.bounds());
        if dist <= BINDING_THRESHOLD {
            let better = nearest.as_ref().is_none_or(|(_, best)| dist < *best);
            if better {
                nearest = Some((element.id().clone(), dist));
            }
        }
    }
    nearest
}

/// Binding for an arrow endpoint placed at a point, or `None` when no
/// bindable element is within threshold.
///
/// Ports TS `tryBindEndpoint`: the nearest element supplies the target id,
/// with `focus`/`gap` measured against its bounds. `exclude` is the arrow's
/// own id (an arrow never binds to itself).
pub fn try_bind_endpoint(doc: &Document, point: Point, exclude: &ElementId) -> Option<Binding> {
    let (target_id, _) = find_nearest_element(doc, point, exclude)?;
    let target = doc.get(target_id.as_str())?;
    let bounds = target.bounds();
    Some(Binding {
        element_id: target_id,
        focus: calculate_focus(point, &bounds),
        gap: calculate_gap(point, &bounds),
    })
}

/// Resolves a bound endpoint in scene coordinates: the perimeter attachment
/// pushed outward from the bounds center by the stored gap.
///
/// Ports the TS per-endpoint math in `updateBoundArrows`. A zero-length
/// center-to-attachment vector (degenerate box) falls back to the attachment
/// itself instead of dividing by zero.
fn resolve_endpoint(attach: Point, center: Point, gap: f64) -> Point {
    let dx = attach[0] - center[0];
    let dy = attach[1] - center[1];
    let len = dx.hypot(dy);
    if len > 0.0 {
        [attach[0] + dx / len * gap, attach[1] + dy / len * gap]
    } else {
        attach
    }
}

/// Moves bound arrow endpoints after a target moved or resized; clears every
/// binding that names the target when it is missing or deleted (those arrows
/// become floating).
///
/// Ports TS `updateBoundArrows` through [`CommandContext`] (version bumps
/// stay owned by [`Document`]): rewritten endpoints are stored in
/// arrow-relative coordinates (`endpoint - arrow.x/y`, TS parity) with the
/// gap pushed outward from the target center. Deleted arrows are skipped, as
/// in TS. Reports a no-op outcome when nothing binds the target, so callers
/// record no history entry for it.
pub fn update_bound_arrows(
    ctx: &mut CommandContext,
    moved_id: &ElementId,
) -> EngineResult<CommandOutcome> {
    let target = ctx.doc().get(moved_id.as_str()).cloned();
    let Some(target) = target else {
        return clear_bindings_for_element(ctx, moved_id);
    };
    if target.base().is_deleted {
        return clear_bindings_for_element(ctx, moved_id);
    }
    let bounds = target.bounds();
    let center = bounds.center();

    // Collect affected arrows first (reads only; only matching arrows are
    // cloned) — storing waits until the document borrow ends.
    let mut pending: Vec<Element> = Vec::new();
    for element in ctx.doc().get_all_including_deleted() {
        let Element::Arrow(arrow) = element else {
            continue;
        };
        if arrow.base.is_deleted {
            continue;
        }
        let follow_start = arrow
            .start_binding
            .as_ref()
            .is_some_and(|binding| binding.element_id == *moved_id);
        let follow_end = arrow
            .end_binding
            .as_ref()
            .is_some_and(|binding| binding.element_id == *moved_id);
        if !follow_start && !follow_end {
            continue;
        }
        let mut next = element.clone();
        if let Element::Arrow(next_arrow) = &mut next {
            let origin = [next_arrow.base.x, next_arrow.base.y];
            let mut points = std::mem::take(&mut next_arrow.points);
            if follow_start {
                if let Some(binding) = &next_arrow.start_binding {
                    let attach = calculate_attachment_point(binding.focus, &bounds);
                    let endpoint = resolve_endpoint(attach, center, binding.gap);
                    let relative = [endpoint[0] - origin[0], endpoint[1] - origin[1]];
                    if points.is_empty() {
                        points.push(relative);
                    } else {
                        points[0] = relative;
                    }
                }
            }
            if follow_end {
                if let Some(binding) = &next_arrow.end_binding {
                    let attach = calculate_attachment_point(binding.focus, &bounds);
                    let endpoint = resolve_endpoint(attach, center, binding.gap);
                    let relative = [endpoint[0] - origin[0], endpoint[1] - origin[1]];
                    if points.is_empty() {
                        points.push(relative);
                    } else {
                        let last = points.len() - 1;
                        points[last] = relative;
                    }
                }
            }
            next_arrow.points = points;
        }
        pending.push(next);
    }

    // Store the collected arrows (Document performs the authoritative
    // version bump).
    let mut affected = Vec::with_capacity(pending.len());
    for next in pending {
        affected.push(next.id().clone());
        ctx.upsert(next)?;
    }
    let changed = !affected.is_empty();
    Ok(CommandOutcome { affected, changed })
}

/// Batched [`update_bound_arrows`] over many moved/deleted ids with a single
/// document scan, so mass operations stay O(n) instead of O(n²).
///
/// Semantics match sequential per-id calls: endpoints bound to a live moved
/// target are rewritten from that target's current bounds; endpoints bound
/// to a missing/deleted target are cleared (floating arrows). Each affected
/// arrow is stored once even when both endpoints follow moved targets.
/// Reported `affected` ids come in z-order rather than per-moved-id order.
pub fn update_bound_arrows_many(
    ctx: &mut CommandContext,
    moved_ids: &[ElementId],
) -> EngineResult<CommandOutcome> {
    use std::collections::HashSet;

    if moved_ids.is_empty() {
        return Ok(CommandOutcome {
            affected: Vec::new(),
            changed: false,
        });
    }
    let moved: HashSet<&ElementId> = moved_ids.iter().collect();

    // Collect affected arrows first (reads only) — storing waits until
    // the document borrow ends.
    let mut pending: Vec<Element> = Vec::new();
    for element in ctx.doc().get_all_including_deleted() {
        let Element::Arrow(arrow) = element else {
            continue;
        };
        if arrow.base.is_deleted {
            continue;
        }
        // Decide per endpoint from shared borrows only: follow live moved
        // targets, clear missing/deleted ones (mirrors
        // `clear_bindings_for_element`).
        let mut start_follow: Option<(Bounds, f64, f64)> = None;
        let mut start_clear = false;
        let mut end_follow: Option<(Bounds, f64, f64)> = None;
        let mut end_clear = false;
        for (binding, is_start) in [(&arrow.start_binding, true), (&arrow.end_binding, false)] {
            let Some(binding) = binding else {
                continue;
            };
            if !moved.contains(&binding.element_id) {
                continue;
            }
            let action = match ctx.doc().get(binding.element_id.as_str()) {
                Some(target) if !target.base().is_deleted => {
                    let bounds = target.bounds();
                    Some((bounds, binding.focus, binding.gap))
                }
                _ => None,
            };
            if is_start {
                match action {
                    Some(follow) => start_follow = Some(follow),
                    None => start_clear = true,
                }
            } else {
                match action {
                    Some(follow) => end_follow = Some(follow),
                    None => end_clear = true,
                }
            }
        }
        if start_follow.is_none() && !start_clear && end_follow.is_none() && !end_clear {
            continue;
        }
        let mut next = element.clone();
        let Element::Arrow(next_arrow) = &mut next else {
            continue;
        };
        let origin = [next_arrow.base.x, next_arrow.base.y];
        let mut points = std::mem::take(&mut next_arrow.points);
        if let Some((bounds, focus, gap)) = start_follow {
            let center = bounds.center();
            let attach = calculate_attachment_point(focus, &bounds);
            let endpoint = resolve_endpoint(attach, center, gap);
            let relative = [endpoint[0] - origin[0], endpoint[1] - origin[1]];
            if points.is_empty() {
                points.push(relative);
            } else {
                points[0] = relative;
            }
        } else if start_clear {
            next_arrow.start_binding = None;
        }
        if let Some((bounds, focus, gap)) = end_follow {
            let center = bounds.center();
            let attach = calculate_attachment_point(focus, &bounds);
            let endpoint = resolve_endpoint(attach, center, gap);
            let relative = [endpoint[0] - origin[0], endpoint[1] - origin[1]];
            if points.is_empty() {
                points.push(relative);
            } else {
                let last = points.len() - 1;
                points[last] = relative;
            }
        } else if end_clear {
            next_arrow.end_binding = None;
        }
        next_arrow.points = points;
        pending.push(next);
    }

    // Store the collected arrows (Document performs the authoritative
    // version bump).
    let mut affected = Vec::with_capacity(pending.len());
    for next in pending {
        affected.push(next.id().clone());
        ctx.upsert(next)?;
    }
    let changed = !affected.is_empty();
    Ok(CommandOutcome { affected, changed })
}

/// Clears every start/end binding that names `deleted_id` (arrows become
/// floating).
///
/// Ports TS `clearBindingsForElement`, including the skip of deleted arrows.
/// Reached from [`update_bound_arrows`] when the target is missing or
/// soft-deleted.
fn clear_bindings_for_element(
    ctx: &mut CommandContext,
    deleted_id: &ElementId,
) -> EngineResult<CommandOutcome> {
    let mut pending: Vec<Element> = Vec::new();
    for element in ctx.doc().get_all_including_deleted() {
        let Element::Arrow(arrow) = element else {
            continue;
        };
        if arrow.base.is_deleted {
            continue;
        }
        let clear_start = arrow
            .start_binding
            .as_ref()
            .is_some_and(|binding| binding.element_id == *deleted_id);
        let clear_end = arrow
            .end_binding
            .as_ref()
            .is_some_and(|binding| binding.element_id == *deleted_id);
        if !clear_start && !clear_end {
            continue;
        }
        let mut next = element.clone();
        if let Element::Arrow(next_arrow) = &mut next {
            if clear_start {
                next_arrow.start_binding = None;
            }
            if clear_end {
                next_arrow.end_binding = None;
            }
        }
        pending.push(next);
    }
    let mut affected = Vec::with_capacity(pending.len());
    for next in pending {
        affected.push(next.id().clone());
        ctx.upsert(next)?;
    }
    let changed = !affected.is_empty();
    Ok(CommandOutcome { affected, changed })
}

/// Follows a moved, resized, or deleted element: bound arrow endpoints track
/// it, or float when the target is gone.
///
/// [`Command`] wrapper around [`update_bound_arrows`] so a follow pass
/// collapses into one undoable history entry (and records nothing when no
/// arrow binds the target).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FollowBoundElement {
    /// Id of the moved, resized, or deleted target to follow.
    pub moved_id: ElementId,
}

impl FollowBoundElement {
    /// Builds the follow command for the given target id.
    pub fn new(moved_id: ElementId) -> Self {
        Self { moved_id }
    }
}

impl Command for FollowBoundElement {
    fn label(&self) -> &str {
        "follow-bindings"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        update_bound_arrows(ctx, &self.moved_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::{create_arrow, create_rectangle, CounterIdGenerator};
    use crate::geometry::point::approx_eq;

    fn box_100() -> Bounds {
        Bounds::new(100.0, 100.0, 200.0, 200.0)
    }

    fn test_rect(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        rect.base.x = x;
        rect.base.y = y;
        rect.base.width = 100.0;
        rect.base.height = 100.0;
        Element::Rectangle(rect)
    }

    fn test_arrow(
        gen: &mut CounterIdGenerator,
        id: &str,
        x: f64,
        y: f64,
        points: Vec<Point>,
        start: Option<Binding>,
        end: Option<Binding>,
    ) -> Element {
        let mut arrow = create_arrow(gen);
        arrow.base.id = ElementId::of(id);
        arrow.base.x = x;
        arrow.base.y = y;
        arrow.points = points;
        arrow.start_binding = start;
        arrow.end_binding = end;
        Element::Arrow(arrow)
    }

    fn binding_to(target: &str, focus: f64, gap: f64) -> Binding {
        Binding {
            element_id: ElementId::of(target),
            focus,
            gap,
        }
    }

    #[test]
    fn distance_is_zero_inside_and_exact_outside() {
        let bounds = box_100();
        assert_eq!(distance_to_bounds([150.0, 150.0], &bounds), 0.0);
        assert_eq!(distance_to_bounds([100.0, 150.0], &bounds), 0.0);
        assert_eq!(distance_to_bounds([80.0, 150.0], &bounds), 20.0);
        assert_eq!(distance_to_bounds([220.0, 150.0], &bounds), 20.0);
        assert_eq!(distance_to_bounds([150.0, 80.0], &bounds), 20.0);
        assert_eq!(distance_to_bounds([150.0, 220.0], &bounds), 20.0);
        assert!(approx_eq(
            distance_to_bounds([80.0, 80.0], &bounds),
            800.0f64.sqrt(),
            1e-9
        ));
        assert_eq!(calculate_gap([150.0, 250.0], &bounds), 50.0);
    }

    #[test]
    fn focus_on_top_edge_matches_perimeter_fraction() {
        // 100x100 box: perimeter is 400.
        let bounds = box_100();
        assert!(approx_eq(
            calculate_focus([100.0, 100.0], &bounds),
            0.0,
            1e-9
        ));
        assert!(approx_eq(
            calculate_focus([150.0, 100.0], &bounds),
            0.125,
            1e-9
        ));
        assert!(approx_eq(
            calculate_focus([200.0, 100.0], &bounds),
            0.25,
            1e-9
        ));
        assert!(approx_eq(
            calculate_focus([200.0, 150.0], &bounds),
            0.375,
            1e-9
        ));
        assert!(approx_eq(
            calculate_focus([200.0, 200.0], &bounds),
            0.5,
            1e-9
        ));
        assert!(approx_eq(
            calculate_focus([100.0, 200.0], &bounds),
            0.75,
            1e-9
        ));
        // Degenerate box never yields NaN.
        let dot = Bounds::point(50.0, 50.0);
        assert_eq!(calculate_focus([50.0, 50.0], &dot), 0.0);
        assert_eq!(calculate_attachment_point(0.3, &dot), [50.0, 50.0]);
    }

    #[test]
    fn attachment_round_trip_is_stable() {
        let bounds = box_100();
        for focus in [
            0.0, 0.0625, 0.125, 0.25, 0.3125, 0.375, 0.5, 0.625, 0.7, 0.75, 0.875, 0.9375,
        ] {
            let point = calculate_attachment_point(focus, &bounds);
            assert_eq!(
                distance_to_bounds(point, &bounds),
                0.0,
                "focus {focus} must attach on the perimeter, got {point:?}"
            );
            let back = calculate_focus(point, &bounds);
            let expected = ((focus % 1.0) + 1.0) % 1.0;
            assert!(
                (back - expected).abs() < 1e-9,
                "focus {focus} -> {point:?} -> {back}"
            );
        }
        // Wrap: 1.25 behaves like 0.25 (top-right corner).
        let wrapped = calculate_attachment_point(1.25, &bounds);
        assert!(approx_eq(wrapped[0], 200.0, 1e-9));
        assert!(approx_eq(wrapped[1], 100.0, 1e-9));
    }

    #[test]
    fn try_bind_respects_threshold_and_skips_arrows_and_excluded() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(test_rect(&mut gen, "rect-1", 100.0, 100.0))
            .unwrap();
        // Decoy arrow sitting closer to the probe point than the rect: its
        // bounds (145..155, 90..100) contain the probe, so skipping arrows is
        // what keeps the rect the winner.
        doc.upsert(test_arrow(
            &mut gen,
            "arrow-1",
            145.0,
            90.0,
            vec![[0.0, 0.0], [10.0, 10.0]],
            None,
            None,
        ))
        .unwrap();

        let probe = [150.0, 95.0];
        let (_, dist) = find_nearest_element(&doc, probe, &ElementId::of("arrow-1")).unwrap();
        assert!((dist - 5.0).abs() < 1e-9);

        let binding = try_bind_endpoint(&doc, probe, &ElementId::of("arrow-1")).unwrap();
        assert_eq!(binding.element_id, ElementId::of("rect-1"));
        assert!((binding.gap - 5.0).abs() < 1e-9);

        // Inclusive cutoff: exactly 20 binds, 21 does not.
        assert!(try_bind_endpoint(&doc, [150.0, 80.0], &ElementId::of("arrow-1")).is_some());
        assert!(try_bind_endpoint(&doc, [150.0, 79.0], &ElementId::of("arrow-1")).is_none());
        // Far away: nothing binds.
        assert!(try_bind_endpoint(&doc, [0.0, 0.0], &ElementId::of("arrow-1")).is_none());
        // Excluding the only bindable target: nothing binds.
        assert!(try_bind_endpoint(&doc, probe, &ElementId::of("rect-1")).is_none());
    }

    #[test]
    fn follow_on_move_shifts_bound_endpoint() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(test_rect(&mut gen, "rect-1", 100.0, 100.0))
            .unwrap();
        let focus = calculate_focus([150.0, 100.0], &box_100());
        doc.upsert(test_arrow(
            &mut gen,
            "arrow-1",
            0.0,
            0.0,
            vec![[0.0, 0.0], [150.0, 100.0]],
            None,
            Some(binding_to("rect-1", focus, 0.0)),
        ))
        .unwrap();

        // Move the target +100 on x through the document, then follow.
        let mut moved = doc.get("rect-1").cloned().unwrap();
        moved.base_mut().x += 100.0;
        doc.upsert(moved).unwrap();

        let mut ctx = CommandContext::fresh(&mut doc);
        let outcome = update_bound_arrows(&mut ctx, &ElementId::of("rect-1")).unwrap();
        assert!(outcome.changed);
        assert_eq!(outcome.affected, vec![ElementId::of("arrow-1")]);

        let Element::Arrow(arrow) = ctx.doc().get("arrow-1").cloned().unwrap() else {
            panic!("arrow-1 must still be an arrow");
        };
        assert_eq!(arrow.points.len(), 2);
        assert!(approx_eq(arrow.points[0][0], 0.0, 1e-9));
        assert!(approx_eq(arrow.points[0][1], 0.0, 1e-9));
        // Top-center of the moved rect (200..300 x 100..200) is (250, 100).
        assert!(
            approx_eq(arrow.points[1][0], 250.0, 1e-9),
            "{:?}",
            arrow.points
        );
        assert!(
            approx_eq(arrow.points[1][1], 100.0, 1e-9),
            "{:?}",
            arrow.points
        );
    }

    #[test]
    fn bindings_clear_when_target_deleted_or_missing() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(test_rect(&mut gen, "rect-1", 100.0, 100.0))
            .unwrap();
        doc.upsert(test_rect(&mut gen, "rect-2", 400.0, 400.0))
            .unwrap();
        doc.upsert(test_arrow(
            &mut gen,
            "arrow-1",
            0.0,
            0.0,
            vec![[0.0, 0.0], [150.0, 100.0]],
            Some(binding_to("rect-1", 0.125, 0.0)),
            Some(binding_to("rect-1", 0.375, 5.0)),
        ))
        .unwrap();
        doc.upsert(test_arrow(
            &mut gen,
            "arrow-2",
            0.0,
            0.0,
            vec![[0.0, 0.0], [450.0, 450.0]],
            None,
            Some(binding_to("rect-2", 0.5, 0.0)),
        ))
        .unwrap();
        // Stale binding to an id that never existed.
        doc.upsert(test_arrow(
            &mut gen,
            "arrow-3",
            0.0,
            0.0,
            vec![[0.0, 0.0], [10.0, 10.0]],
            None,
            Some(binding_to("ghost", 0.0, 0.0)),
        ))
        .unwrap();

        doc.soft_delete("rect-1").unwrap();
        let mut ctx = CommandContext::fresh(&mut doc);
        let outcome = update_bound_arrows(&mut ctx, &ElementId::of("rect-1")).unwrap();
        assert!(outcome.changed);
        assert_eq!(outcome.affected, vec![ElementId::of("arrow-1")]);

        let Element::Arrow(cleared) = ctx.doc().get("arrow-1").cloned().unwrap() else {
            panic!("arrow-1 must still be an arrow");
        };
        assert!(cleared.start_binding.is_none());
        assert!(cleared.end_binding.is_none());
        // Unrelated bindings survive the clear.
        let Element::Arrow(kept) = ctx.doc().get("arrow-2").cloned().unwrap() else {
            panic!("arrow-2 must still be an arrow");
        };
        assert!(kept.end_binding.is_some());

        // Missing target clears too (TS null-target branch).
        let outcome = update_bound_arrows(&mut ctx, &ElementId::of("ghost")).unwrap();
        assert!(outcome.changed);
        let Element::Arrow(cleared) = ctx.doc().get("arrow-3").cloned().unwrap() else {
            panic!("arrow-3 must still be an arrow");
        };
        assert!(cleared.end_binding.is_none());
    }
}
