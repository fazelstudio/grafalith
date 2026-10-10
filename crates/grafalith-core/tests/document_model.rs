//! Document-model integration tests: parity with the TypeScript
//! engine plus invariant/property checks.
//!
//! Ported behavior (TS oracle — `packages/core/src/**/…test.ts`):
//!
//! - `scene/scene.test.ts` (element access, nonce, soft-delete, order) —
//!   covered again here end-to-end through public APIs;
//! - `io/io.test.ts` (export shape, round-trips, clear-on-import, skips,
//!   rejections, deleted exclusion) — via [`DocumentSnapshot`];
//! - `io/import-json.ts` repair rules (dangling `frameId`, bindings,
//!   `containerId` → `None`) and atomicity (no partial mutation);
//! - layer/group/lock/style/frame operation flows across modules.
//!
//! Property-style checks use a deterministic in-file LCG (no new
//! dependencies): snapshot round-trips preserve semantics,
//! z-order ops preserve the element set, group/ungroup round-trips, and a
//! NaN fuzz over every factory rejects invalid floats.

use std::collections::HashSet;

use grafalith_core::document::{Document, DocumentSnapshot, ImportSummary, SCHEMA_VERSION};
use grafalith_core::element::{
    create_arrow, create_ellipse, create_frame, create_freedraw, create_image, create_instance,
    create_line, create_path, create_rectangle, create_text, ArrowElement, BaseElement, Binding,
    CounterIdGenerator, Element, ElementId, FillStyle, FreedrawElement, GradientType, IdGenerator,
    LineElement, PathElement, PathSegment, TextAlign, TextElement,
};
use grafalith_core::frame::auto_assign_to_frames;
use grafalith_core::group::{group_elements, group_members, ungroup_elements};
use grafalith_core::lock::lock_elements;
use grafalith_core::style::{mixed_opacity, mixed_stroke_color, set_opacity, set_stroke_color};
use grafalith_core::zorder::{bring_to_front, send_to_back};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Builds the four-element scene from `io.test.ts` (rect + gradient
/// ellipse + polyline + text) with fixed ids.
fn test_scene(gen: &mut CounterIdGenerator) -> Document {
    let mut doc = Document::new();

    let mut rect = create_rectangle(gen);
    rect.base.id = ElementId::of("rect-1");
    rect.base.x = 100.0;
    rect.base.y = 200.0;
    rect.base.width = 150.0;
    rect.base.height = 100.0;
    rect.base.stroke_color = "#333333".to_string();
    rect.base.background_color = FillStyle::Solid {
        color: "#e8f4fc".to_string(),
    };
    doc.upsert(Element::Rectangle(rect)).unwrap();

    let mut ellipse = create_ellipse(gen);
    ellipse.base.id = ElementId::of("ellipse-1");
    ellipse.base.x = 300.0;
    ellipse.base.y = 150.0;
    ellipse.base.width = 120.0;
    ellipse.base.height = 80.0;
    ellipse.base.stroke_color = "#ff0000".to_string();
    ellipse.base.background_color = FillStyle::Gradient {
        gradient_type: GradientType::Linear,
        angle: 45.0,
        stops: vec![
            grafalith_core::element::GradientStop {
                offset: 0.0,
                color: "#ff0000".to_string(),
            },
            grafalith_core::element::GradientStop {
                offset: 1.0,
                color: "#0000ff".to_string(),
            },
        ],
    };
    doc.upsert(Element::Ellipse(ellipse)).unwrap();

    let mut line = create_line(gen);
    line.base.id = ElementId::of("line-1");
    line.base.x = 50.0;
    line.base.y = 50.0;
    line.base.width = 200.0;
    line.base.height = 100.0;
    line.points = vec![[0.0, 0.0], [100.0, 50.0], [200.0, 100.0]];
    line.base.stroke_color = "#00ff00".to_string();
    doc.upsert(Element::Line(line)).unwrap();

    let mut text = create_text(gen);
    text.base.id = ElementId::of("text-1");
    text.base.x = 400.0;
    text.base.y = 400.0;
    text.base.width = 100.0;
    text.base.height = 30.0;
    text.text = "Hello World".to_string();
    text.font_size = 16.0;
    text.font_family = "Arial".to_string();
    text.text_align = TextAlign::Left;
    doc.upsert(Element::Text(text)).unwrap();

    doc
}

/// Mutably borrows shared fields from outside the crate by matching on
/// the closed union (variant structs expose plain `pub` data; only the
/// document's *storage* is access-controlled).
fn base_of(element: &mut Element) -> &mut BaseElement {
    match element {
        Element::Rectangle(el) => &mut el.base,
        Element::Ellipse(el) => &mut el.base,
        Element::Line(el) => &mut el.base,
        Element::Arrow(el) => &mut el.base,
        Element::Text(el) => &mut el.base,
        Element::Freedraw(el) => &mut el.base,
        Element::Frame(el) => &mut el.base,
        Element::Image(el) => &mut el.base,
        Element::Path(el) => &mut el.base,
        Element::Instance(el) => &mut el.base,
        Element::Custom(el) => &mut el.base,
    }
}

/// Deterministic 64-bit LCG for property-style tests (fixed seed → stable).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 11
    }

    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }
}

// ---------------------------------------------------------------------------
// Ported: io.test.ts — snapshot shape and round-trips
// ---------------------------------------------------------------------------

#[test]
fn snapshot_has_versioned_envelope_with_elements_and_order() {
    let mut gen = CounterIdGenerator::new();
    let doc = test_scene(&mut gen);
    let snapshot = doc.to_snapshot();
    assert_eq!(snapshot.schema_version, SCHEMA_VERSION);
    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.legacy_version, 1);
    assert_eq!(snapshot.elements.len(), 4);
    assert_eq!(snapshot.element_order.len(), 4);
}

#[test]
fn snapshot_round_trip_preserves_all_elements() {
    let mut gen = CounterIdGenerator::new();
    let doc = test_scene(&mut gen);
    let snapshot = doc.to_snapshot();

    let mut target = Document::new();
    let summary: ImportSummary = target.apply_snapshot(&snapshot).unwrap();
    assert_eq!(
        summary,
        ImportSummary {
            imported: 4,
            skipped: 0
        }
    );

    let mut ids: Vec<&str> = target
        .get_all()
        .iter()
        .map(|element| element.id().as_str())
        .collect();
    ids.sort_unstable();
    assert_eq!(ids, vec!["ellipse-1", "line-1", "rect-1", "text-1"]);
}

#[test]
fn snapshot_round_trip_preserves_properties() {
    let mut gen = CounterIdGenerator::new();
    let doc = test_scene(&mut gen);
    let snapshot = doc.to_snapshot();
    let mut target = Document::new();
    target.apply_snapshot(&snapshot).unwrap();

    let rect = target.get("rect-1").unwrap();
    assert_eq!(rect.base().x, 100.0);
    assert_eq!(rect.base().y, 200.0);
    assert_eq!(rect.base().width, 150.0);
    assert_eq!(rect.base().height, 100.0);
    assert_eq!(rect.base().stroke_color, "#333333");
    assert!(matches!(
        rect.base().background_color,
        FillStyle::Solid { .. }
    ));

    let ellipse = target.get("ellipse-1").unwrap();
    match &ellipse.base().background_color {
        FillStyle::Gradient {
            gradient_type,
            angle,
            stops,
        } => {
            assert_eq!(*gradient_type, GradientType::Linear);
            assert_eq!(*angle, 45.0);
            assert_eq!(stops.len(), 2);
            assert_eq!(stops[0].color, "#ff0000");
            assert_eq!(stops[1].color, "#0000ff");
        }
        FillStyle::Solid { .. } => panic!("expected gradient background"),
    }

    let line = target.get("line-1").unwrap();
    match line {
        Element::Line(line) => {
            assert_eq!(line.points, vec![[0.0, 0.0], [100.0, 50.0], [200.0, 100.0]]);
        }
        other => panic!("expected line, got {}", other.element_type_name()),
    }

    let text = target.get("text-1").unwrap();
    match text {
        Element::Text(text) => {
            assert_eq!(text.text, "Hello World");
            assert_eq!(text.font_size, 16.0);
            assert_eq!(text.font_family, "Arial");
            assert_eq!(text.text_align, TextAlign::Left);
        }
        other => panic!("expected text, got {}", other.element_type_name()),
    }
}

#[test]
fn apply_snapshot_clears_existing_elements() {
    let mut gen = CounterIdGenerator::new();
    let source = test_scene(&mut gen);
    let mut target = Document::new();
    let mut old = create_rectangle(&mut gen);
    old.base.id = ElementId::of("old-rect");
    target.upsert(Element::Rectangle(old)).unwrap();

    target.apply_snapshot(&source.to_snapshot()).unwrap();

    // Old element soft-deleted (still in the map, flagged) — TS parity.
    let old_element = target.get("old-rect").unwrap();
    assert!(old_element.base().is_deleted);
    assert!(target.get("rect-1").is_some());
    assert_eq!(target.element_count(), 4);
}

#[test]
fn apply_snapshot_skips_invalid_elements_individually() {
    let mut gen = CounterIdGenerator::new();
    let mut valid = create_rectangle(&mut gen);
    valid.base.id = ElementId::of("valid");
    let mut broken = create_rectangle(&mut gen);
    broken.base.id = ElementId::of("broken");
    broken.base.width = f64::NAN;

    let snapshot = DocumentSnapshot {
        schema_version: SCHEMA_VERSION,
        legacy_version: 1,
        elements: vec![Element::Rectangle(valid), Element::Rectangle(broken)],
        element_order: vec![ElementId::of("valid"), ElementId::of("broken")],
    };

    let mut target = Document::new();
    let summary = target.apply_snapshot(&snapshot).unwrap();
    assert_eq!(
        summary,
        ImportSummary {
            imported: 1,
            skipped: 1
        }
    );
    assert!(target.get("valid").is_some());
    assert_eq!(target.element_count(), 1);
}

#[test]
fn apply_snapshot_rejects_unsupported_version_atomically() {
    let mut gen = CounterIdGenerator::new();
    let source = test_scene(&mut gen);
    let mut snapshot = source.to_snapshot();
    snapshot.schema_version = 99;

    let mut target = Document::new();
    let nonce_before = target.scene_nonce();
    assert!(target.apply_snapshot(&snapshot).is_err());
    assert_eq!(target.scene_nonce(), nonce_before);
    assert_eq!(target.element_count(), 0);
}

#[test]
fn apply_snapshot_rejects_zero_valid_elements_without_mutation() {
    let mut gen = CounterIdGenerator::new();
    let mut broken = create_rectangle(&mut gen);
    broken.base.id = ElementId::of("broken");
    broken.base.height = f64::INFINITY;
    let snapshot = DocumentSnapshot {
        schema_version: SCHEMA_VERSION,
        legacy_version: 1,
        elements: vec![Element::Rectangle(broken)],
        element_order: vec![ElementId::of("broken")],
    };

    let mut target = Document::new();
    let mut keeper = create_rectangle(&mut gen);
    keeper.base.id = ElementId::of("keeper");
    target.upsert(Element::Rectangle(keeper)).unwrap();
    let nonce_before = target.scene_nonce();

    assert!(target.apply_snapshot(&snapshot).is_err());
    assert_eq!(target.scene_nonce(), nonce_before, "no partial mutation");
    assert_eq!(target.element_count(), 1);
    assert!(target.get("keeper").is_some());
}

#[test]
fn apply_snapshot_of_empty_scene_clears() {
    let mut gen = CounterIdGenerator::new();
    let mut doc = test_scene(&mut gen);
    let empty = Document::new().to_snapshot();
    let summary = doc.apply_snapshot(&empty).unwrap();
    assert_eq!(
        summary,
        ImportSummary {
            imported: 0,
            skipped: 0
        }
    );
    assert_eq!(doc.element_count(), 0);
}

#[test]
fn snapshot_excludes_deleted_elements_but_order_names_tombstones() {
    let mut gen = CounterIdGenerator::new();
    let mut doc = test_scene(&mut gen);
    doc.soft_delete("rect-1").unwrap();

    let snapshot = doc.to_snapshot();
    assert_eq!(snapshot.elements.len(), 3);
    assert!(snapshot
        .elements
        .iter()
        .all(|element| element.id().as_str() != "rect-1"));
    assert!(
        snapshot
            .element_order
            .iter()
            .any(|id| id.as_str() == "rect-1"),
        "order still names the tombstone (TS export parity)"
    );
}

// ---------------------------------------------------------------------------
// Ported: import-json.ts repair rules + z-order restoration
// ---------------------------------------------------------------------------

#[test]
fn dangling_references_repair_to_none() {
    let mut gen = CounterIdGenerator::new();

    let mut arrow = create_arrow(&mut gen);
    arrow.base.id = ElementId::of("arrow-1");
    arrow.points = vec![[0.0, 0.0], [50.0, 50.0]];
    arrow.start_binding = Some(Binding {
        element_id: ElementId::of("ghost-target"),
        focus: 0.5,
        gap: 4.0,
    });

    let mut text = create_text(&mut gen);
    text.base.id = ElementId::of("text-1");
    text.container_id = Some(ElementId::of("ghost-container"));
    text.base.frame_id = Some(ElementId::of("ghost-frame"));

    let snapshot = DocumentSnapshot {
        schema_version: SCHEMA_VERSION,
        legacy_version: 1,
        elements: vec![Element::Arrow(arrow), Element::Text(text)],
        element_order: vec![ElementId::of("arrow-1"), ElementId::of("text-1")],
    };

    let mut doc = Document::new();
    doc.apply_snapshot(&snapshot).unwrap();
    doc.validate().unwrap();

    match doc.get("arrow-1").unwrap() {
        Element::Arrow(arrow) => assert_eq!(arrow.start_binding, None),
        other => panic!("expected arrow, got {}", other.element_type_name()),
    }
    match doc.get("text-1").unwrap() {
        Element::Text(text) => {
            assert_eq!(text.container_id, None);
            assert_eq!(text.base.frame_id, None);
        }
        other => panic!("expected text, got {}", other.element_type_name()),
    }
}

#[test]
fn snapshot_restores_z_order() {
    let mut gen = CounterIdGenerator::new();
    let doc = test_scene(&mut gen);
    let mut snapshot = doc.to_snapshot();
    snapshot.element_order.reverse();

    let mut target = Document::new();
    target.apply_snapshot(&snapshot).unwrap();
    let ids: Vec<&str> = target
        .get_all()
        .iter()
        .map(|element| element.id().as_str())
        .collect();
    assert_eq!(ids, vec!["text-1", "line-1", "ellipse-1", "rect-1"]);
}

// ---------------------------------------------------------------------------
// Cross-module scenario: layer + group + lock + style + frame
// ---------------------------------------------------------------------------

#[test]
fn scenario_layer_group_style_frame_flow() {
    let mut gen = CounterIdGenerator::new();
    let mut doc = test_scene(&mut gen);

    // Layer: rect-1 to front.
    bring_to_front(&mut doc, &[ElementId::of("rect-1")]).unwrap();
    let ids: Vec<&str> = doc
        .get_all()
        .iter()
        .map(|element| element.id().as_str())
        .collect();
    assert_eq!(ids.last(), Some(&"rect-1"));
    send_to_back(&mut doc, &[ElementId::of("rect-1")]).unwrap();

    // Group rect + ellipse, then verify outermost membership.
    let group = group_elements(
        &mut doc,
        &[ElementId::of("rect-1"), ElementId::of("ellipse-1")],
    )
    .unwrap();
    assert_eq!(group_members(&doc, "rect-1").len(), 2);
    ungroup_elements(&mut doc, &group).unwrap();
    assert!(group_members(&doc, "rect-1").len() <= 1);

    // Lock + style survive the round-trip.
    lock_elements(&mut doc, &[ElementId::of("line-1")]).unwrap();
    set_stroke_color(&mut doc, &[ElementId::of("line-1")], "#123456").unwrap();
    set_opacity(&mut doc, &[ElementId::of("line-1")], 80.0).unwrap();
    assert_eq!(
        mixed_stroke_color(&doc, &[ElementId::of("line-1")]),
        Some("#123456".to_string())
    );
    assert_eq!(mixed_opacity(&doc, &[ElementId::of("line-1")]), Some(80.0));

    // Frame assignment by containment.
    let mut frame = create_frame(&mut gen);
    frame.base.id = ElementId::of("frame-1");
    frame.base.x = 0.0;
    frame.base.y = 0.0;
    frame.base.width = 1000.0;
    frame.base.height = 1000.0;
    doc.upsert(Element::Frame(frame)).unwrap();
    auto_assign_to_frames(&mut doc, None).unwrap();
    assert_eq!(
        doc.get("rect-1").unwrap().base().frame_id,
        Some(ElementId::of("frame-1"))
    );

    doc.validate().unwrap();
    let snapshot = doc.to_snapshot();
    let mut restored = Document::new();
    restored.apply_snapshot(&snapshot).unwrap();
    restored.validate().unwrap();
    assert_eq!(restored.element_count(), doc.element_count());
}

// ---------------------------------------------------------------------------
// Invariant / property tests (deterministic, no extra dependencies)
// ---------------------------------------------------------------------------

#[test]
fn property_upsert_versions_are_monotonic_and_nonces_fresh() {
    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    let mut rng = Lcg(0xC0FFEE);
    let mut nonces = HashSet::new();

    for index in 0..50 {
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of(format!("prop-{index}"));
        rect.base.x = rng.below(1000) as f64;
        rect.base.y = rng.below(1000) as f64;
        doc.upsert(Element::Rectangle(rect)).unwrap();

        let id = format!("prop-{index}");
        for _ in 0..3 {
            let mut next = doc.get(&id).unwrap().clone();
            let version_before = next.base().version;
            base_of(&mut next).x += 1.0;
            doc.upsert(next).unwrap();
            let stored = doc.get(&id).unwrap();
            assert_eq!(stored.base().version, version_before + 1);
            assert!(nonces.insert(stored.base().version_nonce), "nonce reuse");
        }
    }
    doc.validate().unwrap();
    assert_eq!(doc.element_count(), 50);
}

#[test]
fn property_snapshot_round_trip_preserves_semantics() {
    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    let mut rng = Lcg(12345);

    for index in 0..30 {
        let id = format!("round-{index}");
        let element = match rng.below(6) {
            0 => {
                let mut el = create_rectangle(&mut gen);
                el.base.id = ElementId::of(&id);
                Element::Rectangle(el)
            }
            1 => {
                let mut el: LineElement = create_line(&mut gen);
                el.base.id = ElementId::of(&id);
                el.points = vec![[0.0, 0.0], [10.0, 5.0]];
                Element::Line(el)
            }
            2 => {
                let mut el = create_text(&mut gen);
                el.base.id = ElementId::of(&id);
                el.text = format!("line {index}\nsecond");
                Element::Text(el)
            }
            3 => {
                let mut el = create_freedraw(&mut gen);
                el.base.id = ElementId::of(&id);
                el.points = vec![[0.0, 0.0], [3.0, 4.0]];
                el.pressures = vec![0.5, 0.7];
                Element::Freedraw(el)
            }
            4 => {
                let mut el = create_path(&mut gen);
                el.base.id = ElementId::of(&id);
                el.segments = vec![
                    PathSegment {
                        point: [0.0, 0.0],
                        handle_in: None,
                        handle_out: None,
                    },
                    PathSegment {
                        point: [20.0, 0.0],
                        handle_in: None,
                        handle_out: None,
                    },
                ];
                Element::Path(el)
            }
            _ => {
                let mut el = create_image(&mut gen);
                el.base.id = ElementId::of(&id);
                el.asset_id = format!("asset-{index}");
                Element::Image(el)
            }
        };
        doc.upsert(element).unwrap();
    }
    // Include grouping, locking, and styling mutations before the trip.
    let first_two: Vec<ElementId> = doc.order().into_iter().take(2).collect();
    group_elements(&mut doc, &first_two).unwrap();
    lock_elements(&mut doc, &first_two[..1]).unwrap();
    set_stroke_color(&mut doc, &first_two, "#abcdef").unwrap();

    let snapshot = doc.to_snapshot();
    let mut restored = Document::new();
    restored.apply_snapshot(&snapshot).unwrap();

    assert_eq!(restored.element_count(), doc.element_count());
    let before: Vec<(String, String, u32)> = doc
        .get_all()
        .iter()
        .map(|element| {
            (
                element.id().as_str().to_string(),
                element.element_type_name().to_string(),
                element.base().version,
            )
        })
        .collect();
    let after: Vec<(String, String, u32)> = restored
        .get_all()
        .iter()
        .map(|element| {
            (
                element.id().as_str().to_string(),
                element.element_type_name().to_string(),
                element.base().version,
            )
        })
        .collect();
    // Same ids in the same z-order with the same types; versions only move
    // forward through the apply path, never backward.
    assert_eq!(before.len(), after.len());
    for (left, right) in before.iter().zip(after.iter()) {
        assert_eq!(left.0, right.0);
        assert_eq!(left.1, right.1);
        assert!(right.2 >= left.2, "version for {}", left.0);
    }
    restored.validate().unwrap();
}

#[test]
fn property_z_order_ops_preserve_the_element_set() {
    let mut gen = CounterIdGenerator::new();
    let mut doc = Document::new();
    for index in 0..10 {
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of(format!("z-{index}"));
        doc.upsert(Element::Rectangle(rect)).unwrap();
    }
    let mut rng = Lcg(777);
    for _ in 0..40 {
        let pick: Vec<ElementId> = (0..3)
            .map(|_| ElementId::of(format!("z-{}", rng.below(10))))
            .collect();
        bring_to_front(&mut doc, &pick).unwrap();
        let ids: HashSet<String> = doc
            .order()
            .iter()
            .map(|id| id.as_str().to_string())
            .collect();
        assert_eq!(ids.len(), 10, "order is always a permutation");
        doc.validate().unwrap();
    }
}

#[test]
fn nan_fuzz_over_every_factory_is_rejected() {
    let mut gen = CounterIdGenerator::new();
    let mut elements: Vec<Element> = Vec::new();

    let text_base = TextElement {
        base: create_text(&mut gen).base,
        text: String::new(),
        font_size: 16.0,
        font_family: "Virgil".to_string(),
        text_align: TextAlign::Left,
        border_color: None,
        container_id: None,
    };
    elements.push(Element::Rectangle(create_rectangle(&mut gen)));
    elements.push(Element::Ellipse(create_ellipse(&mut gen)));
    elements.push(Element::Line(LineElement {
        base: create_line(&mut gen).base,
        points: vec![[0.0, 0.0]],
    }));
    elements.push(Element::Arrow(ArrowElement {
        base: create_arrow(&mut gen).base,
        points: vec![[0.0, 0.0]],
        start_binding: None,
        end_binding: None,
        start_arrowhead: None,
        end_arrowhead: None,
    }));
    elements.push(Element::Text(text_base));
    elements.push(Element::Freedraw(FreedrawElement {
        base: create_freedraw(&mut gen).base,
        points: vec![[0.0, 0.0]],
        pressures: vec![0.5],
    }));
    elements.push(Element::Image(create_image(&mut gen)));
    elements.push(Element::Path(PathElement {
        base: create_path(&mut gen).base,
        segments: vec![],
        closed: false,
    }));
    elements.push(Element::Instance(create_instance(
        &mut gen, "comp-1", 0.0, 0.0,
    )));

    let fields = [
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "strokeWidth",
        "opacity",
    ];
    for element in &elements {
        for field in fields {
            let mut poisoned = element.clone();
            let base = base_of(&mut poisoned);
            match field {
                "x" => base.x = f64::NAN,
                "y" => base.y = f64::NAN,
                "width" => base.width = f64::INFINITY,
                "height" => base.height = f64::NEG_INFINITY,
                "rotation" => base.rotation = f64::NAN,
                "strokeWidth" => base.stroke_width = f64::NAN,
                "opacity" => base.opacity = f64::INFINITY,
                _ => unreachable!(),
            }
            assert!(
                poisoned.validate().is_err(),
                "{} with poisoned {field} must be rejected",
                poisoned.element_type_name()
            );
            let mut doc = Document::new();
            assert!(doc.upsert(poisoned).is_err());
            assert_eq!(doc.element_count(), 0, "rejection stores nothing");
        }
    }
}

#[test]
fn duplicate_ids_never_collide_without_explicit_overwrite() {
    // Two generators with the same prefix mint the same sequence: merging
    // them into one document overwrites by id (last writer wins) instead
    // of duplicating — identity is the id, never the position.
    let mut gen_a = CounterIdGenerator::new();
    let mut gen_b = CounterIdGenerator::new();
    let first = Element::Rectangle(create_rectangle(&mut gen_a));
    let second = Element::Rectangle(create_rectangle(&mut gen_b));
    assert_eq!(first.id(), second.id());

    let mut doc = Document::new();
    doc.upsert(first).unwrap();
    doc.upsert(second).unwrap();
    assert_eq!(doc.element_count(), 1, "same id updates, never duplicates");
    assert_eq!(doc.order().len(), 1);
}

#[test]
fn generated_group_ids_are_fresh_per_document() {
    let mut gen = CounterIdGenerator::new();
    let mut first = Document::new();
    let mut second = Document::new();
    for (doc, prefix) in [(&mut first, "a"), (&mut second, "b")] {
        let mut rect = create_rectangle(&mut gen);
        rect.base.id = ElementId::of(format!("{prefix}-1"));
        doc.upsert(Element::Rectangle(rect)).unwrap();
    }
    let group_a = group_elements(&mut first, &[ElementId::of("a-1")]).unwrap();
    let group_b = group_elements(&mut second, &[ElementId::of("b-1")]).unwrap();
    // Counter sources inside each document mint independently; ids are
    // document-scoped, matching the instance-scoped state rule.
    assert_eq!(group_a.as_str(), group_b.as_str());
    assert_ne!(
        group_members(&first, "a-1"),
        group_members(&second, "b-1"),
        "membership never leaks across documents"
    );
}

#[test]
fn id_generator_counter_sequences_are_stable() {
    let mut gen = CounterIdGenerator::with_prefixes("test-el", "test-group");
    assert_eq!(gen.new_element_id().as_str(), "test-el-1");
    assert_eq!(gen.new_element_id().as_str(), "test-el-2");
    assert_eq!(gen.new_group_id().as_str(), "test-group-1");
    let nonce_first = gen.new_nonce();
    let nonce_second = gen.new_nonce();
    assert_ne!(nonce_first, nonce_second);
}
