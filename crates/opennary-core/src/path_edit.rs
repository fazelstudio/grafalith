//! Path-edit session: per-anchor / per-handle direct manipulation of a path.
//!
//! TS source: `packages/core/src/interaction/path-edit.ts` (`PathEditor`:
//! anchor/handle/segment hit-testing, symmetric handle drags with Alt break,
//! add-on-segment, Alt+click delete, per-drag upsert, bounds recalculation).
//!
//! Session ownership (why this looks different from the TS class): the TS
//! editor holds a live scene reference and upserts on every pointer-up,
//! add, and delete. This port keeps a detached working copy instead —
//! nothing touches the document until [`SetPathSegments`] executes, so one
//! edit gesture collapses into exactly one undoable command
//! (validate-then-store discipline). Hosts preview from [`EditResult`] and commit
//! through [`PathEditor::commit_command`].
//!
//! Coordinate facts both layers share: anchors in [`PathSegment::point`]
//! are relative to the element origin, and Bezier handles are offsets
//! relative to their anchor — so dragging an anchor moves its handles along
//! for free, with no extra math (TS parity).

use crate::command::{Command, CommandContext, CommandOutcome};
use crate::element::{Element, ElementId, PathElement, PathSegment};
use crate::geometry::point::Point;
use crate::geometry::point_is_finite;
use crate::geometry::segment::dist_to_segment;
use crate::geometry::transform::{
    screen_to_world_tolerance, MIN_SIZE, PATH_ANCHOR_HIT_RADIUS_PX, PATH_HANDLE_HIT_RADIUS_PX,
    PATH_SEGMENT_HIT_THRESHOLD_PX,
};
use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Drag target + press classification
// ---------------------------------------------------------------------------

/// Which part of the path an in-flight drag owns (TS `DragTarget` parity).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DragTarget {
    /// Dragging anchor `segments[index]`.
    Anchor(usize),
    /// Dragging the incoming handle of `segments[index]`.
    HandleIn(usize),
    /// Dragging the outgoing handle of `segments[index]`.
    HandleOut(usize),
}

impl DragTarget {
    /// Segment index this drag owns.
    pub fn index(self) -> usize {
        match self {
            Self::Anchor(index) | Self::HandleIn(index) | Self::HandleOut(index) => index,
        }
    }
}

/// In-flight drag state: what is dragged, where the pointer was on the
/// previous move (deltas are incremental, TS parity), and the segment
/// snapshot from drag start (kept so hosts can diff or revert previews).
#[derive(Debug, Clone, PartialEq)]
pub struct ActiveDrag {
    /// What is being dragged.
    pub target: DragTarget,
    /// Pointer position in scene coordinates at the last processed event.
    pub start_scene: Point,
    /// Segment snapshot taken when the drag started.
    pub original: Vec<PathSegment>,
}

/// How [`PathEditor::pointer_down`] classified a press (TS
/// `handlePointerDown` branch parity: anchor-first, then handles, then
/// segment add; Alt+anchor deletes instead of dragging).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PressKind {
    /// Started dragging an anchor.
    AnchorDrag,
    /// Started dragging a Bezier handle.
    HandleDrag,
    /// Inserted a new anchor on the hit segment (no drag started).
    AddAnchor,
    /// Alt+click on an anchor: deletion consumed the press (the path keeps
    /// at least two anchors, so this may be a guarded no-op — see
    /// [`PathEditor::delete_anchor`]).
    DeleteAnchor,
    /// Hit nothing actionable.
    None,
}

// ---------------------------------------------------------------------------
// Pure hit-test + position helpers
// ---------------------------------------------------------------------------

/// Scene-space position of an anchor (origin + relative point).
pub fn anchor_scene_pos(segment: &PathSegment, origin: (f64, f64)) -> Point {
    [origin.0 + segment.point[0], origin.1 + segment.point[1]]
}

/// Scene-space position of one Bezier handle, or `None` when that side has
/// no handle (sharp corner).
pub fn handle_world_pos(segment: &PathSegment, origin: (f64, f64), is_in: bool) -> Option<Point> {
    let offset = if is_in {
        segment.handle_in
    } else {
        segment.handle_out
    };
    offset.map(|handle| {
        let anchor = anchor_scene_pos(segment, origin);
        [anchor[0] + handle[0], anchor[1] + handle[1]]
    })
}

/// Hit-tests anchor points: first anchor within `8 / zoom` scene units wins
/// (TS `ANCHOR_HIT_RADIUS` parity; non-finite/degenerate zoom falls back to
/// `1.0` via [`screen_to_world_tolerance`]).
///
/// `closed` is accepted for call-site symmetry with [`hit_test_segment`] —
/// anchor positions are unaffected by closure.
pub fn hit_test_anchors(
    segments: &[PathSegment],
    origin: (f64, f64),
    closed: bool,
    scene_pt: &Point,
    zoom: f64,
) -> Option<usize> {
    let _ = closed;
    let radius = screen_to_world_tolerance(PATH_ANCHOR_HIT_RADIUS_PX, zoom);
    let radius_sq = radius * radius;
    for (index, segment) in segments.iter().enumerate() {
        let anchor = anchor_scene_pos(segment, origin);
        let dx = scene_pt[0] - anchor[0];
        let dy = scene_pt[1] - anchor[1];
        if dx * dx + dy * dy <= radius_sq {
            return Some(index);
        }
    }
    None
}

/// Hit-tests Bezier handles: first handle within `6 / zoom` scene units
/// wins, checking `handle_in` before `handle_out` per anchor (TS
/// `HANDLE_HIT_RADIUS` order parity). Returns the segment index plus
/// whether the hit side is the incoming handle.
pub fn hit_test_handles(
    segments: &[PathSegment],
    origin: (f64, f64),
    scene_pt: &Point,
    zoom: f64,
) -> Option<(usize, bool)> {
    let radius = screen_to_world_tolerance(PATH_HANDLE_HIT_RADIUS_PX, zoom);
    let radius_sq = radius * radius;
    for (index, segment) in segments.iter().enumerate() {
        let anchor = anchor_scene_pos(segment, origin);
        for is_in in [true, false] {
            let offset = if is_in {
                segment.handle_in
            } else {
                segment.handle_out
            };
            if let Some(handle) = offset {
                let dx = scene_pt[0] - (anchor[0] + handle[0]);
                let dy = scene_pt[1] - (anchor[1] + handle[1]);
                if dx * dx + dy * dy <= radius_sq {
                    return Some((index, is_in));
                }
            }
        }
    }
    None
}

/// Hit-tests path legs for anchor insertion: the nearest leg within
/// `10 / zoom` scene units wins, returned as the segment index to insert
/// *after* (TS closing-segment parity: a closed path with more than two
/// anchors also tests last→first, reported as the last index so insertion
/// appends at the end).
pub fn hit_test_segment(
    segments: &[PathSegment],
    origin: (f64, f64),
    closed: bool,
    scene_pt: &Point,
    zoom: f64,
) -> Option<usize> {
    if segments.len() < 2 {
        return None;
    }
    let threshold = screen_to_world_tolerance(PATH_SEGMENT_HIT_THRESHOLD_PX, zoom);
    let mut best: Option<(usize, f64)> = None;
    let mut consider = |index: usize, a: Point, b: Point| {
        let distance = dist_to_segment(scene_pt, &a, &b);
        let is_better = match best {
            None => true,
            Some((_, current)) => distance < current,
        };
        if distance <= threshold && is_better {
            best = Some((index, distance));
        }
    };
    for (index, pair) in segments.windows(2).enumerate() {
        let (Some(first), Some(second)) = (pair.first(), pair.get(1)) else {
            continue;
        };
        consider(
            index,
            anchor_scene_pos(first, origin),
            anchor_scene_pos(second, origin),
        );
    }
    if closed && segments.len() > 2 {
        let (Some(first), Some(last)) = (segments.first(), segments.last()) else {
            return best.map(|(index, _)| index);
        };
        consider(
            segments.len() - 1,
            anchor_scene_pos(last, origin),
            anchor_scene_pos(first, origin),
        );
    }
    best.map(|(index, _)| index)
}

/// Tight local-frame bounds over anchors and their control handles, as
/// `(min_x, min_y, width, height)` relative to the current origin (TS
/// `recalcBounds` measurement parity, minus the origin shift — see
/// [`normalize_segments`]).
///
/// Width/height floor at [`MIN_SIZE`] (task contract; the TS recalc leaves
/// zero-size boxes, which the document layer rejects downstream).
/// Non-finite anchors/handles are skipped so the helper stays total; empty
/// (or fully non-finite) input yields `(0, 0, MIN_SIZE, MIN_SIZE)`.
pub fn recalc_bounds(segments: &[PathSegment]) -> (f64, f64, f64, f64) {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    let mut found = false;
    for segment in segments {
        if !point_is_finite(&segment.point) {
            continue;
        }
        let anchor = segment.point;
        let mut record = |x: f64, y: f64| {
            if x < min_x {
                min_x = x;
            }
            if y < min_y {
                min_y = y;
            }
            if x > max_x {
                max_x = x;
            }
            if y > max_y {
                max_y = y;
            }
            found = true;
        };
        record(anchor[0], anchor[1]);
        for handle in [segment.handle_in, segment.handle_out]
            .into_iter()
            .flatten()
        {
            if point_is_finite(&handle) {
                record(anchor[0] + handle[0], anchor[1] + handle[1]);
            }
        }
    }
    if !found {
        return (0.0, 0.0, MIN_SIZE, MIN_SIZE);
    }
    let width = (max_x - min_x).max(MIN_SIZE);
    let height = (max_y - min_y).max(MIN_SIZE);
    (min_x, min_y, width, height)
}

/// Shifts segments so the tight bounds sit at the local origin and folds
/// the shift into the origin: returns `(shifted, new_origin, width,
/// height)` with world positions preserved (TS `recalcBounds` shift
/// parity, plus the [`MIN_SIZE`] floor from [`recalc_bounds`]).
fn normalize_segments(
    segments: &[PathSegment],
    origin: (f64, f64),
) -> (Vec<PathSegment>, (f64, f64), f64, f64) {
    let (min_x, min_y, width, height) = recalc_bounds(segments);
    let shifted = segments
        .iter()
        .map(|segment| PathSegment {
            point: [segment.point[0] - min_x, segment.point[1] - min_y],
            handle_in: segment.handle_in,
            handle_out: segment.handle_out,
        })
        .collect();
    (shifted, (origin.0 + min_x, origin.1 + min_y), width, height)
}

// ---------------------------------------------------------------------------
// Edit session
// ---------------------------------------------------------------------------

/// Detached working copy of one path element under direct manipulation.
///
/// `origin` is the element's base `x/y`; `segments` stay relative to it.
/// The document is never touched by this session — hosts preview from
/// [`PathEditor::pointer_up`] and persist via [`PathEditor::commit_command`].
#[derive(Debug, Clone, PartialEq)]
pub struct PathEditor {
    /// Element under edit.
    pub target: ElementId,
    /// Working segments, relative to `origin`.
    pub segments: Vec<PathSegment>,
    /// Closed (filled shape) vs. open (stroke only); preserved by every op.
    pub closed: bool,
    /// Element base `x/y` the working segments are relative to.
    pub origin: (f64, f64),
    /// In-flight drag, if any.
    pub drag: Option<ActiveDrag>,
}

/// Committed snapshot of one edit gesture, for host preview rendering.
#[derive(Debug, Clone, PartialEq)]
pub struct EditResult {
    /// Edited element id.
    pub target: ElementId,
    /// Segments normalized to (`x`, `y`).
    pub segments: Vec<PathSegment>,
    /// Closed flag carried through the gesture.
    pub closed: bool,
    /// Resolved top-left x in scene coordinates.
    pub x: f64,
    /// Resolved top-left y in scene coordinates.
    pub y: f64,
    /// Resolved width (`>= 1`).
    pub width: f64,
    /// Resolved height (`>= 1`).
    pub height: f64,
}

impl EditResult {
    /// Wraps the snapshot as the undoable commit command (normalization is
    /// a fixed point, so rebuilding through [`SetPathSegments::new`] is a
    /// no-op shift on already-resolved state — one code path for bounds).
    pub fn into_command(self) -> SetPathSegments {
        SetPathSegments::new(self.target, self.segments, self.closed, (self.x, self.y))
    }
}

impl PathEditor {
    /// Starts an edit session from a stored path element. Rejects id
    /// mismatch, empty segment lists (nothing to grab), and non-finite
    /// geometry before copying anything.
    pub fn begin(target: ElementId, element: &PathElement) -> EngineResult<Self> {
        if element.base.id != target {
            return Err(EngineError::InvalidInput(format!(
                "path-edit target '{}' does not match element '{}'",
                target.as_str(),
                element.base.id.as_str()
            )));
        }
        element.base.validate()?;
        if element.segments.is_empty() {
            return Err(EngineError::InvalidInput(
                "path-edit needs at least one anchor".to_string(),
            ));
        }
        for segment in &element.segments {
            segment.validate()?;
        }
        Ok(Self {
            target,
            segments: element.segments.clone(),
            closed: element.closed,
            origin: (element.base.x, element.base.y),
            drag: None,
        })
    }

    /// Returns `true` while a drag is in flight.
    pub fn is_dragging(&self) -> bool {
        self.drag.is_some()
    }

    /// The in-flight drag target, if any.
    pub fn drag_target(&self) -> Option<DragTarget> {
        self.drag.as_ref().map(|drag| drag.target)
    }

    /// Classifies a press and starts its effect (TS `handlePointerDown`
    /// parity): anchors first (Alt deletes instead of dragging), then
    /// handles, then segment insertion when the path is closed or has at
    /// least two anchors. Add/delete apply immediately and clear any stale
    /// drag; drags mutate on [`PathEditor::pointer_move`] and settle on
    /// [`PathEditor::pointer_up`]. Non-finite points can never hit anything,
    /// so they report [`PressKind::None`].
    pub fn pointer_down(&mut self, scene_pt: &Point, zoom: f64, alt: bool) -> PressKind {
        if let Some(index) =
            hit_test_anchors(&self.segments, self.origin, self.closed, scene_pt, zoom)
        {
            if alt {
                let _ = self.delete_anchor(index);
                self.drag = None;
                return PressKind::DeleteAnchor;
            }
            self.drag = Some(ActiveDrag {
                target: DragTarget::Anchor(index),
                start_scene: *scene_pt,
                original: self.segments.clone(),
            });
            return PressKind::AnchorDrag;
        }
        if let Some((index, is_in)) = hit_test_handles(&self.segments, self.origin, scene_pt, zoom)
        {
            self.drag = Some(ActiveDrag {
                target: if is_in {
                    DragTarget::HandleIn(index)
                } else {
                    DragTarget::HandleOut(index)
                },
                start_scene: *scene_pt,
                original: self.segments.clone(),
            });
            return PressKind::HandleDrag;
        }
        if self.closed || self.segments.len() >= 2 {
            if let Some(seg_index) =
                hit_test_segment(&self.segments, self.origin, self.closed, scene_pt, zoom)
            {
                let _ = self.add_anchor_at(seg_index, scene_pt);
                self.drag = None;
                return PressKind::AddAnchor;
            }
        }
        PressKind::None
    }

    /// Advances the in-flight drag by one pointer position (TS
    /// `handlePointerMove` parity: incremental deltas from the last event).
    ///
    /// Anchor drags move the point; handles are anchor-relative so they
    /// follow untouched. Handle drags mirror the opposite side to the exact
    /// negation (`handle_in = -handle_out` and vice versa) unless
    /// `alt_break` holds the Alt independent-handle behavior. A missing
    /// dragged handle grows from the anchor (TS `[dx, dy]` fallback parity).
    /// No active drag is a silent no-op success; a non-finite pointer is an
    /// [`EngineError::InvalidInput`].
    pub fn pointer_move(&mut self, scene_pt: &Point, alt_break: bool) -> EngineResult<()> {
        if !point_is_finite(scene_pt) {
            return Err(EngineError::InvalidInput(format!(
                "path-edit pointer must be finite, got ({}, {})",
                scene_pt[0], scene_pt[1]
            )));
        }
        let (drag_target, dx, dy) = match self.drag.as_mut() {
            None => return Ok(()),
            Some(drag) => {
                let dx = scene_pt[0] - drag.start_scene[0];
                let dy = scene_pt[1] - drag.start_scene[1];
                drag.start_scene = *scene_pt;
                (drag.target, dx, dy)
            }
        };
        let Some(segment) = self.segments.get_mut(drag_target.index()) else {
            return Ok(());
        };
        match drag_target {
            DragTarget::Anchor(_) => {
                segment.point = [segment.point[0] + dx, segment.point[1] + dy];
            }
            DragTarget::HandleOut(_) => {
                let next = match segment.handle_out {
                    Some(current) => [current[0] + dx, current[1] + dy],
                    None => [dx, dy],
                };
                segment.handle_out = Some(next);
                if !alt_break {
                    segment.handle_in = Some([-next[0], -next[1]]);
                }
            }
            DragTarget::HandleIn(_) => {
                let next = match segment.handle_in {
                    Some(current) => [current[0] + dx, current[1] + dy],
                    None => [dx, dy],
                };
                segment.handle_in = Some(next);
                if !alt_break {
                    segment.handle_out = Some([-next[0], -next[1]]);
                }
            }
        }
        // Anchor moves re-tighten the origin (TS `recalcBounds`-per-move
        // parity); handle drags leave bounds stale until commit, also TS
        // parity — commit always resolves through `recalc_bounds`.
        if matches!(drag_target, DragTarget::Anchor(_)) {
            self.renormalize();
        }
        Ok(())
    }

    /// Ends the in-flight drag, returning a normalized snapshot for host
    /// preview, or `None` when no drag was active (TS `handlePointerUp`
    /// parity, minus the immediate scene upsert — persistence is
    /// [`PathEditor::commit_command`]).
    pub fn pointer_up(&mut self) -> Option<EditResult> {
        self.drag.as_ref()?;
        self.drag = None;
        let (segments, origin, width, height) = normalize_segments(&self.segments, self.origin);
        Some(EditResult {
            target: self.target.clone(),
            segments,
            closed: self.closed,
            x: origin.0,
            y: origin.1,
            width,
            height,
        })
    }

    /// Inserts a sharp anchor at the click position right after `seg_index`
    /// (a closing-leg hit reports the last index, so insertion appends —
    /// TS `splice(segIndex + 1, 0, …)` parity), then re-tightens the origin.
    /// Rejects out-of-range indexes and non-finite points.
    pub fn add_anchor_at(&mut self, seg_index: usize, scene_pt: &Point) -> EngineResult<()> {
        if !point_is_finite(scene_pt) {
            return Err(EngineError::InvalidInput(format!(
                "path-edit anchor must be finite, got ({}, {})",
                scene_pt[0], scene_pt[1]
            )));
        }
        if seg_index >= self.segments.len() {
            return Err(EngineError::InvalidInput(format!(
                "path-edit insert index {seg_index} out of range for {} anchors",
                self.segments.len()
            )));
        }
        let local = [scene_pt[0] - self.origin.0, scene_pt[1] - self.origin.1];
        self.segments.insert(
            seg_index + 1,
            PathSegment {
                point: local,
                handle_in: None,
                handle_out: None,
            },
        );
        self.drag = None;
        self.renormalize();
        Ok(())
    }

    /// Removes the anchor at `index` (TS `deleteAnchor` parity: paths keep
    /// at least two anchors, so deletion at two or fewer is a silent
    /// no-op), then re-tightens the origin. Rejects out-of-range indexes
    /// only when a removal would actually happen.
    pub fn delete_anchor(&mut self, index: usize) -> EngineResult<()> {
        if self.segments.len() <= 2 {
            return Ok(());
        }
        if index >= self.segments.len() {
            return Err(EngineError::InvalidInput(format!(
                "path-edit delete index {index} out of range for {} anchors",
                self.segments.len()
            )));
        }
        self.segments.remove(index);
        self.drag = None;
        self.renormalize();
        Ok(())
    }

    /// Builds the undoable commit for the current working state, resolving
    /// bounds through [`recalc_bounds`] at commit time (fixed-point
    /// normalization, so repeated commits never drift the origin).
    pub fn commit_command(&self) -> SetPathSegments {
        SetPathSegments::new(
            self.target.clone(),
            self.segments.clone(),
            self.closed,
            self.origin,
        )
    }

    /// Drops an in-flight drag without producing a snapshot (TS
    /// `exitEditMode`-without-commit parity for the gesture; the session is
    /// a detached copy, so discarding the whole session discards the edit).
    pub fn cancel(&mut self) {
        self.drag = None;
    }

    /// Re-tightens the origin around the current segments, preserving world
    /// positions.
    fn renormalize(&mut self) {
        let (segments, origin, _, _) = normalize_segments(&self.segments, self.origin);
        self.segments = segments;
        self.origin = origin;
    }
}

// ---------------------------------------------------------------------------
// Commit command (local: `command.rs` itself is untouched)
// ---------------------------------------------------------------------------

/// Replaces a path element's segments, closure flag, and resolved box as
/// one undoable step.
///
/// Bounds are derived at construction through [`recalc_bounds`] (the
/// "recalc at commit" rule), so drags never need to maintain them.
/// Unknown ids are [`EngineError::NotFound`]; non-path targets are
/// [`EngineError::InvalidInput`]; soft-deleted targets are a no-op success
/// (edits never revive tombstones). Like TS `scene.upsertElement` — and
/// unlike move/resize — no lock check applies: the editor layer filters
/// locked elements before a session ever starts.
#[derive(Debug, Clone, PartialEq)]
pub struct SetPathSegments {
    /// Path element to rewrite.
    pub target: ElementId,
    /// Segments normalized to (`x`, `y`).
    pub segments: Vec<PathSegment>,
    /// Closed (filled shape) vs. open (stroke only).
    pub closed: bool,
    /// Resolved top-left x in scene coordinates.
    pub x: f64,
    /// Resolved top-left y in scene coordinates.
    pub y: f64,
    /// Resolved width (`>= 1`).
    pub width: f64,
    /// Resolved height (`>= 1`).
    pub height: f64,
}

impl SetPathSegments {
    /// Builds the command, resolving the box from `segments` against
    /// `origin` (the session's base `x/y`) at commit time.
    pub fn new(
        target: ElementId,
        segments: Vec<PathSegment>,
        closed: bool,
        origin: (f64, f64),
    ) -> Self {
        let (segments, origin, width, height) = normalize_segments(&segments, origin);
        Self {
            target,
            segments,
            closed,
            x: origin.0,
            y: origin.1,
            width,
            height,
        }
    }
}

impl Command for SetPathSegments {
    /// Short human-readable name for debugging and tests.
    fn label(&self) -> &str {
        "path-edit"
    }

    /// Validates everything (segments, resolved box, target kind) before
    /// storing anything, then upserts through the context (which owns
    /// version discipline).
    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        for segment in &self.segments {
            segment.validate()?;
        }
        for (name, value) in [
            ("x", self.x),
            ("y", self.y),
            ("width", self.width),
            ("height", self.height),
        ] {
            if !value.is_finite() {
                return Err(EngineError::InvalidInput(format!(
                    "path-edit {name} must be finite, got {value}"
                )));
            }
        }
        let Some(element) = ctx.doc().get(self.target.as_str()) else {
            return Err(EngineError::NotFound(self.target.as_str().to_string()));
        };
        let Element::Path(_) = element else {
            return Err(EngineError::InvalidInput(format!(
                "path-edit targets path elements, '{}' is {}",
                self.target.as_str(),
                element.element_type_name()
            )));
        };
        if element.base().is_deleted {
            return Ok(CommandOutcome::default());
        }
        let mut next = element.clone();
        if let Element::Path(path) = &mut next {
            path.segments = self.segments.clone();
            path.closed = self.closed;
            path.base.x = self.x;
            path.base.y = self.y;
            path.base.width = self.width;
            path.base.height = self.height;
        }
        next.validate()?;
        ctx.upsert(next)?;
        Ok(CommandOutcome {
            affected: vec![self.target.clone()],
            changed: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Document;
    use crate::element::{create_path, CounterIdGenerator};

    fn two_anchors() -> Vec<PathSegment> {
        vec![
            PathSegment {
                point: [0.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [100.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
        ]
    }

    fn path_element(id: &str, origin: (f64, f64), closed: bool) -> PathElement {
        let mut gen = CounterIdGenerator::new();
        let mut path = create_path(&mut gen);
        path.base.id = ElementId::of(id);
        path.base.x = origin.0;
        path.base.y = origin.1;
        path.segments = two_anchors();
        path.closed = closed;
        path
    }

    fn editor_at_origin() -> PathEditor {
        PathEditor::begin(ElementId::of("p"), &path_element("p", (0.0, 0.0), false)).unwrap()
    }

    #[test]
    fn anchor_hit_uses_zoom_scaled_radius() {
        let segments = two_anchors();
        // 5px away hits at zoom 1 (radius 8).
        assert_eq!(
            hit_test_anchors(&segments, (0.0, 0.0), false, &[3.0, 4.0], 1.0),
            Some(0)
        );
        // 10px away misses at zoom 1, hits at zoom 0.5 (radius 16).
        assert_eq!(
            hit_test_anchors(&segments, (0.0, 0.0), false, &[10.0, 0.0], 1.0),
            None
        );
        assert_eq!(
            hit_test_anchors(&segments, (0.0, 0.0), false, &[10.0, 0.0], 0.5),
            Some(0)
        );
        // 5px away misses at zoom 2 (radius 4).
        assert_eq!(
            hit_test_anchors(&segments, (0.0, 0.0), false, &[3.0, 4.0], 2.0),
            None
        );
        // Degenerate zoom falls back to 1.0 instead of dividing by zero.
        assert_eq!(
            hit_test_anchors(&segments, (0.0, 0.0), false, &[3.0, 4.0], f64::NAN),
            Some(0)
        );
    }

    #[test]
    fn handle_hit_distinguishes_in_and_out() {
        let segments = vec![
            PathSegment {
                point: [0.0, 0.0],
                handle_in: Some([-10.0, 0.0]),
                handle_out: Some([10.0, 0.0]),
            },
            PathSegment {
                point: [100.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
        ];
        assert_eq!(
            hit_test_handles(&segments, (0.0, 0.0), &[-10.0, 0.0], 1.0),
            Some((0, true))
        );
        assert_eq!(
            hit_test_handles(&segments, (0.0, 0.0), &[10.0, 0.0], 1.0),
            Some((0, false))
        );
        assert_eq!(
            hit_test_handles(&segments, (0.0, 0.0), &[50.0, 50.0], 1.0),
            None
        );
    }

    #[test]
    fn segment_hit_returns_nearest_index() {
        let segments = vec![
            PathSegment {
                point: [0.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [100.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [100.0, 100.0],
                handle_in: None,
                handle_out: None,
            },
        ];
        assert_eq!(
            hit_test_segment(&segments, (0.0, 0.0), false, &[50.0, 1.0], 1.0),
            Some(0)
        );
        assert_eq!(
            hit_test_segment(&segments, (0.0, 0.0), false, &[100.0, 50.0], 1.0),
            Some(1)
        );
        assert_eq!(
            hit_test_segment(&segments, (0.0, 0.0), false, &[200.0, 200.0], 1.0),
            None
        );
        assert_eq!(
            hit_test_segment(&two_anchors()[..1], (0.0, 0.0), false, &[0.0, 0.0], 1.0),
            None
        );
    }

    #[test]
    fn closed_path_hits_closing_segment() {
        let segments = vec![
            PathSegment {
                point: [0.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [100.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [50.0, 100.0],
                handle_in: None,
                handle_out: None,
            },
        ];
        // Midpoint of the closing leg last -> first.
        assert_eq!(
            hit_test_segment(&segments, (0.0, 0.0), true, &[25.0, 50.0], 1.0),
            Some(2)
        );
        // Same point on the open path is far from every leg.
        assert_eq!(
            hit_test_segment(&segments, (0.0, 0.0), false, &[25.0, 50.0], 1.0),
            None
        );
    }

    #[test]
    fn anchor_drag_moves_point_and_keeps_relative_handles() {
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: Some([-5.0, 0.0]),
                    handle_out: Some([5.0, 0.0]),
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        assert_eq!(
            editor.pointer_down(&[0.0, 0.0], 1.0, false),
            PressKind::AnchorDrag
        );
        editor.pointer_move(&[10.0, 5.0], false).unwrap();
        // Handles are anchor-relative: offsets unchanged, world follows.
        assert_eq!(editor.segments[0].handle_in, Some([-5.0, 0.0]));
        assert_eq!(editor.segments[0].handle_out, Some([5.0, 0.0]));
        assert_eq!(
            handle_world_pos(&editor.segments[0], editor.origin, false),
            Some([15.0, 5.0])
        );
        // Tight bounds pulled the origin to the handle-extent minimum.
        assert_eq!(editor.origin, (5.0, 0.0));
        let result = editor.pointer_up().unwrap();
        assert_eq!((result.x, result.y), (5.0, 0.0));
        assert!(!editor.is_dragging());
    }

    #[test]
    fn handle_drag_mirrors_opposite_by_default() {
        // Fresh opposite handle is created as the exact negation.
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: None,
                    handle_out: Some([10.0, 0.0]),
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        assert_eq!(
            editor.pointer_down(&[10.0, 0.0], 1.0, false),
            PressKind::HandleDrag
        );
        assert_eq!(editor.drag_target(), Some(DragTarget::HandleOut(0)));
        editor.pointer_move(&[20.0, 0.0], false).unwrap();
        assert_eq!(editor.segments[0].handle_out, Some([20.0, 0.0]));
        assert_eq!(editor.segments[0].handle_in, Some([-20.0, 0.0]));

        // Pre-existing asymmetric opposite is replaced by the pure mirror
        // (not length-preserving scaling).
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: Some([-5.0, 0.0]),
                    handle_out: Some([10.0, 0.0]),
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        assert_eq!(
            editor.pointer_down(&[10.0, 0.0], 1.0, false),
            PressKind::HandleDrag
        );
        editor.pointer_move(&[20.0, 0.0], false).unwrap();
        assert_eq!(editor.segments[0].handle_out, Some([20.0, 0.0]));
        assert_eq!(editor.segments[0].handle_in, Some([-20.0, 0.0]));
    }

    #[test]
    fn alt_breaks_handle_symmetry() {
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: None,
                    handle_out: Some([10.0, 0.0]),
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        assert_eq!(
            editor.pointer_down(&[10.0, 0.0], 1.0, false),
            PressKind::HandleDrag
        );
        editor.pointer_move(&[20.0, 0.0], true).unwrap();
        assert_eq!(editor.segments[0].handle_out, Some([20.0, 0.0]));
        assert_eq!(editor.segments[0].handle_in, None);

        // …and a pre-existing opposite is left untouched too.
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: Some([-5.0, 0.0]),
                    handle_out: Some([10.0, 0.0]),
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        assert_eq!(
            editor.pointer_down(&[10.0, 0.0], 1.0, false),
            PressKind::HandleDrag
        );
        editor.pointer_move(&[20.0, 0.0], true).unwrap();
        assert_eq!(editor.segments[0].handle_in, Some([-5.0, 0.0]));
    }

    #[test]
    fn handle_in_drag_mirrors_out() {
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: Some([-10.0, 0.0]),
                    handle_out: Some([5.0, 0.0]),
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        assert_eq!(
            editor.pointer_down(&[-10.0, 0.0], 1.0, false),
            PressKind::HandleDrag
        );
        assert_eq!(editor.drag_target(), Some(DragTarget::HandleIn(0)));
        editor.pointer_move(&[-20.0, 0.0], false).unwrap();
        assert_eq!(editor.segments[0].handle_in, Some([-20.0, 0.0]));
        assert_eq!(editor.segments[0].handle_out, Some([20.0, 0.0]));
    }

    #[test]
    fn add_anchor_inserts_after_segment_and_tightens_origin() {
        let mut editor =
            PathEditor::begin(ElementId::of("p"), &path_element("p", (10.0, 20.0), false)).unwrap();
        editor.add_anchor_at(0, &[50.0, 0.0]).unwrap();
        assert_eq!(editor.segments.len(), 3);
        assert_eq!(editor.segments[1].handle_in, None);
        assert_eq!(editor.segments[1].handle_out, None);
        // Click (50, 0) minus origin (10, 20) is (40, -20); the negative-y
        // minimum pulls the origin down and shifts every anchor.
        assert_eq!(editor.origin, (10.0, 0.0));
        assert_eq!(editor.segments[0].point, [0.0, 20.0]);
        assert_eq!(editor.segments[1].point, [40.0, 0.0]);
        assert_eq!(editor.segments[2].point, [100.0, 20.0]);
        assert!(editor.add_anchor_at(9, &[0.0, 0.0]).is_err());
        assert!(editor.add_anchor_at(0, &[f64::NAN, 0.0]).is_err());
    }

    #[test]
    fn delete_anchor_keeps_minimum_two() {
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [50.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        editor.delete_anchor(1).unwrap();
        assert_eq!(editor.segments.len(), 2);
        assert_eq!(editor.segments[1].point, [100.0, 0.0]);
        // Guarded no-op at two anchors (TS parity), not an error.
        editor.delete_anchor(0).unwrap();
        assert_eq!(editor.segments.len(), 2);
    }

    #[test]
    fn recalc_bounds_clamps_to_minimum_one() {
        assert_eq!(
            recalc_bounds(&[PathSegment {
                point: [5.0, 5.0],
                handle_in: None,
                handle_out: None,
            }]),
            (5.0, 5.0, MIN_SIZE, MIN_SIZE)
        );
        assert_eq!(recalc_bounds(&[]), (0.0, 0.0, MIN_SIZE, MIN_SIZE));
        assert_eq!(
            recalc_bounds(&[
                PathSegment {
                    point: [10.0, 20.0],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [30.0, 60.0],
                    handle_in: None,
                    handle_out: None,
                },
            ]),
            (10.0, 20.0, 20.0, 40.0)
        );
        // Handles extend the box.
        assert_eq!(
            recalc_bounds(&[
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: None,
                    handle_out: Some([50.0, 0.0]),
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: Some([-50.0, 0.0]),
                    handle_out: None,
                },
            ]),
            (0.0, 0.0, 100.0, MIN_SIZE)
        );
    }

    #[test]
    fn commit_command_resolves_bounds_and_preserves_closed() {
        let mut doc = Document::new();
        let mut gen = CounterIdGenerator::new();
        let mut stored = create_path(&mut gen);
        stored.base.id = ElementId::of("p");
        stored.base.x = 0.0;
        stored.base.y = 0.0;
        stored.segments = two_anchors();
        stored.closed = true;
        doc.upsert(Element::Path(stored)).unwrap();

        let editor =
            PathEditor::begin(ElementId::of("p"), &path_element("p", (10.0, 20.0), true)).unwrap();
        let mut command = editor.commit_command();
        assert_eq!(command.label(), "path-edit");
        assert_eq!((command.x, command.y), (10.0, 20.0));
        assert_eq!((command.width, command.height), (100.0, MIN_SIZE));
        assert!(command.closed);

        let mut ctx = crate::command::CommandContext::fresh(&mut doc);
        let outcome = command.execute(&mut ctx).unwrap();
        assert!(outcome.changed);
        assert_eq!(outcome.affected, vec![ElementId::of("p")]);
        let Element::Path(after) = doc.get("p").unwrap() else {
            panic!("stored element must stay a path");
        };
        assert_eq!(after.segments, two_anchors());
        assert!(after.closed);
        assert_eq!((after.base.x, after.base.y), (10.0, 20.0));
        assert_eq!((after.base.width, after.base.height), (100.0, MIN_SIZE));
    }

    #[test]
    fn pointer_up_without_drag_returns_none() {
        let mut editor = editor_at_origin();
        assert_eq!(editor.pointer_up(), None);
        assert!(editor.pointer_move(&[5.0, 5.0], false).is_ok());
        assert_eq!(editor.pointer_up(), None);
        assert!(editor.pointer_move(&[f64::NAN, 0.0], false).is_err());
    }

    #[test]
    fn press_kind_priority_anchor_then_segment_then_none() {
        let mut editor = PathEditor {
            target: ElementId::of("p"),
            segments: vec![
                PathSegment {
                    point: [0.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [50.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
                PathSegment {
                    point: [100.0, 0.0],
                    handle_in: None,
                    handle_out: None,
                },
            ],
            closed: false,
            origin: (0.0, 0.0),
            drag: None,
        };
        // Alt+anchor deletes and consumes the press.
        assert_eq!(
            editor.pointer_down(&[50.0, 0.0], 1.0, true),
            PressKind::DeleteAnchor
        );
        assert_eq!(editor.segments.len(), 2);
        // Mid-segment click inserts.
        assert_eq!(
            editor.pointer_down(&[50.0, 0.0], 1.0, false),
            PressKind::AddAnchor
        );
        assert_eq!(editor.segments.len(), 3);
        // Empty space hits nothing.
        assert_eq!(
            editor.pointer_down(&[500.0, 500.0], 1.0, false),
            PressKind::None
        );
    }

    #[test]
    fn set_path_segments_rejects_unknown_and_non_path() {
        let mut doc = Document::new();
        let mut gen = CounterIdGenerator::new();
        let mut rect = crate::element::create_rectangle(&mut gen);
        rect.base.id = ElementId::of("r");
        doc.upsert(Element::Rectangle(rect)).unwrap();

        let mut ctx = crate::command::CommandContext::fresh(&mut doc);
        let mut wrong_kind =
            SetPathSegments::new(ElementId::of("r"), two_anchors(), false, (0.0, 0.0));
        assert!(matches!(
            wrong_kind.execute(&mut ctx),
            Err(EngineError::InvalidInput(_))
        ));

        let mut ctx = crate::command::CommandContext::fresh(&mut doc);
        let mut unknown =
            SetPathSegments::new(ElementId::of("ghost"), two_anchors(), false, (0.0, 0.0));
        assert!(matches!(
            unknown.execute(&mut ctx),
            Err(EngineError::NotFound(_))
        ));
    }

    #[test]
    fn begin_rejects_mismatch_and_empty() {
        let element = path_element("p", (0.0, 0.0), false);
        assert!(PathEditor::begin(ElementId::of("other"), &element).is_err());
        let mut gen = CounterIdGenerator::new();
        let mut empty = create_path(&mut gen);
        empty.base.id = ElementId::of("e");
        assert!(PathEditor::begin(ElementId::of("e"), &empty).is_err());
    }

    #[test]
    fn cancel_drops_drag_without_snapshot() {
        let mut editor = editor_at_origin();
        assert_eq!(
            editor.pointer_down(&[0.0, 0.0], 1.0, false),
            PressKind::AnchorDrag
        );
        editor.cancel();
        assert!(!editor.is_dragging());
        assert_eq!(editor.pointer_up(), None);
    }
}
