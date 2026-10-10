//! Align (6 ops) + distribute (2 ops, outer-fixed equal-gap).
//!
//! TS source: `packages/core/src/interaction/alignment.ts` (distribute
//! keeps outer elements fixed and equalizes gaps; `< 3` elements is a
//! no-op — pinned by `alignment.test.ts`).
//!
//! Read-only planning is pure: [`compute_combined_bounds`],
//! [`compute_align_updates`], and [`compute_distribute_updates`] only borrow
//! the [`Document`] and return pending next states — nothing is stored here.
//! Mutation goes through the [`Command`] trait ([`AlignElements`],
//! [`DistributeElements`]) so every move is one undoable, atomic step: all
//! next states are built and validated first, then stored via
//! [`CommandContext`], with unknown and deleted ids skipped (TS parity).
//! The six TS `align*` functions collapse into one [`AlignMode`] dispatch
//! ([`align_delta`]); the two `distribute*` functions collapse into one
//! [`DistributeAxis`] dispatch.

use std::cmp::Ordering;

use grafalith_geometry::Bounds;

use crate::command::{Command, CommandContext, CommandOutcome};
use crate::document::Document;
use crate::element::{Element, ElementId};
use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/// Which edge (or center) the selection snaps to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlignMode {
    /// Snap left edges to the leftmost edge.
    Left,
    /// Snap right edges to the rightmost edge.
    Right,
    /// Snap top edges to the topmost edge.
    Top,
    /// Snap bottom edges to the bottommost edge.
    Bottom,
    /// Snap horizontal centers to the combined center.
    CenterH,
    /// Snap vertical centers to the combined center.
    CenterV,
}

/// Which axis to equalize gaps along (outer elements stay fixed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DistributeAxis {
    /// Equalize horizontal gaps, sorted by left edge.
    Horizontal,
    /// Equalize vertical gaps, sorted by top edge.
    Vertical,
}

// ---------------------------------------------------------------------------
// Pure planning
// ---------------------------------------------------------------------------

/// Computes the combined bounds of the given ids.
///
/// Skips unknown and deleted elements (TS parity); returns `None` when no
/// valid element remains.
pub fn compute_combined_bounds(doc: &Document, ids: &[ElementId]) -> Option<Bounds> {
    let mut acc: Option<Bounds> = None;
    for id in ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted {
            continue;
        }
        let bounds = element.bounds();
        acc = Some(match acc {
            None => bounds,
            Some(combined) => combined.union(&bounds),
        });
    }
    acc
}

/// Returns the scene-space shift that snaps one element's bounds to the
/// combined bounds under the given mode.
pub fn align_delta(mode: AlignMode, combined: &Bounds, element: &Bounds) -> (f64, f64) {
    match mode {
        AlignMode::Left => (combined.min_x - element.min_x, 0.0),
        AlignMode::Right => (combined.max_x - element.max_x, 0.0),
        AlignMode::Top => (0.0, combined.min_y - element.min_y),
        AlignMode::Bottom => (0.0, combined.max_y - element.max_y),
        AlignMode::CenterH => {
            let target = (combined.min_x + combined.max_x) / 2.0;
            let current = (element.min_x + element.max_x) / 2.0;
            (target - current, 0.0)
        }
        AlignMode::CenterV => {
            let target = (combined.min_y + combined.max_y) / 2.0;
            let current = (element.min_y + element.max_y) / 2.0;
            (0.0, target - current)
        }
    }
}

/// Plans an align pass: `(id, next state)` pairs with translated `x`/`y`.
///
/// Pure — nothing is stored. Skips unknown and deleted ids. Returns an
/// empty vec when no valid element remains (the command reports that as a
/// no-op). Zero-delta entries are kept (TS parity: the TS loop upserts
/// every valid element, even one already in place).
pub fn compute_align_updates(
    doc: &Document,
    ids: &[ElementId],
    mode: AlignMode,
) -> Vec<(ElementId, Element)> {
    let Some(combined) = compute_combined_bounds(doc, ids) else {
        return Vec::new();
    };
    let mut pending = Vec::new();
    for id in ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted {
            continue;
        }
        let (dx, dy) = align_delta(mode, &combined, &element.bounds());
        let mut next = element.clone();
        next.base_mut().x += dx;
        next.base_mut().y += dy;
        pending.push((id.clone(), next));
    }
    pending
}

/// Plans a distribute pass: `(id, next state)` pairs with equalized gaps.
///
/// Pure — nothing is stored. Entries are sorted by leading edge (left for
/// horizontal, top for vertical); the first and last entries keep their
/// positions while inner ones shift so every gap is equal (TS parity).
/// Returns an empty vec when fewer than 3 valid elements remain (the
/// command reports that as a no-op success).
pub fn compute_distribute_updates(
    doc: &Document,
    ids: &[ElementId],
    axis: DistributeAxis,
) -> Vec<(ElementId, Element)> {
    let mut entries: Vec<(ElementId, Bounds, Element)> = Vec::new();
    for id in ids {
        let Some(element) = doc.get(id.as_str()) else {
            continue;
        };
        if element.base().is_deleted {
            continue;
        }
        entries.push((id.clone(), element.bounds(), element.clone()));
    }
    if entries.len() < 3 {
        return Vec::new();
    }
    match axis {
        DistributeAxis::Horizontal => {
            entries.sort_by(|a, b| a.1.min_x.partial_cmp(&b.1.min_x).unwrap_or(Ordering::Equal));
        }
        DistributeAxis::Vertical => {
            entries.sort_by(|a, b| a.1.min_y.partial_cmp(&b.1.min_y).unwrap_or(Ordering::Equal));
        }
    }
    let (first_leading, last_leading) = match (entries.first(), entries.last()) {
        (Some(first), Some(last)) => match axis {
            DistributeAxis::Horizontal => (first.1.min_x, last.1.min_x),
            DistributeAxis::Vertical => (first.1.min_y, last.1.min_y),
        },
        // Unreachable: length was checked above, but stay total regardless.
        _ => return Vec::new(),
    };
    let total_span = last_leading - first_leading;
    // Span covers (n-1) gaps plus the sizes of all entries except the last
    // (whose leading edge is the endpoint).
    let count = entries.len();
    let total_except_last: f64 = entries
        .iter()
        .take(count.saturating_sub(1))
        .map(|(_, bounds, _)| match axis {
            DistributeAxis::Horizontal => bounds.width(),
            DistributeAxis::Vertical => bounds.height(),
        })
        .sum();
    let gap = (total_span - total_except_last) / (count as f64 - 1.0);

    let mut cursor = first_leading;
    let mut pending = Vec::with_capacity(count);
    for (id, bounds, element) in entries {
        let (size, delta) = match axis {
            DistributeAxis::Horizontal => (bounds.width(), cursor - bounds.min_x),
            DistributeAxis::Vertical => (bounds.height(), cursor - bounds.min_y),
        };
        let mut next = element;
        match axis {
            DistributeAxis::Horizontal => next.base_mut().x += delta,
            DistributeAxis::Vertical => next.base_mut().y += delta,
        }
        pending.push((id, next));
        cursor += size + gap;
    }
    pending
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Aligns elements to one edge (or center) of their combined bounds.
///
/// Skips unknown and deleted ids (TS parity). Two-phase: every next state
/// is built and validated before the first store, so rejection leaves the
/// document untouched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlignElements {
    /// Elements to align.
    pub ids: Vec<ElementId>,
    /// Which edge (or center) to snap to.
    pub mode: AlignMode,
}

impl AlignElements {
    /// Builds an align command for the given ids and mode.
    pub fn new(ids: Vec<ElementId>, mode: AlignMode) -> Self {
        Self { ids, mode }
    }
}

impl Command for AlignElements {
    fn label(&self) -> &str {
        "align"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let pending = compute_align_updates(ctx.doc(), &self.ids, self.mode);
        for (_, next) in &pending {
            if !next.base().x.is_finite() || !next.base().y.is_finite() {
                return Err(EngineError::InvalidInput(
                    "align produced a non-finite position".to_string(),
                ));
            }
            next.validate()?;
        }
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

/// Distributes elements with equal gaps along one axis.
///
/// Outer elements stay fixed; inner ones shift (TS parity). Fewer than 3
/// valid elements is a no-op success (`changed == false`). Two-phase: every
/// next state is built and validated before the first store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DistributeElements {
    /// Elements to distribute.
    pub ids: Vec<ElementId>,
    /// Axis to equalize gaps along.
    pub axis: DistributeAxis,
}

impl DistributeElements {
    /// Builds a distribute command for the given ids and axis.
    pub fn new(ids: Vec<ElementId>, axis: DistributeAxis) -> Self {
        Self { ids, axis }
    }
}

impl Command for DistributeElements {
    fn label(&self) -> &str {
        "distribute"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let pending = compute_distribute_updates(ctx.doc(), &self.ids, self.axis);
        for (_, next) in &pending {
            if !next.base().x.is_finite() || !next.base().y.is_finite() {
                return Err(EngineError::InvalidInput(
                    "distribute produced a non-finite position".to_string(),
                ));
            }
            next.validate()?;
        }
        let mut affected = Vec::with_capacity(pending.len());
        for (id, next) in pending {
            ctx.upsert(next)?;
            affected.push(id);
        }
        let changed = !affected.is_empty();
        Ok(CommandOutcome { affected, changed })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::CommandContext;
    use crate::document::Document;
    use crate::element::{create_rectangle, CounterIdGenerator};

    fn rectangle(
        gen: &mut CounterIdGenerator,
        id: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        rect.base.x = x;
        rect.base.y = y;
        rect.base.width = w;
        rect.base.height = h;
        Element::Rectangle(rect)
    }

    fn doc_with(rects: &[(&str, f64, f64, f64, f64)]) -> (Document, CounterIdGenerator) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        for (id, x, y, w, h) in rects {
            doc.upsert(rectangle(&mut gen, id, *x, *y, *w, *h)).unwrap();
        }
        (doc, gen)
    }

    fn run(
        doc: &mut Document,
        cmd: &mut impl Command,
    ) -> (CommandOutcome, crate::command::HistoryEntry) {
        let mut ctx = CommandContext::fresh(doc);
        let outcome = cmd.execute(&mut ctx).unwrap();
        let entry = ctx.into_entry();
        (outcome, entry)
    }

    fn ids(names: &[&str]) -> Vec<ElementId> {
        names.iter().map(|name| ElementId::of(*name)).collect()
    }

    #[test]
    fn combined_bounds_cover_all_valid_elements() {
        let (doc, _) = doc_with(&[
            ("a", 10.0, 20.0, 100.0, 50.0),
            ("b", 200.0, 300.0, 80.0, 60.0),
        ]);
        let bounds = compute_combined_bounds(&doc, &ids(&["a", "b"])).unwrap();
        assert_eq!(bounds, Bounds::new(10.0, 20.0, 280.0, 360.0));
    }

    #[test]
    fn combined_bounds_ignore_unknown_deleted_and_empty() {
        let (mut doc, _) = doc_with(&[("a", 10.0, 20.0, 100.0, 50.0)]);
        assert!(compute_combined_bounds(&doc, &[]).is_none());
        assert!(compute_combined_bounds(&doc, &ids(&["ghost"])).is_none());
        doc.soft_delete("a").unwrap();
        assert!(compute_combined_bounds(&doc, &ids(&["a"])).is_none());
    }

    #[test]
    fn align_left_snaps_to_leftmost_edge() {
        let (mut doc, _) = doc_with(&[("a", 10.0, 0.0, 50.0, 50.0), ("b", 100.0, 0.0, 50.0, 50.0)]);
        let (outcome, _) = run(
            &mut doc,
            &mut AlignElements::new(ids(&["a", "b"]), AlignMode::Left),
        );
        assert!(outcome.changed);
        assert_eq!(doc.get("a").unwrap().base().x, 10.0);
        assert_eq!(doc.get("b").unwrap().base().x, 10.0);
    }

    #[test]
    fn align_right_snaps_to_rightmost_edge() {
        let (mut doc, _) = doc_with(&[("a", 10.0, 0.0, 50.0, 50.0), ("b", 100.0, 0.0, 50.0, 50.0)]);
        let (outcome, _) = run(
            &mut doc,
            &mut AlignElements::new(ids(&["a", "b"]), AlignMode::Right),
        );
        assert!(outcome.changed);
        assert_eq!(doc.get("a").unwrap().base().x, 100.0);
        assert_eq!(doc.get("b").unwrap().base().x, 100.0);
    }

    #[test]
    fn align_top_and_bottom_snap_vertically() {
        let (mut doc, _) = doc_with(&[("a", 0.0, 10.0, 50.0, 50.0), ("b", 0.0, 200.0, 50.0, 50.0)]);
        run(
            &mut doc,
            &mut AlignElements::new(ids(&["a", "b"]), AlignMode::Top),
        );
        assert_eq!(doc.get("a").unwrap().base().y, 10.0);
        assert_eq!(doc.get("b").unwrap().base().y, 10.0);

        let (mut doc, _) = doc_with(&[("a", 0.0, 10.0, 50.0, 50.0), ("b", 0.0, 200.0, 50.0, 50.0)]);
        run(
            &mut doc,
            &mut AlignElements::new(ids(&["a", "b"]), AlignMode::Bottom),
        );
        assert_eq!(doc.get("a").unwrap().base().y, 200.0);
        assert_eq!(doc.get("b").unwrap().base().y, 200.0);
    }

    #[test]
    fn align_center_h_matches_ts_pinned_values() {
        // Combined 0..360, center 180 (mirrors `alignment.test.ts`).
        let (mut doc, _) = doc_with(&[("a", 0.0, 0.0, 100.0, 50.0), ("b", 300.0, 0.0, 60.0, 50.0)]);
        run(
            &mut doc,
            &mut AlignElements::new(ids(&["a", "b"]), AlignMode::CenterH),
        );
        assert_eq!(doc.get("a").unwrap().base().x, 130.0);
        assert_eq!(doc.get("b").unwrap().base().x, 150.0);
    }

    #[test]
    fn align_center_v_matches_ts_pinned_values() {
        let (mut doc, _) = doc_with(&[("a", 0.0, 0.0, 50.0, 100.0), ("b", 0.0, 300.0, 50.0, 60.0)]);
        run(
            &mut doc,
            &mut AlignElements::new(ids(&["a", "b"]), AlignMode::CenterV),
        );
        assert_eq!(doc.get("a").unwrap().base().y, 130.0);
        assert_eq!(doc.get("b").unwrap().base().y, 150.0);
    }

    #[test]
    fn align_skips_deleted_and_unknown() {
        let (mut doc, _) = doc_with(&[("a", 10.0, 0.0, 50.0, 50.0), ("b", 100.0, 0.0, 50.0, 50.0)]);
        doc.soft_delete("b").unwrap();
        let (outcome, _) = run(
            &mut doc,
            &mut AlignElements::new(ids(&["a", "b", "ghost"]), AlignMode::Left),
        );
        assert_eq!(outcome.affected, vec![ElementId::of("a")]);
        assert!(outcome.changed);
        // Deleted element keeps its position.
        assert_eq!(doc.get("b").unwrap().base().x, 100.0);
    }

    #[test]
    fn align_with_no_valid_elements_is_a_noop() {
        let (mut doc, _) = doc_with(&[("a", 10.0, 0.0, 50.0, 50.0)]);
        let nonce_before = doc.scene_nonce();
        let (outcome, entry) = run(
            &mut doc,
            &mut AlignElements::new(ids(&["ghost"]), AlignMode::Left),
        );
        assert!(!outcome.changed);
        assert!(outcome.affected.is_empty());
        assert!(entry.is_empty());
        assert_eq!(doc.scene_nonce(), nonce_before);
    }

    #[test]
    fn distribute_horizontal_equalizes_gaps_outer_fixed() {
        // Mirrors `alignment.test.ts`: gap = (250-100)/2 = 75.
        let (mut doc, _) = doc_with(&[
            ("a", 0.0, 0.0, 50.0, 50.0),
            ("b", 100.0, 0.0, 50.0, 50.0),
            ("c", 250.0, 0.0, 50.0, 50.0),
        ]);
        let (outcome, _) = run(
            &mut doc,
            &mut DistributeElements::new(ids(&["a", "b", "c"]), DistributeAxis::Horizontal),
        );
        assert!(outcome.changed);
        assert_eq!(outcome.affected.len(), 3);
        assert_eq!(doc.get("a").unwrap().base().x, 0.0);
        assert_eq!(doc.get("b").unwrap().base().x, 125.0);
        assert_eq!(doc.get("c").unwrap().base().x, 250.0);
    }

    #[test]
    fn distribute_vertical_equalizes_gaps_outer_fixed() {
        let (mut doc, _) = doc_with(&[
            ("a", 0.0, 0.0, 50.0, 50.0),
            ("b", 0.0, 100.0, 50.0, 50.0),
            ("c", 0.0, 250.0, 50.0, 50.0),
        ]);
        run(
            &mut doc,
            &mut DistributeElements::new(ids(&["a", "b", "c"]), DistributeAxis::Vertical),
        );
        assert_eq!(doc.get("a").unwrap().base().y, 0.0);
        assert_eq!(doc.get("b").unwrap().base().y, 125.0);
        assert_eq!(doc.get("c").unwrap().base().y, 250.0);
    }

    #[test]
    fn distribute_sorts_by_leading_edge() {
        // Input order shuffled; outer elements are still the spatial extremes.
        let (mut doc, _) = doc_with(&[
            ("a", 250.0, 0.0, 50.0, 50.0),
            ("b", 0.0, 0.0, 50.0, 50.0),
            ("c", 100.0, 0.0, 50.0, 50.0),
        ]);
        run(
            &mut doc,
            &mut DistributeElements::new(ids(&["a", "b", "c"]), DistributeAxis::Horizontal),
        );
        assert_eq!(doc.get("b").unwrap().base().x, 0.0);
        assert_eq!(doc.get("c").unwrap().base().x, 125.0);
        assert_eq!(doc.get("a").unwrap().base().x, 250.0);
    }

    #[test]
    fn distribute_with_fewer_than_three_is_a_noop() {
        let (mut doc, _) = doc_with(&[("a", 0.0, 0.0, 50.0, 50.0), ("b", 100.0, 0.0, 50.0, 50.0)]);
        let nonce_before = doc.scene_nonce();
        let (outcome, entry) = run(
            &mut doc,
            &mut DistributeElements::new(ids(&["a", "b"]), DistributeAxis::Horizontal),
        );
        assert!(!outcome.changed);
        assert!(entry.is_empty());
        assert_eq!(doc.get("a").unwrap().base().x, 0.0);
        assert_eq!(doc.get("b").unwrap().base().x, 100.0);
        assert_eq!(doc.scene_nonce(), nonce_before);
    }

    #[test]
    fn distribute_counts_valid_elements_only() {
        // Three ids, but one is deleted: only two valid remain -> no-op.
        let (mut doc, _) = doc_with(&[
            ("a", 0.0, 0.0, 50.0, 50.0),
            ("b", 100.0, 0.0, 50.0, 50.0),
            ("c", 250.0, 0.0, 50.0, 50.0),
        ]);
        doc.soft_delete("c").unwrap();
        let (outcome, _) = run(
            &mut doc,
            &mut DistributeElements::new(ids(&["a", "b", "c"]), DistributeAxis::Horizontal),
        );
        assert!(!outcome.changed);
        assert_eq!(doc.get("b").unwrap().base().x, 100.0);
    }
}
