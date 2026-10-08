//! Flex-like auto-layout for frames.
//!
//! TS source: `packages/core/src/interaction/auto-layout.ts`
//! (direction/gap/padding/align/fill/hug; constraints ignored while
//! auto-layout runs — pinned by `auto-layout.test.ts`).
//!
//! Read-only planning is pure: [`compute_auto_layout_positions`] takes frame
//! geometry plus a slice of [`ChildLayoutInput`] and returns
//! [`AutoLayoutResult`] with no document access, so the math is testable
//! without a [`Document`](crate::document::Document). Mutation goes through
//! the [`ApplyAutoLayout`] [`Command`]: it reads the frame's
//! [`AutoLayoutConfig`], gathers children via
//! [`frame_children`](crate::frame::frame_children) (skipping unknown and
//! deleted ones), plans everything, validates, then stores via
//! [`CommandContext`] with child constraints ignored while layout runs (TS
//! parity). The horizontal/vertical branches share one primary/counter-axis
//! core instead of two near-identical code paths.

use crate::command::{Command, CommandContext, CommandOutcome};
use crate::document::Document;
use crate::element::{
    AutoLayoutConfig, ChildLayoutSizing, CounterAxisAlign, Element, ElementId, FrameSizing,
    LayoutDirection, PrimaryAxisAlign,
};
use crate::frame::frame_children;
use crate::{EngineError, EngineResult};

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/// Minimum width/height a layout pass may produce (TS `Math.max(1, …)`).
pub const MIN_LAYOUT_SIZE: f64 = 1.0;

// ---------------------------------------------------------------------------
// Pure planning types
// ---------------------------------------------------------------------------

/// One child's measured size entering the layout pass.
#[derive(Debug, Clone, PartialEq)]
pub struct ChildLayoutInput {
    /// Child identity.
    pub id: ElementId,
    /// Current width in scene units.
    pub width: f64,
    /// Current height in scene units.
    pub height: f64,
    /// `true` when the child fills remaining primary-axis space.
    pub fill: bool,
}

impl ChildLayoutInput {
    /// Builds one layout input.
    pub fn new(id: ElementId, width: f64, height: f64, fill: bool) -> Self {
        Self {
            id,
            width,
            height,
            fill,
        }
    }
}

/// Computed scene-space box for one child.
#[derive(Debug, Clone, PartialEq)]
pub struct ChildLayoutOutput {
    /// Child identity.
    pub id: ElementId,
    /// New top-left x in scene coordinates.
    pub x: f64,
    /// New top-left y in scene coordinates.
    pub y: f64,
    /// New width in scene units.
    pub width: f64,
    /// New height in scene units.
    pub height: f64,
}

/// Full layout pass result: per-child boxes plus the hug frame size.
#[derive(Debug, Clone, PartialEq)]
pub struct AutoLayoutResult {
    /// Per-child boxes, in input order.
    pub children: Vec<ChildLayoutOutput>,
    /// New `(width, height)` for the frame when `sizing == Hug`;
    /// `None` for fixed frames and for empty input.
    pub frame_size: Option<(f64, f64)>,
}

// ---------------------------------------------------------------------------
// Pure layout computation
// ---------------------------------------------------------------------------

/// Computes auto-layout boxes for frame children.
///
/// Positions are scene-space (frame origin + padding + primary offset).
/// `fill` children split the leftover primary-axis space equally;
/// `stretch` counter alignment expands children across the counter axis;
/// the hug size (when `config.sizing` is [`FrameSizing::Hug`]) is derived
/// from the *computed* child boxes, matching the TS pass that re-reads
/// children after positioning them.
///
/// Returns an [`EngineError::InvalidInput`] when frame geometry, gap,
/// padding, or child sizes are non-finite. Empty input yields empty
/// children and no frame size (the command reports that as a no-op).
pub fn compute_auto_layout_positions(
    frame_x: f64,
    frame_y: f64,
    frame_width: f64,
    frame_height: f64,
    config: &AutoLayoutConfig,
    children: &[ChildLayoutInput],
) -> EngineResult<AutoLayoutResult> {
    for (what, value) in [
        ("frame x", frame_x),
        ("frame y", frame_y),
        ("frame width", frame_width),
        ("frame height", frame_height),
        ("layout gap", config.gap),
        ("padding top", config.padding.top),
        ("padding right", config.padding.right),
        ("padding bottom", config.padding.bottom),
        ("padding left", config.padding.left),
    ] {
        if !value.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "auto-layout {what} must be finite, got {value}"
            )));
        }
    }
    for child in children {
        if !child.width.is_finite() || !child.height.is_finite() {
            return Err(EngineError::InvalidInput(format!(
                "auto-layout child '{}' size must be finite, got ({}, {})",
                child.id.as_str(),
                child.width,
                child.height
            )));
        }
    }
    if children.is_empty() {
        return Ok(AutoLayoutResult {
            children: Vec::new(),
            frame_size: None,
        });
    }

    let is_horizontal = config.direction == LayoutDirection::Horizontal;
    let pad = &config.padding;
    // Primary axis runs along the flow; counter axis across it.
    let (pad_primary_start, pad_counter_start) = if is_horizontal {
        (pad.left, pad.top)
    } else {
        (pad.top, pad.left)
    };
    let available_primary = if is_horizontal {
        frame_width - pad.left - pad.right
    } else {
        frame_height - pad.top - pad.bottom
    };
    let available_counter = if is_horizontal {
        frame_height - pad.top - pad.bottom
    } else {
        frame_width - pad.left - pad.right
    };
    let primary_size = |child: &ChildLayoutInput| -> f64 {
        if is_horizontal {
            child.width
        } else {
            child.height
        }
    };
    let counter_size = |child: &ChildLayoutInput| -> f64 {
        if is_horizontal {
            child.height
        } else {
            child.width
        }
    };

    // Fixed children keep their size; fill children split the leftover.
    let fixed_count = children.iter().filter(|child| !child.fill).count();
    let fill_count = children.len() - fixed_count;
    let mut total_fixed_size = 0.0;
    for child in children.iter().filter(|child| !child.fill) {
        total_fixed_size += primary_size(child);
    }
    if config.primary_axis_align != PrimaryAxisAlign::SpaceBetween && fixed_count > 0 {
        total_fixed_size += config.gap * (fixed_count as f64 - 1.0);
    }
    let fill_space = (available_primary - total_fixed_size).max(0.0);
    let fill_size = if fill_count > 0 {
        fill_space / fill_count as f64
    } else {
        0.0
    };
    let child_primary = |child: &ChildLayoutInput| -> f64 {
        if child.fill {
            fill_size
        } else {
            primary_size(child)
        }
    };

    // Primary-axis offsets, relative to the padded content origin.
    let mut positions: Vec<f64> = Vec::with_capacity(children.len());
    if config.primary_axis_align == PrimaryAxisAlign::SpaceBetween {
        let gap_space = (available_primary - total_fixed_size).max(0.0);
        let gap_count = (children.len() as f64 - 1.0).max(1.0);
        let even_gap = gap_space / gap_count;
        let mut cursor = 0.0;
        for (index, child) in children.iter().enumerate() {
            positions.push(cursor);
            cursor += child_primary(child);
            if index + 1 < children.len() {
                cursor += even_gap;
            }
        }
    } else {
        let total_content = total_fixed_size + fill_count as f64 * fill_size;
        let offset = match config.primary_axis_align {
            PrimaryAxisAlign::Start => 0.0,
            PrimaryAxisAlign::Center => ((available_primary - total_content) / 2.0).max(0.0),
            PrimaryAxisAlign::End => (available_primary - total_content).max(0.0),
            // Handled by the branch above; unreachable here.
            PrimaryAxisAlign::SpaceBetween => 0.0,
        };
        let mut cursor = offset;
        for child in children {
            positions.push(cursor);
            cursor += child_primary(child) + config.gap;
        }
    }

    // Combine primary offsets with counter-axis alignment into final boxes.
    let mut outputs: Vec<ChildLayoutOutput> = Vec::with_capacity(children.len());
    for (child, primary_pos) in children.iter().zip(positions.iter()) {
        let (counter_pos, counter_len) = match config.counter_axis_align {
            CounterAxisAlign::Start => (pad_counter_start, counter_size(child)),
            CounterAxisAlign::Center => (
                pad_counter_start + (available_counter - counter_size(child)) / 2.0,
                counter_size(child),
            ),
            CounterAxisAlign::End => (
                pad_counter_start + available_counter - counter_size(child),
                counter_size(child),
            ),
            CounterAxisAlign::Stretch => (pad_counter_start, available_counter),
        };
        let (x, y, width, height) = if is_horizontal {
            (
                frame_x + pad_primary_start + *primary_pos,
                frame_y + counter_pos,
                child_primary(child).max(MIN_LAYOUT_SIZE),
                counter_len.max(MIN_LAYOUT_SIZE),
            )
        } else {
            (
                frame_x + counter_pos,
                frame_y + pad_primary_start + *primary_pos,
                counter_len.max(MIN_LAYOUT_SIZE),
                child_primary(child).max(MIN_LAYOUT_SIZE),
            )
        };
        outputs.push(ChildLayoutOutput {
            id: child.id.clone(),
            x,
            y,
            width,
            height,
        });
    }

    // Hug frames shrink-wrap the computed children (TS parity: the TS pass
    // re-reads stored children, which carry exactly these boxes).
    let frame_size = if config.sizing == FrameSizing::Hug {
        let mut primary_total = 0.0;
        let mut max_counter: f64 = 0.0;
        for (index, output) in outputs.iter().enumerate() {
            let (primary_len, counter_len) = if is_horizontal {
                (output.width, output.height)
            } else {
                (output.height, output.width)
            };
            primary_total += primary_len;
            if index + 1 < outputs.len() {
                primary_total += config.gap;
            }
            max_counter = max_counter.max(counter_len);
        }
        let (new_w, new_h) = if is_horizontal {
            (
                primary_total + pad.left + pad.right,
                max_counter + pad.top + pad.bottom,
            )
        } else {
            (
                max_counter + pad.left + pad.right,
                primary_total + pad.top + pad.bottom,
            )
        };
        Some((new_w.max(MIN_LAYOUT_SIZE), new_h.max(MIN_LAYOUT_SIZE)))
    } else {
        None
    };

    Ok(AutoLayoutResult {
        children: outputs,
        frame_size,
    })
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/// Applies a frame's auto-layout config to its direct children.
///
/// Skips unknown ids, deleted frames/children, non-frame targets, frames
/// without an auto-layout config, and childless frames — all as no-op
/// successes (TS parity: the TS pass returns silently in those cases).
/// Hug frames are resized to fit the laid-out children. Every next state
/// is built and validated before the first store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyAutoLayout {
    /// Frame whose auto-layout config runs.
    pub frame_id: ElementId,
}

impl ApplyAutoLayout {
    /// Builds an auto-layout command for the given frame.
    pub fn new(frame_id: ElementId) -> Self {
        Self { frame_id }
    }
}

/// Reads the frame geometry and config needed by [`ApplyAutoLayout`].
///
/// Returns `None` when the id is unknown, deleted, not a frame, or has no
/// auto-layout config (all no-op cases).
fn layout_frame_source(
    doc: &Document,
    frame_id: &ElementId,
) -> Option<(f64, f64, f64, f64, AutoLayoutConfig)> {
    let element = doc.get(frame_id.as_str())?;
    if element.base().is_deleted {
        return None;
    }
    let Element::Frame(frame) = element else {
        return None;
    };
    let config = frame.auto_layout.clone()?;
    let base = element.base();
    Some((base.x, base.y, base.width, base.height, config))
}

impl Command for ApplyAutoLayout {
    fn label(&self) -> &str {
        "auto-layout"
    }

    fn execute(&mut self, ctx: &mut CommandContext) -> EngineResult<CommandOutcome> {
        let Some((frame_x, frame_y, frame_w, frame_h, config)) =
            layout_frame_source(ctx.doc(), &self.frame_id)
        else {
            return Ok(CommandOutcome::default());
        };
        let mut inputs = Vec::new();
        for child_id in frame_children(ctx.doc(), self.frame_id.as_str()) {
            let Some(element) = ctx.doc().get(child_id.as_str()) else {
                continue;
            };
            if element.base().is_deleted {
                continue;
            }
            let base = element.base();
            inputs.push(ChildLayoutInput::new(
                child_id,
                base.width,
                base.height,
                base.child_layout_sizing == Some(ChildLayoutSizing::Fill),
            ));
        }
        if inputs.is_empty() {
            return Ok(CommandOutcome::default());
        }
        let result =
            compute_auto_layout_positions(frame_x, frame_y, frame_w, frame_h, &config, &inputs)?;

        // Build and validate every next state before storing any, so a
        // single invalid child aborts the whole layout.
        let mut pending: Vec<Element> = Vec::with_capacity(result.children.len() + 1);
        for output in &result.children {
            let Some(element) = ctx.doc().get(output.id.as_str()) else {
                continue;
            };
            let mut next = element.clone();
            {
                let base = next.base_mut();
                base.x = output.x;
                base.y = output.y;
                base.width = output.width;
                base.height = output.height;
            }
            next.validate()?;
            pending.push(next);
        }
        if let Some((new_w, new_h)) = result.frame_size {
            if let Some(frame) = ctx.doc().get(self.frame_id.as_str()) {
                let mut next = frame.clone();
                {
                    let base = next.base_mut();
                    base.width = new_w;
                    base.height = new_h;
                }
                next.validate()?;
                pending.push(next);
            }
        }
        // Store the validated states.
        let mut affected = Vec::with_capacity(pending.len());
        for next in pending {
            let id = next.id().clone();
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
    use crate::element::{
        create_frame, create_rectangle, CounterAxisAlign, CounterAxisAlign as Counter,
        CounterIdGenerator, FramePadding, LayoutDirection, PrimaryAxisAlign as Primary,
    };

    fn padding(all: f64) -> FramePadding {
        FramePadding {
            top: all,
            right: all,
            bottom: all,
            left: all,
        }
    }

    fn config(
        direction: LayoutDirection,
        gap: f64,
        primary: Primary,
        counter: Counter,
        sizing: FrameSizing,
    ) -> AutoLayoutConfig {
        AutoLayoutConfig {
            direction,
            gap,
            padding: padding(10.0),
            primary_axis_align: primary,
            counter_axis_align: counter,
            sizing,
        }
    }

    fn frame_with_layout(
        gen: &mut CounterIdGenerator,
        id: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        layout: Option<AutoLayoutConfig>,
    ) -> Element {
        let mut frame = create_frame(gen);
        frame.base.id = ElementId::of(id);
        frame.base.x = x;
        frame.base.y = y;
        frame.base.width = w;
        frame.base.height = h;
        frame.auto_layout = layout;
        Element::Frame(frame)
    }

    fn child(
        gen: &mut CounterIdGenerator,
        id: &str,
        w: f64,
        h: f64,
        frame_id: &str,
        fill: bool,
    ) -> Element {
        let mut rect = create_rectangle(gen);
        rect.base.id = ElementId::of(id);
        rect.base.x = 0.0;
        rect.base.y = 0.0;
        rect.base.width = w;
        rect.base.height = h;
        rect.base.frame_id = Some(ElementId::of(frame_id));
        if fill {
            rect.base.child_layout_sizing = Some(ChildLayoutSizing::Fill);
        }
        Element::Rectangle(rect)
    }

    fn doc_horizontal_start() -> (Document, CounterIdGenerator) {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 80.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 60.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "c", 100.0, 40.0, "f1", false))
            .unwrap();
        (doc, gen)
    }

    fn run(doc: &mut Document, frame_id: &str) -> CommandOutcome {
        let mut ctx = CommandContext::fresh(doc);
        let mut cmd = ApplyAutoLayout::new(ElementId::of(frame_id));
        let outcome = cmd.execute(&mut ctx).unwrap();
        // Keep the entry so tests can assert history collapse behavior.
        let entry = ctx.into_entry();
        assert_eq!(entry.is_empty(), !outcome.changed);
        outcome
    }

    #[test]
    fn horizontal_start_lays_out_left_to_right_with_gap() {
        let (mut doc, _) = doc_horizontal_start();
        let outcome = run(&mut doc, "f1");
        assert!(outcome.changed);
        assert_eq!(outcome.affected.len(), 3);
        let a = doc.get("a").unwrap();
        let b = doc.get("b").unwrap();
        let c = doc.get("c").unwrap();
        assert_eq!((a.base().x, a.base().y), (10.0, 10.0));
        assert_eq!(b.base().x, 100.0);
        assert_eq!(c.base().x, 170.0);
    }

    #[test]
    fn horizontal_center_offsets_content() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Center,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 80.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 60.0, 40.0, "f1", false))
            .unwrap();
        run(&mut doc, "f1");
        // Available 380, content 150, offset 115 -> a.x = 125, b.x = 215.
        assert_eq!(doc.get("a").unwrap().base().x, 125.0);
        assert_eq!(doc.get("b").unwrap().base().x, 215.0);
    }

    #[test]
    fn horizontal_end_pushes_content_right() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::End,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 80.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 60.0, 40.0, "f1", false))
            .unwrap();
        run(&mut doc, "f1");
        assert_eq!(doc.get("a").unwrap().base().x, 240.0);
        assert_eq!(doc.get("b").unwrap().base().x, 330.0);
    }

    #[test]
    fn space_between_spreads_even_gaps() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::SpaceBetween,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 80.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 60.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "c", 100.0, 40.0, "f1", false))
            .unwrap();
        run(&mut doc, "f1");
        // Available 380, fixed 240, gap space 140 -> 70 per gap.
        assert_eq!(doc.get("a").unwrap().base().x, 10.0);
        assert_eq!(doc.get("b").unwrap().base().x, 160.0);
        assert_eq!(doc.get("c").unwrap().base().x, 290.0);
    }

    #[test]
    fn vertical_start_lays_out_top_to_bottom() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Vertical,
            15.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            200.0,
            400.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 100.0, 50.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 100.0, 30.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "c", 100.0, 60.0, "f1", false))
            .unwrap();
        run(&mut doc, "f1");
        assert_eq!(doc.get("a").unwrap().base().y, 10.0);
        assert_eq!(doc.get("a").unwrap().base().x, 10.0);
        assert_eq!(doc.get("b").unwrap().base().y, 75.0);
        assert_eq!(doc.get("c").unwrap().base().y, 120.0);
    }

    #[test]
    fn counter_center_aligns_across_axis() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Vertical,
            10.0,
            Primary::Start,
            CounterAxisAlign::Center,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            200.0,
            400.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 60.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 120.0, 30.0, "f1", false))
            .unwrap();
        run(&mut doc, "f1");
        // Available W 180: a.x = 10 + 60 = 70, b.x = 10 + 30 = 40.
        assert_eq!(doc.get("a").unwrap().base().x, 70.0);
        assert_eq!(doc.get("b").unwrap().base().x, 40.0);
    }

    #[test]
    fn counter_stretch_expands_children() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Start,
            CounterAxisAlign::Stretch,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 80.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 60.0, 80.0, "f1", false))
            .unwrap();
        run(&mut doc, "f1");
        // Available H 180 -> both stretched.
        assert_eq!(doc.get("a").unwrap().base().height, 180.0);
        assert_eq!(doc.get("b").unwrap().base().height, 180.0);
        assert_eq!(doc.get("a").unwrap().base().y, 10.0);
    }

    #[test]
    fn fill_child_expands_to_remaining_space() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 100.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 50.0, 40.0, "f1", true))
            .unwrap();
        run(&mut doc, "f1");
        // Available 380, fixed 100 -> fill 280 at x = 120.
        assert_eq!(doc.get("a").unwrap().base().x, 10.0);
        assert_eq!(doc.get("a").unwrap().base().width, 100.0);
        assert_eq!(doc.get("b").unwrap().base().x, 120.0);
        assert_eq!(doc.get("b").unwrap().base().width, 280.0);
    }

    #[test]
    fn multiple_fill_children_split_space_equally() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 80.0, 40.0, "f1", true))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 80.0, 40.0, "f1", true))
            .unwrap();
        run(&mut doc, "f1");
        // Available 380, no fixed, two fill -> 190 each.
        assert_eq!(doc.get("a").unwrap().base().width, 190.0);
        assert_eq!(doc.get("b").unwrap().base().width, 190.0);
    }

    #[test]
    fn hug_frame_shrink_wraps_children_horizontal() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Hug,
        );
        layout.padding = FramePadding {
            top: 5.0,
            right: 5.0,
            bottom: 5.0,
            left: 5.0,
        };
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            50.0,
            50.0,
            400.0,
            400.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 100.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 80.0, 60.0, "f1", false))
            .unwrap();
        let outcome = run(&mut doc, "f1");
        assert!(outcome.changed);
        assert!(outcome.affected.contains(&ElementId::of("f1")));
        let frame = doc.get("f1").unwrap();
        // Width 5 + 100 + 10 + 80 + 5 = 200; height max(40,60) + 10 = 70.
        assert_eq!(frame.base().width, 200.0);
        assert_eq!(frame.base().height, 70.0);
    }

    #[test]
    fn hug_frame_shrink_wraps_children_vertical() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let mut layout = config(
            LayoutDirection::Vertical,
            10.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Hug,
        );
        layout.padding = FramePadding {
            top: 5.0,
            right: 5.0,
            bottom: 5.0,
            left: 5.0,
        };
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            50.0,
            50.0,
            400.0,
            400.0,
            Some(layout),
        ))
        .unwrap();
        doc.upsert(child(&mut gen, "a", 100.0, 40.0, "f1", false))
            .unwrap();
        doc.upsert(child(&mut gen, "b", 80.0, 60.0, "f1", false))
            .unwrap();
        run(&mut doc, "f1");
        let frame = doc.get("f1").unwrap();
        assert_eq!(frame.base().height, 120.0);
        assert_eq!(frame.base().width, 110.0);
    }

    #[test]
    fn skips_non_frame_missing_config_deleted_and_childless() {
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        doc.upsert(child(&mut gen, "plain", 50.0, 50.0, "nope", false))
            .unwrap();
        doc.upsert(frame_with_layout(
            &mut gen, "bare", 0.0, 0.0, 400.0, 200.0, None,
        ))
        .unwrap();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "empty",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        // Non-frame target, frame without config, ghost id, childless frame.
        for target in ["plain", "bare", "ghost", "empty"] {
            let outcome = run(&mut doc, target);
            assert!(!outcome.changed, "{target} must be a no-op");
        }
        doc.soft_delete("empty").unwrap();
        assert!(!run(&mut doc, "empty").changed);
    }

    #[test]
    fn pure_computation_rejects_non_finite_input() {
        let layout = config(
            LayoutDirection::Horizontal,
            f64::NAN,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        let children = [ChildLayoutInput::new(ElementId::of("a"), 50.0, 50.0, false)];
        let err =
            compute_auto_layout_positions(0.0, 0.0, 400.0, 200.0, &layout, &children).unwrap_err();
        assert!(matches!(err, EngineError::InvalidInput(_)));
    }

    #[test]
    fn child_constraints_are_ignored_by_layout() {
        // A max-pinned child still lands at the padded start, not the edge.
        let mut gen = CounterIdGenerator::new();
        let mut doc = Document::new();
        let layout = config(
            LayoutDirection::Horizontal,
            10.0,
            Primary::Start,
            CounterAxisAlign::Start,
            FrameSizing::Fixed,
        );
        doc.upsert(frame_with_layout(
            &mut gen,
            "f1",
            0.0,
            0.0,
            400.0,
            200.0,
            Some(layout),
        ))
        .unwrap();
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of("a");
        rect.base.x = 300.0;
        rect.base.y = 100.0;
        rect.base.width = 80.0;
        rect.base.height = 40.0;
        rect.base.frame_id = Some(ElementId::of("f1"));
        rect.base.constraints = Some(crate::element::Constraints {
            horizontal: crate::element::ConstraintAnchor::Max,
            vertical: crate::element::ConstraintAnchor::Max,
        });
        doc.upsert(Element::Rectangle(rect)).unwrap();
        run(&mut doc, "f1");
        let a = doc.get("a").unwrap();
        assert_eq!((a.base().x, a.base().y), (10.0, 10.0));
    }
}
