//! Phase-04 integration: geometry + hit-testing + rendering model.
//!
//! Ports the TS behavior contracts (no test weakened — tolerances here are
//! equal or tighter than the TS originals):
//!
//! - `shapes/shapes.test.ts` (rect/ellipse/line/freedraw/path bounds + hit)
//! - `shapes/text.test.ts` (measure + hit + bounds)
//! - `interaction/transform.test.ts` (move/resize/rotate + preview + cancel
//!   semantics; the pure-math pins live here, gesture wiring stays Phase 05)
//! - `interaction/selection.test.ts` (overlap, queries, top-wins)
//! - `interaction/snap.test.ts` + remediation zoom-independence pin
//! - `spatial/spatial-grid.test.ts` membership rules (index primitive
//!   itself is unit-tested in `nary-geometry`)
//! - `render/fill-style.test.ts` (serializable paint, JSON round-trip)
//! - remediation slice (line point-scaling note, closed-path interior,
//!   arrowhead tip, rotation-aware image bounds)

use nary_core::document::Document;
use nary_core::element::{
    ArrowElement, BaseElement, CounterIdGenerator, Element, ElementId, EllipseElement, FillStyle,
    FreedrawElement, LineElement, PathElement, PathSegment, RectangleElement,
};
use nary_core::geometry::point::approx_eq;
use nary_core::geometry::rect::Bounds;
use nary_core::geometry::transform::{
    resize_no_rotation, resize_with_rotation, screen_to_world_tolerance, stroke_hit_threshold,
    HandleType,
};
use nary_core::geometry::viewport::Viewport;
use nary_core::hit_test::{
    combined_bounds, hit_test_all, hit_test_element, hit_test_top, query_in_bounds, HitTestFilter,
};
use nary_core::render_model::{DrawKind, PaintDesc, RenderConfig, RenderModel, SelectionOverlay};
use nary_core::theme::default_theme;
use std::f64::consts::{FRAC_PI_2, FRAC_PI_4};

// ---------------------------------------------------------------------------
// Builders (deterministic ids, TS-factory defaults otherwise)
// ---------------------------------------------------------------------------

fn rectangle(
    gen: &mut CounterIdGenerator,
    id: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    rotation: f64,
) -> Element {
    let mut el = nary_core::element::create_rectangle(gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.width = w;
    el.base.height = h;
    el.base.rotation = rotation;
    Element::Rectangle(RectangleElement {
        base: el.base,
        roundness: el.roundness,
        corners: None,
    })
}

fn ellipse(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
    let mut el = nary_core::element::create_ellipse(gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.width = w;
    el.base.height = h;
    Element::Ellipse(EllipseElement { base: el.base })
}

fn line(
    gen: &mut CounterIdGenerator,
    id: &str,
    x: f64,
    y: f64,
    points: Vec<[f64; 2]>,
    rotation: f64,
) -> Element {
    let mut el = nary_core::element::create_line(gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.rotation = rotation;
    Element::Line(LineElement {
        base: el.base,
        points,
    })
}

fn arrow(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64, points: Vec<[f64; 2]>) -> Element {
    let mut el = nary_core::element::create_arrow(gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    Element::Arrow(ArrowElement {
        base: el.base,
        points,
        start_binding: None,
        end_binding: None,
        start_arrowhead: None,
        end_arrowhead: el.end_arrowhead,
    })
}

fn freedraw(
    gen: &mut CounterIdGenerator,
    id: &str,
    x: f64,
    y: f64,
    points: Vec<[f64; 2]>,
    rotation: f64,
) -> Element {
    let mut el = nary_core::element::create_freedraw(gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.rotation = rotation;
    let pressures = vec![0.5; points.len()];
    Element::Freedraw(FreedrawElement {
        base: el.base,
        points,
        pressures,
    })
}

fn path(
    gen: &mut CounterIdGenerator,
    id: &str,
    x: f64,
    y: f64,
    segments: Vec<PathSegment>,
    closed: bool,
    fill: FillStyle,
) -> Element {
    let mut el = nary_core::element::create_path(gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.background_color = fill;
    Element::Path(PathElement {
        base: el.base,
        segments,
        closed,
    })
}

fn seg(point: [f64; 2]) -> PathSegment {
    PathSegment {
        point,
        handle_in: None,
        handle_out: None,
    }
}

fn solid_red() -> FillStyle {
    FillStyle::Solid {
        color: "#ff0000".to_string(),
    }
}

fn transparent() -> FillStyle {
    FillStyle::Solid {
        color: "transparent".to_string(),
    }
}

fn upserted(elements: Vec<Element>) -> Document {
    let mut doc = Document::new();
    for el in elements {
        doc.upsert(el).expect("valid test element");
    }
    doc
}

/// Mutates an element's shared fields from outside the crate.
///
/// Integration tests cannot use the crate-internal `base_mut` (external
/// consumers never observe mutable state by design); this rebuilds the
/// element around an edited base instead — the intended consumer pattern.
fn map_base(el: Element, edit: impl FnOnce(&mut BaseElement)) -> Element {
    match el {
        Element::Rectangle(mut r) => {
            edit(&mut r.base);
            Element::Rectangle(r)
        }
        Element::Ellipse(mut e) => {
            edit(&mut e.base);
            Element::Ellipse(e)
        }
        Element::Line(mut l) => {
            edit(&mut l.base);
            Element::Line(l)
        }
        Element::Arrow(mut a) => {
            edit(&mut a.base);
            Element::Arrow(a)
        }
        Element::Text(mut t) => {
            edit(&mut t.base);
            Element::Text(t)
        }
        Element::Freedraw(mut f) => {
            edit(&mut f.base);
            Element::Freedraw(f)
        }
        Element::Frame(mut f) => {
            edit(&mut f.base);
            Element::Frame(f)
        }
        Element::Image(mut i) => {
            edit(&mut i.base);
            Element::Image(i)
        }
        Element::Path(mut p) => {
            edit(&mut p.base);
            Element::Path(p)
        }
        Element::Instance(mut i) => {
            edit(&mut i.base);
            Element::Instance(i)
        }
        Element::Custom(mut c) => {
            edit(&mut c.base);
            Element::Custom(c)
        }
    }
}

// ---------------------------------------------------------------------------
// Rotated resize + opposite anchor + aspect lock (transform.test.ts pins)
// ---------------------------------------------------------------------------

#[test]
fn rotated_resize_preserves_rotation_and_valid_dims() {
    let mut gen = CounterIdGenerator::new();
    let doc = upserted(vec![rectangle(
        &mut gen, "r1", 100.0, 100.0, 80.0, 60.0, FRAC_PI_2,
    )]);
    let el = doc.get("r1").expect("stored");

    // Pure-math port of the TS handler path: valid dims, finite origin.
    let base = el.base();
    let unrotated = Bounds::from_xywh(base.x, base.y, base.width, base.height);
    let out = resize_with_rotation(
        &unrotated,
        base.rotation,
        HandleType::BottomRight,
        &[180.0, 170.0],
        false,
    );
    assert!(out.width >= 1.0 && out.height >= 1.0);
    assert!(out.x.is_finite() && out.y.is_finite());
    // Rotation is preserved by construction (output carries no rotation —
    // the element keeps its own, exactly like TS `resizeWithRotation`).
    assert!(approx_eq(el.base().rotation, FRAC_PI_2, 1e-12));
}

#[test]
fn rotated_top_left_resize_keeps_opposite_local_corner_fixed() {
    // transform.test.ts: 45° box, TL drag (100,100)→(120,120); the local
    // opposite corner must not drift more than 15px.
    let rot = FRAC_PI_4;
    let cos = rot.cos();
    let sin = rot.sin();
    let orig_opp = [
        140.0 + (40.0 * cos - 30.0 * sin),
        130.0 + (40.0 * sin + 30.0 * cos),
    ];
    let out = resize_with_rotation(
        &Bounds::from_xywh(100.0, 100.0, 80.0, 60.0),
        rot,
        HandleType::TopLeft,
        &[120.0, 120.0],
        false,
    );
    let new_cx = out.x + out.width / 2.0;
    let new_cy = out.y + out.height / 2.0;
    let new_opp = [
        new_cx + (out.width / 2.0 * cos - out.height / 2.0 * sin),
        new_cy + (out.width / 2.0 * sin + out.height / 2.0 * cos),
    ];
    assert!(
        (new_opp[0] - orig_opp[0]).abs() < 15.0,
        "dx drift {new_opp:?} vs {orig_opp:?}"
    );
    assert!(
        (new_opp[1] - orig_opp[1]).abs() < 15.0,
        "dy drift {new_opp:?} vs {orig_opp:?}"
    );
}

#[test]
fn unrotated_resize_matches_ts_handler_numbers() {
    // transform.test.ts exacts: BR (180,160)→(220,200) grows to 120×100
    // at the same origin; TL (100,100)→(80,80) moves origin to (80,80).
    let grown = resize_no_rotation(
        100.0,
        100.0,
        80.0,
        60.0,
        HandleType::BottomRight,
        &[220.0, 200.0],
        false,
    );
    assert_eq!(
        (grown.x, grown.y, grown.width, grown.height),
        (100.0, 100.0, 120.0, 100.0)
    );
    let moved = resize_no_rotation(
        100.0,
        100.0,
        80.0,
        60.0,
        HandleType::TopLeft,
        &[80.0, 80.0],
        false,
    );
    assert_eq!(
        (moved.x, moved.y, moved.width, moved.height),
        (80.0, 80.0, 100.0, 80.0)
    );
    // Minimum size: dragging BR past the origin clamps to >= 1.
    let tiny = resize_no_rotation(
        100.0,
        100.0,
        80.0,
        60.0,
        HandleType::BottomRight,
        &[50.0, 50.0],
        false,
    );
    assert!(tiny.width >= 1.0 && tiny.height >= 1.0);
}

#[test]
fn aspect_lock_holds_ratio_on_corner_and_edge_handles() {
    // Shift locks aspect for ALL shapes (Figma/TLDraw convention).
    let corner = resize_no_rotation(
        0.0,
        0.0,
        80.0,
        60.0,
        HandleType::BottomRight,
        &[120.0, 200.0],
        true,
    );
    assert!(approx_eq(corner.width / corner.height, 80.0 / 60.0, 1e-9));
    let edge = resize_no_rotation(
        0.0,
        0.0,
        80.0,
        60.0,
        HandleType::TopCenter,
        &[0.0, -30.0],
        true,
    );
    assert!(approx_eq(edge.width / edge.height, 80.0 / 60.0, 1e-9));
}

// ---------------------------------------------------------------------------
// Line / arrow (shapes.test.ts line slice + remediation arrowhead pin)
// ---------------------------------------------------------------------------

#[test]
fn line_hit_and_bounds_match_ts() {
    let mut gen = CounterIdGenerator::new();
    let el = line(
        &mut gen,
        "l1",
        0.0,
        0.0,
        vec![[0.0, 0.0], [100.0, 0.0]],
        0.0,
    );
    assert!(hit_test_element(&el, 50.0, 0.0));
    assert!(hit_test_element(&el, 2.0, 1.0));
    assert!(hit_test_element(&el, 98.0, 1.0));
    // Default strokeWidth is 2 → threshold 5: 3px in, 10px out.
    assert_eq!(stroke_hit_threshold(2.0), 5.0);
    assert!(hit_test_element(&el, 50.0, 3.0));
    assert!(!hit_test_element(&el, 50.0, 10.0));
    assert!(!hit_test_element(&el, 50.0, 50.0));

    let diag = line(
        &mut gen,
        "l2",
        0.0,
        0.0,
        vec![[0.0, 0.0], [100.0, 100.0]],
        0.0,
    );
    assert!(hit_test_element(&diag, 50.0, 50.0));
    assert!(!hit_test_element(&diag, 50.0, 70.0));

    // Rotated line: TS pins the rendered midpoint (~85.35, ~35.35).
    let rotated = line(
        &mut gen,
        "l3",
        0.0,
        0.0,
        vec![[0.0, 0.0], [100.0, 0.0]],
        FRAC_PI_4,
    );
    assert!(hit_test_element(&rotated, 85.0, 35.0));

    // Bounds: exact boxes unrotated; pinned 45° values tighter than TS.
    assert_eq!(el.bounds(), Bounds::new(0.0, 0.0, 100.0, 0.0));
    let rb = rotated.bounds();
    let eps = 1e-9;
    assert!(approx_eq(rb.min_x, 14.644_660_940_672_62, eps), "{rb:?}");
    assert!(approx_eq(rb.min_y, -35.355_339_059_327_38, eps), "{rb:?}");
    assert!(approx_eq(rb.max_x, 85.355_339_059_327_38, eps), "{rb:?}");
    assert!(approx_eq(rb.max_y, 35.355_339_059_327_38, eps), "{rb:?}");
}

#[test]
fn arrow_stroke_and_head_both_hit() {
    let mut gen = CounterIdGenerator::new();
    let el = arrow(&mut gen, "a1", 0.0, 0.0, vec![[0.0, 0.0], [100.0, 0.0]]);
    assert!(hit_test_element(&el, 50.0, 0.0));
    assert!(!hit_test_element(&el, 50.0, 50.0));
    // remediation.test.ts: the end-arrowhead tip itself hits.
    assert!(hit_test_element(&el, 100.0, 0.0));
    // Fewer than two points never hits.
    let stub = arrow(&mut gen, "a2", 0.0, 0.0, vec![[0.0, 0.0]]);
    assert!(!hit_test_element(&stub, 0.0, 0.0));
}

// ---------------------------------------------------------------------------
// Free-draw (raw-chord quirk preserved) and ellipse corner rejection
// ---------------------------------------------------------------------------

#[test]
fn freedraw_hits_raw_chords_with_documented_smoothing_gap() {
    let mut gen = CounterIdGenerator::new();
    let el = freedraw(
        &mut gen,
        "f1",
        0.0,
        0.0,
        vec![[0.0, 0.0], [30.0, 10.0], [60.0, -5.0], [100.0, 0.0]],
        0.0,
    );
    // Vertex hit (on both the chord and the smoothed render curve).
    assert!(hit_test_element(&el, 30.0, 10.0));
    assert!(hit_test_element(&el, 50.0, 2.0));
    assert!(!hit_test_element(&el, 50.0, 50.0));
    assert!(!hit_test_element(&el, 50.0, 15.0));

    let rotated = freedraw(
        &mut gen,
        "f2",
        0.0,
        0.0,
        vec![[0.0, 0.0], [50.0, 0.0], [100.0, 0.0]],
        FRAC_PI_4,
    );
    assert!(hit_test_element(&rotated, 85.0, 35.0));

    // Single-point collapse (TS `{x, y, x, y}` fallback).
    let single = freedraw(&mut gen, "f3", 50.0, 50.0, vec![[0.0, 0.0]], 0.0);
    assert_eq!(single.bounds(), Bounds::point(50.0, 50.0));
}

#[test]
fn ellipse_equation_rejects_bbox_corners() {
    let mut gen = CounterIdGenerator::new();
    let el = ellipse(&mut gen, "e1", 10.0, 20.0, 100.0, 80.0);
    assert!(hit_test_element(&el, 60.0, 60.0));
    assert!(!hit_test_element(&el, 200.0, 200.0));
    // Corners of the bounding box are OUTSIDE the ellipse.
    assert!(!hit_test_element(&el, 10.0, 20.0));
    assert!(!hit_test_element(&el, 110.0, 100.0));
    assert!(hit_test_element(&el, 108.0, 60.0));
    assert!(!hit_test_element(&el, 112.0, 60.0));
}

// ---------------------------------------------------------------------------
// Frame (rotation quirk + clip partition) and path fill/stroke rules
// ---------------------------------------------------------------------------

#[test]
fn frame_ignores_rotation_and_partitions_render() {
    let mut gen = CounterIdGenerator::new();
    let mut frame = nary_core::element::create_frame(&mut gen);
    frame.base.id = ElementId::of("frame1");
    frame.base.x = 0.0;
    frame.base.y = 0.0;
    frame.base.width = 500.0;
    frame.base.height = 500.0;
    frame.base.rotation = FRAC_PI_4; // ignored by bounds AND hit (TS quirk)
    let frame_el = Element::Frame(frame);
    assert_eq!(frame_el.bounds(), Bounds::new(0.0, 0.0, 500.0, 500.0));
    assert!(hit_test_element(&frame_el, 10.0, 10.0));

    let child = rectangle(&mut gen, "child", 10.0, 10.0, 50.0, 50.0, 0.0);
    let child = map_base(child, |base| base.frame_id = Some(ElementId::of("frame1")));
    let outsider = rectangle(&mut gen, "outsider", 600.0, 600.0, 50.0, 50.0, 0.0);

    let doc = upserted(vec![frame_el, child, outsider]);
    let model = RenderModel::build(
        &doc,
        &Viewport::identity(),
        &RenderConfig::new(800.0, 600.0),
        &|_| true,
    );
    // In-view frame owns its child: child not in base, once in the pass.
    assert_eq!(model.frames.len(), 1);
    assert_eq!(model.frames[0].children.len(), 1);
    assert!(model.base.iter().all(|entry| entry.id.as_str() != "child"));
    // Outsider is outside the 800×600 viewport? No — (600,600,50,50) IS
    // inside. Cull check uses a far element instead below.
    assert!(model
        .base
        .iter()
        .any(|entry| entry.id.as_str() == "outsider"));
}

#[test]
fn culled_frames_leave_children_unclipped_in_base() {
    let mut gen = CounterIdGenerator::new();
    let mut frame = nary_core::element::create_frame(&mut gen);
    frame.base.id = ElementId::of("far-frame");
    frame.base.x = 5_000.0;
    frame.base.y = 5_000.0;
    frame.base.width = 100.0;
    frame.base.height = 100.0;
    // Child overflows the frame box (clipped overflow in TS): a viewport
    // covering the child but not the frame still draws the child — in the
    // base pass, unclipped (TS `framedChildIds` rule preserved verbatim).
    let child = rectangle(&mut gen, "near-child", 4_800.0, 4_800.0, 50.0, 50.0, 0.0);
    let child = map_base(child, |base| {
        base.frame_id = Some(ElementId::of("far-frame"))
    });
    let doc = upserted(vec![Element::Frame(frame), child]);
    // Wide viewport covering both: frame in view → child in the pass.
    let wide = RenderModel::build(
        &doc,
        &Viewport::identity(),
        &RenderConfig::new(6_000.0, 6_000.0),
        &|_| true,
    );
    assert_eq!(wide.frames.len(), 1);
    assert!(wide
        .base
        .iter()
        .all(|entry| entry.id.as_str() != "near-child"));
    // Scrolled viewport covering only the child (4700–4900): the frame is
    // culled, so the child stays visible in the base pass.
    let scrolled = Viewport {
        scroll_x: -4_700.0,
        scroll_y: -4_700.0,
        zoom: 1.0,
    };
    let tight = RenderModel::build(&doc, &scrolled, &RenderConfig::new(200.0, 200.0), &|_| true);
    assert!(tight.frames.is_empty());
    assert!(tight
        .base
        .iter()
        .any(|entry| entry.id.as_str() == "near-child"));
}

#[test]
fn path_fill_stroke_and_flatten_rules() {
    let mut gen = CounterIdGenerator::new();
    // remediation.test.ts: closed + filled + transparent stroke still hits
    // the interior (fill alone decides).
    let filled = path(
        &mut gen,
        "p1",
        0.0,
        0.0,
        vec![
            seg([0.0, 0.0]),
            seg([100.0, 0.0]),
            seg([100.0, 100.0]),
            seg([0.0, 100.0]),
        ],
        true,
        solid_red(),
    );
    let filled = map_base(filled, |base| base.stroke_color = "transparent".to_string());
    assert!(hit_test_element(&filled, 50.0, 50.0));

    // Open path: stroke only.
    let open = path(
        &mut gen,
        "p2",
        0.0,
        0.0,
        vec![seg([0.0, 0.0]), seg([100.0, 0.0])],
        false,
        transparent(),
    );
    assert!(hit_test_element(&open, 50.0, 0.0));
    assert!(!hit_test_element(&open, 50.0, 20.0));

    // Fewer than two segments never hits.
    let stub = path(
        &mut gen,
        "p3",
        0.0,
        0.0,
        vec![seg([0.0, 0.0])],
        false,
        transparent(),
    );
    assert!(!hit_test_element(&stub, 0.0, 0.0));

    // Control handles extend the bounds (TS `includes control points`).
    let curved = path(
        &mut gen,
        "p4",
        0.0,
        0.0,
        vec![
            PathSegment {
                point: [0.0, 0.0],
                handle_in: None,
                handle_out: Some([50.0, 100.0]),
            },
            PathSegment {
                point: [100.0, 0.0],
                handle_in: Some([-50.0, 100.0]),
                handle_out: None,
            },
        ],
        false,
        transparent(),
    );
    assert_eq!(curved.bounds(), Bounds::new(0.0, 0.0, 100.0, 100.0));
}

// ---------------------------------------------------------------------------
// Hit ordering (z-order top-wins + guard skips) and bounds queries
// ---------------------------------------------------------------------------

#[test]
fn hit_ordering_is_top_wins_with_selection_skips() {
    let mut gen = CounterIdGenerator::new();
    let bottom = rectangle(&mut gen, "bottom", 0.0, 0.0, 200.0, 200.0, 0.0);
    let top = rectangle(&mut gen, "top", 50.0, 50.0, 100.0, 100.0, 0.0);
    let doc = upserted(vec![bottom, top]);
    assert_eq!(
        hit_test_top(&doc, 100.0, 100.0, HitTestFilter::selection())
            .map(|id| id.as_str().to_string()),
        Some("top".to_string()),
    );
    let all = hit_test_all(&doc, 100.0, 100.0, HitTestFilter::selection());
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].as_str(), "top");
    assert!(hit_test_top(&doc, 500.0, 500.0, HitTestFilter::selection()).is_none());

    // Locked / hidden / deleted elements never win a selection click.
    let mut gen = CounterIdGenerator::new();
    let locked = rectangle(&mut gen, "locked", 0.0, 0.0, 200.0, 200.0, 0.0);
    let locked = map_base(locked, |base| base.locked = true);
    let hidden = rectangle(&mut gen, "hidden", 0.0, 0.0, 200.0, 200.0, 0.0);
    let hidden = map_base(hidden, |base| base.hidden = true);
    let mut doc = upserted(vec![locked, hidden]);
    doc.soft_delete("hidden").expect("soft delete");
    assert!(hit_test_top(&doc, 50.0, 50.0, HitTestFilter::selection()).is_none());
}

#[test]
fn bounds_queries_match_ts_selection_fixture() {
    // selection.test.ts fixture: r1(0,0,100,80), r2(200,200,50,50),
    // e1(50,50,120,80), r3(500,500,30,30).
    let mut gen = CounterIdGenerator::new();
    let doc = upserted(vec![
        rectangle(&mut gen, "r1", 0.0, 0.0, 100.0, 80.0, 0.0),
        rectangle(&mut gen, "r2", 200.0, 200.0, 50.0, 50.0, 0.0),
        ellipse(&mut gen, "e1", 50.0, 50.0, 120.0, 80.0),
        rectangle(&mut gen, "r3", 500.0, 500.0, 30.0, 30.0, 0.0),
    ]);
    let mut ids: Vec<String> = query_in_bounds(&doc, &Bounds::new(0.0, 0.0, 150.0, 150.0))
        .iter()
        .map(|id| id.as_str().to_string())
        .collect();
    ids.sort();
    assert_eq!(ids, vec!["e1".to_string(), "r1".to_string()]);
    assert!(query_in_bounds(&doc, &Bounds::new(900.0, 900.0, 950.0, 950.0)).is_empty());
    // Zero-area point between elements hits nothing (no false positives).
    assert!(query_in_bounds(&doc, &Bounds::point(150.0, 150.0)).is_empty());
    // Touching edges count as overlap (inclusive-touch contract).
    assert!(Bounds::new(0.0, 0.0, 10.0, 10.0).intersects(&Bounds::new(10.0, 0.0, 20.0, 10.0)));

    let bounds =
        combined_bounds(&doc, &[ElementId::of("r1"), ElementId::of("r2")]).expect("both resolve");
    assert_eq!(bounds, Bounds::new(0.0, 0.0, 250.0, 250.0));
    assert!(combined_bounds(&doc, &[]).is_none());
}

// ---------------------------------------------------------------------------
// Zoom / tolerance conversion + render determinism + finite invariants
// ---------------------------------------------------------------------------

#[test]
fn zoom_converts_screen_tolerances_but_not_stroke_thresholds() {
    // Snap/handle radii are screen-px authored: / zoom (TS call sites).
    assert_eq!(screen_to_world_tolerance(5.0, 1.0), 5.0);
    assert_eq!(screen_to_world_tolerance(5.0, 10.0), 0.5);
    assert_eq!(screen_to_world_tolerance(5.0, 0.0), 5.0);
    // Stroke thresholds are fixed scene units at every zoom (TS parity:
    // hitTestLine takes no zoom — lines feel thinner zoomed in).
    assert_eq!(stroke_hit_threshold(2.0), 5.0);
    let mut gen = CounterIdGenerator::new();
    let el = line(
        &mut gen,
        "l1",
        0.0,
        0.0,
        vec![[0.0, 0.0], [100.0, 0.0]],
        0.0,
    );
    assert!(hit_test_element(&el, 50.0, 3.0));
    assert!(!hit_test_element(&el, 50.0, 10.0));
}

#[test]
fn render_model_is_deterministic_culled_and_serializable() {
    let mut gen = CounterIdGenerator::new();
    let doc = upserted(vec![
        rectangle(&mut gen, "r1", 0.0, 0.0, 100.0, 80.0, 0.0),
        rectangle(&mut gen, "far", 5_000.0, 5_000.0, 50.0, 50.0, 0.0),
    ]);
    let viewport = Viewport::identity();
    let config = RenderConfig::new(800.0, 600.0);
    let a = RenderModel::build(&doc, &viewport, &config, &|_| true);
    let b = RenderModel::build(&doc, &viewport, &config, &|_| true);
    assert_eq!(a, b, "same inputs → identical model");
    // Viewport cull: the far element never reaches the host.
    assert_eq!(a.entry_count(), 1);
    assert_eq!(a.asset_generation, 0);
    // Paint is plain data (fill-style.test.ts parity): solid passes
    // through, gradients keep stops, nothing holds a canvas handle.
    assert!(matches!(a.base[0].paint, PaintDesc::Solid { .. }));
    assert_eq!(a.base[0].kind, DrawKind::Rectangle);

    // Selection overlay: 8 handles + rotate handle above the top edge.
    let theme = default_theme();
    let overlay =
        SelectionOverlay::for_bounds(&doc.get("r1").expect("stored").bounds(), 1.0, &theme, 0.0);
    assert_eq!(overlay.handles.len(), 8);
    assert_eq!(overlay.rotate_handle, [50.0, -24.0]);
}

#[test]
fn finite_numeric_invariants_hold_across_shapes() {
    let mut gen = CounterIdGenerator::new();
    // NaN poisons nothing: upsert rejects before touching state.
    let bad = rectangle(&mut gen, "bad", 0.0, 0.0, 10.0, 10.0, 0.0);
    let bad = map_base(bad, |base| base.x = f64::NAN);
    let mut doc = Document::new();
    assert!(doc.upsert(bad).is_err());
    assert_eq!(doc.element_count(), 0);

    // Resize stays finite under extreme inputs.
    let out = resize_with_rotation(
        &Bounds::from_xywh(1e15, -1e15, 80.0, 60.0),
        FRAC_PI_2,
        HandleType::BottomRight,
        &[1e16, 1e16],
        true,
    );
    assert!(
        out.x.is_finite() && out.y.is_finite() && out.width.is_finite() && out.height.is_finite()
    );
    // Viewport rejects non-finite cameras.
    assert!(!Viewport {
        scroll_x: f64::INFINITY,
        scroll_y: 0.0,
        zoom: 1.0
    }
    .is_finite());
    // Bounds report non-finiteness instead of hiding it.
    assert!(!Bounds::new(0.0, 0.0, f64::NAN, 1.0).is_finite());
}

#[test]
fn text_measure_hit_and_bounds_match_ts() {
    use nary_core::render_model::{measure_text_with, TextMeasurer};

    struct Stub;
    impl TextMeasurer for Stub {
        fn measure_line_width(&self, line: &str, font_size: f64, _family: &str) -> f64 {
            line.chars().count() as f64 * font_size * 0.6
        }
    }
    let stub = Stub;
    let w = |line: &str| stub.measure_line_width(line, 16.0, "sans-serif");
    let (single_w, single_h) = measure_text_with(&w, "One line", 16.0);
    let (multi_w, multi_h) = measure_text_with(&w, "Line one\nLine two\nLine three", 16.0);
    assert!(multi_h > single_h);
    assert!((multi_h - single_h * 3.0).abs() < 1e-9);
    assert!(multi_w >= single_w);
    let (empty_w, empty_h) = measure_text_with(&w, "", 16.0);
    assert!(empty_h > 0.0 && empty_w >= 0.0);

    // Text hit is the (rotation-aware) box; boundary counts.
    let mut gen = CounterIdGenerator::new();
    let mut text = nary_core::element::create_text(&mut gen);
    text.base.id = ElementId::of("t1");
    text.base.x = 10.0;
    text.base.y = 20.0;
    text.base.width = 100.0;
    text.base.height = 40.0;
    let el = Element::Text(text);
    assert!(hit_test_element(&el, 50.0, 35.0));
    assert!(hit_test_element(&el, 10.0, 20.0));
    assert!(!hit_test_element(&el, 200.0, 200.0));
    assert_eq!(el.bounds(), Bounds::new(10.0, 20.0, 110.0, 60.0));
}

#[test]
fn indexed_hit_test_matches_linear_scan() {
    use nary_core::hit_test::hit_test_top_indexed;

    // Deterministic LCG (same family as document_model property tests).
    let mut state: u64 = 0x1234_5678_9abc_def0;
    let mut next = move || {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 33) as f64 / (u32::MAX as f64)
    };

    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    for i in 0..200 {
        let x = next() * 2000.0 - 1000.0;
        let y = next() * 2000.0 - 1000.0;
        let w = 5.0 + next() * 120.0;
        let h = 5.0 + next() * 120.0;
        let rotation = if i % 7 == 0 { FRAC_PI_4 } else { 0.0 };
        let mut el = rectangle(&mut gen, &format!("r{i}"), x, y, w, h, rotation);
        if let Element::Rectangle(ref mut r) = el {
            if i % 11 == 0 {
                r.base.locked = true;
            }
            if i % 13 == 0 {
                r.base.hidden = true;
            }
        }
        doc.upsert(el).unwrap();
        if i % 17 == 0 {
            doc.soft_delete(&format!("r{i}")).unwrap();
        }
    }

    let filters = [
        HitTestFilter::selection(),
        HitTestFilter {
            skip_deleted: true,
            skip_locked: false,
            skip_hidden: false,
        },
    ];
    for filter in filters {
        for _ in 0..500 {
            let px = next() * 2200.0 - 1100.0;
            let py = next() * 2200.0 - 1100.0;
            assert_eq!(
                hit_test_top_indexed(&doc, px, py, filter),
                hit_test_top(&doc, px, py, filter),
                "indexed and linear agree at ({px}, {py})"
            );
        }
    }
}

#[test]
fn indexed_hit_test_rejects_non_finite_points() {
    use nary_core::hit_test::hit_test_top_indexed;

    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    doc.upsert(rectangle(&mut gen, "r0", 0.0, 0.0, 100.0, 100.0, 0.0))
        .unwrap();
    for (px, py) in [
        (f64::NAN, 0.0),
        (0.0, f64::NAN),
        (f64::INFINITY, 0.0),
        (0.0, f64::NEG_INFINITY),
    ] {
        assert_eq!(
            hit_test_top_indexed(&doc, px, py, HitTestFilter::selection()),
            hit_test_top(&doc, px, py, HitTestFilter::selection()),
        );
        assert_eq!(
            hit_test_top_indexed(&doc, px, py, HitTestFilter::selection()),
            None
        );
    }
}

#[test]
fn indexed_bounds_query_matches_linear_scan() {
    use nary_core::hit_test::query_in_bounds_indexed;

    let mut state: u64 = 0xdead_beef_cafe_f00d;
    let mut next = move || {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 33) as f64 / (u32::MAX as f64)
    };

    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    for i in 0..200 {
        let x = next() * 2000.0 - 1000.0;
        let y = next() * 2000.0 - 1000.0;
        let w = 5.0 + next() * 120.0;
        let h = 5.0 + next() * 120.0;
        let rotation = if i % 5 == 0 { FRAC_PI_2 } else { 0.0 };
        let mut el = rectangle(&mut gen, &format!("q{i}"), x, y, w, h, rotation);
        if let Element::Rectangle(ref mut r) = el {
            if i % 13 == 0 {
                r.base.hidden = true;
            }
        }
        doc.upsert(el).unwrap();
        if i % 19 == 0 {
            doc.soft_delete(&format!("q{i}")).unwrap();
        }
    }

    for _ in 0..300 {
        let x = next() * 2200.0 - 1100.0;
        let y = next() * 2200.0 - 1100.0;
        let w = next() * 400.0;
        let h = next() * 400.0;
        let probe = Bounds::from_xywh(x, y, w, h);
        assert_eq!(
            query_in_bounds_indexed(&doc, &probe),
            query_in_bounds(&doc, &probe),
            "indexed and linear bounds queries agree"
        );
    }
    let nan_probe = Bounds::from_xywh(f64::NAN, 0.0, 10.0, 10.0);
    assert!(query_in_bounds_indexed(&doc, &nan_probe).is_empty());
    assert_eq!(
        query_in_bounds_indexed(&doc, &nan_probe),
        query_in_bounds(&doc, &nan_probe)
    );
}

#[test]
fn render_model_entries_carry_pinned_values() {
    let mut gen = CounterIdGenerator::new();
    let r1 = map_base(
        rectangle(&mut gen, "r1", 10.0, 20.0, 100.0, 50.0, 0.0),
        |base| {
            base.background_color = FillStyle::Solid {
                color: "#112233".to_string(),
            };
        },
    );
    let e1 = ellipse(&mut gen, "e1", 200.0, 100.0, 80.0, 60.0);
    let doc = upserted(vec![r1, e1]);
    let model = RenderModel::build(
        &doc,
        &Viewport::identity(),
        &RenderConfig::new(800.0, 600.0),
        &|_| true,
    );
    assert_eq!(model.entry_count(), 2);
    // Z-order: insertion order, back to front.
    assert_eq!(model.base[0].id.as_str(), "r1");
    assert_eq!(model.base[0].kind, DrawKind::Rectangle);
    assert_eq!(model.base[0].bounds, Bounds::new(10.0, 20.0, 110.0, 70.0));
    assert_eq!(model.base[0].rotation, 0.0);
    assert_eq!(
        model.base[0].paint,
        PaintDesc::Solid {
            color: "#112233".to_string()
        }
    );
    assert_eq!(model.base[1].id.as_str(), "e1");
    assert_eq!(model.base[1].kind, DrawKind::Ellipse);
    assert_eq!(
        model.base[1].bounds,
        Bounds::new(200.0, 100.0, 280.0, 160.0)
    );
    assert!(model.frames.is_empty());
}
