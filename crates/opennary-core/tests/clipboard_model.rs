//! Clipboard integration tests: parity with the TypeScript engine.
//!
//! Ported behavior (TS oracle —
//! `packages/core/src/interaction/clipboard.test.ts`):
//!
//! - copy + paste single (fresh id, cascade offset, one history entry);
//! - copy + paste multi-select (relative layout preserved);
//! - duplicate without the system clipboard;
//! - cut (soft-delete + undo restore);
//! - arrow binding remap (both-in / target-out / partial);
//! - undo/redo integration.
//!
//! Plus repeated-paste cascade, target placement, group/frame/container
//! placement, group/frame/container remap, lock/hidden policy, version
//! restart, id-collision safety for counter generators, empty-buffer
//! no-ops, and transaction atomicity.

use opennary_core::clipboard::{duplicate_elements, Clipboard, PASTE_OFFSET};
use opennary_core::document::Document;
use opennary_core::element::{
    create_arrow, create_frame, create_rectangle, create_text, Binding, CounterIdGenerator,
    Element, ElementId,
};
use opennary_core::group::group_elements;
use opennary_core::history::HistoryManager;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn rectangle(id: &str, x: f64, y: f64, gen: &mut CounterIdGenerator) -> Element {
    let mut rect = create_rectangle(gen);
    rect.base.id = ElementId::of(id);
    rect.base.x = x;
    rect.base.y = y;
    Element::Rectangle(rect)
}

fn stocked_pair() -> (Document, HistoryManager, CounterIdGenerator) {
    (
        Document::new(),
        HistoryManager::new(),
        CounterIdGenerator::new(),
    )
}

// ---------------------------------------------------------------------------
// Basic copy / paste
// ---------------------------------------------------------------------------

#[test]
fn copy_paste_single_mints_fresh_id_with_cascade_offset() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 100.0, 200.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    let copied = clipboard.copy(&doc, &[ElementId::of("r1")]);
    assert_eq!(copied.len(), 1);
    assert_eq!(clipboard.len(), 1);

    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted.len(), 1);
    assert_eq!(doc.element_count(), 2);

    let fresh = &pasted[0];
    assert_ne!(fresh.id().as_str(), "r1");
    assert_eq!(fresh.base().x, 100.0 + PASTE_OFFSET);
    assert_eq!(fresh.base().y, 200.0 + PASTE_OFFSET);
}

#[test]
fn paste_records_a_single_history_entry() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(history.undo_len(), 1);

    assert!(history.undo(&mut doc).unwrap());
    assert_eq!(doc.element_count(), 1);
    assert!(history.redo(&mut doc).unwrap());
    assert_eq!(doc.element_count(), 2);
}

#[test]
fn repeated_paste_cascades_with_fresh_ids() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    let first = clipboard.paste(&mut doc, &mut history, None).unwrap();
    let second = clipboard.paste(&mut doc, &mut history, None).unwrap();
    let third = clipboard.paste(&mut doc, &mut history, None).unwrap();

    assert_eq!(first[0].base().x, PASTE_OFFSET);
    assert_eq!(second[0].base().x, PASTE_OFFSET * 2.0);
    assert_eq!(third[0].base().x, PASTE_OFFSET * 3.0);
    let mut ids = [
        first[0].id().as_str(),
        second[0].id().as_str(),
        third[0].id().as_str(),
    ];
    ids.sort_unstable();
    assert_eq!(ids.len(), 3);
    assert!(ids.windows(2).all(|pair| pair[0] != pair[1]));
    // The buffer still holds the one source element.
    assert_eq!(clipboard.len(), 1);
    assert_eq!(history.undo_len(), 3);
}

#[test]
fn copy_resets_the_cascade_counter() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    clipboard.paste(&mut doc, &mut history, None).unwrap();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted[0].base().x, PASTE_OFFSET);
}

#[test]
fn multi_select_paste_preserves_relative_layout() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();
    doc.upsert(rectangle("r2", 100.0, 50.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1"), ElementId::of("r2")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted.len(), 2);
    // Buffer order follows the copy order, so the offset is shared.
    assert_eq!(pasted[1].base().x - pasted[0].base().x, 100.0);
    assert_eq!(pasted[1].base().y - pasted[0].base().y, 50.0);
}

#[test]
fn paste_with_target_places_bbox_relative() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();
    doc.upsert(rectangle("r2", 100.0, 50.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1"), ElementId::of("r2")]);
    let pasted = clipboard
        .paste(&mut doc, &mut history, Some([500.0, 500.0]))
        .unwrap();
    assert_eq!(pasted.len(), 2);
    let min_x = pasted
        .iter()
        .map(|element| element.base().x)
        .fold(f64::INFINITY, f64::min);
    let min_y = pasted
        .iter()
        .map(|element| element.base().y)
        .fold(f64::INFINITY, f64::min);
    assert_eq!(min_x, 500.0 + PASTE_OFFSET);
    assert_eq!(min_y, 500.0 + PASTE_OFFSET);
}

#[test]
fn non_finite_paste_target_is_rejected_without_touch() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    let nonce_before = doc.scene_nonce();
    assert!(clipboard
        .paste(&mut doc, &mut history, Some([f64::NAN, 0.0]))
        .is_err());
    assert_eq!(doc.element_count(), 1);
    assert_eq!(doc.scene_nonce(), nonce_before);
    assert_eq!(history.undo_len(), 0);
    // The rejected attempt did not consume a cascade step.
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted[0].base().x, PASTE_OFFSET);
}

#[test]
fn empty_buffer_paste_is_a_noop() {
    let (mut doc, mut history, _) = stocked_pair();
    let mut clipboard = Clipboard::new();
    assert!(clipboard.is_empty());
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert!(pasted.is_empty());
    assert_eq!(history.undo_len(), 0);
}

// ---------------------------------------------------------------------------
// Duplicate / cut
// ---------------------------------------------------------------------------

#[test]
fn duplicate_offsets_without_touching_the_buffer() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("a", 0.0, 0.0, &mut gen)).unwrap();
    doc.upsert(rectangle("b", 50.0, 50.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("a")]);

    let duplicated = duplicate_elements(&mut doc, &mut history, &[ElementId::of("b")]).unwrap();
    assert_eq!(duplicated.len(), 1);
    assert_ne!(duplicated[0].id().as_str(), "b");
    assert_eq!(duplicated[0].base().x, 50.0 + PASTE_OFFSET);
    assert_eq!(doc.element_count(), 3);

    // The buffer still holds `a`, and its cascade is undisturbed.
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted[0].base().x, PASTE_OFFSET);
}

#[test]
fn duplicate_skips_unknown_and_deleted() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("a", 0.0, 0.0, &mut gen)).unwrap();
    doc.soft_delete("a").unwrap();
    let duplicated = duplicate_elements(
        &mut doc,
        &mut history,
        &[ElementId::of("a"), ElementId::of("ghost")],
    )
    .unwrap();
    assert!(duplicated.is_empty());
    assert_eq!(history.undo_len(), 0);
}

#[test]
fn cut_soft_deletes_and_undo_restores() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    let cut = clipboard
        .cut(&mut doc, &mut history, &[ElementId::of("r1")])
        .unwrap();
    assert_eq!(cut.len(), 1);
    assert!(doc.get("r1").unwrap().base().is_deleted);
    assert_eq!(doc.element_count(), 0);

    assert!(history.undo(&mut doc).unwrap());
    assert!(!doc.get("r1").unwrap().base().is_deleted);
    assert!(history.redo(&mut doc).unwrap());
    assert!(doc.get("r1").unwrap().base().is_deleted);

    // The cut content pastes back with a fresh id.
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted.len(), 1);
    assert_ne!(pasted[0].id().as_str(), "r1");
}

// ---------------------------------------------------------------------------
// Reference remapping
// ---------------------------------------------------------------------------

#[test]
fn arrow_bindings_remap_when_targets_travel() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("rect1", 0.0, 0.0, &mut gen)).unwrap();
    doc.upsert(rectangle("rect2", 200.0, 0.0, &mut gen))
        .unwrap();
    let mut arrow = create_arrow(&mut gen);
    arrow.base.id = ElementId::of("arrow1");
    arrow.points = vec![[0.0, 0.0], [200.0, 0.0]];
    arrow.start_binding = Some(Binding {
        element_id: ElementId::of("rect1"),
        focus: 0.0,
        gap: 5.0,
    });
    arrow.end_binding = Some(Binding {
        element_id: ElementId::of("rect2"),
        focus: 0.0,
        gap: 5.0,
    });
    doc.upsert(Element::Arrow(arrow)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(
        &doc,
        &[
            ElementId::of("rect1"),
            ElementId::of("rect2"),
            ElementId::of("arrow1"),
        ],
    );
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted.len(), 3);

    let pasted_arrow = pasted
        .iter()
        .find(|element| element.element_type_name() == "arrow")
        .expect("pasted arrow");
    let pasted_rects: Vec<&Element> = pasted
        .iter()
        .filter(|element| element.element_type_name() == "rectangle")
        .collect();
    assert_eq!(pasted_rects.len(), 2);
    if let Element::Arrow(arrow) = pasted_arrow {
        let start = arrow.start_binding.as_ref().expect("start remapped");
        let end = arrow.end_binding.as_ref().expect("end remapped");
        assert_ne!(start.element_id.as_str(), "rect1");
        assert_ne!(end.element_id.as_str(), "rect2");
        let targets = [start.element_id.as_str(), end.element_id.as_str()];
        assert!(targets.contains(&pasted_rects[0].id().as_str()));
        assert!(targets.contains(&pasted_rects[1].id().as_str()));
    } else {
        panic!("expected arrow");
    }
}

#[test]
fn arrow_bindings_null_when_targets_stay_behind() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("rect1", 0.0, 0.0, &mut gen)).unwrap();
    doc.upsert(rectangle("rect2", 200.0, 0.0, &mut gen))
        .unwrap();
    let mut arrow = create_arrow(&mut gen);
    arrow.base.id = ElementId::of("arrow1");
    arrow.start_binding = Some(Binding {
        element_id: ElementId::of("rect1"),
        focus: 0.0,
        gap: 5.0,
    });
    arrow.end_binding = Some(Binding {
        element_id: ElementId::of("rect2"),
        focus: 0.0,
        gap: 5.0,
    });
    doc.upsert(Element::Arrow(arrow)).unwrap();

    // Arrow alone: both bindings null out.
    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("arrow1")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    if let Element::Arrow(arrow) = &pasted[0] {
        assert_eq!(arrow.start_binding, None);
        assert_eq!(arrow.end_binding, None);
    } else {
        panic!("expected arrow");
    }

    // Arrow + rect1: start remaps, end nulls.
    clipboard.copy(&doc, &[ElementId::of("arrow1"), ElementId::of("rect1")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    let pasted_arrow = pasted
        .iter()
        .find(|element| element.element_type_name() == "arrow")
        .expect("pasted arrow");
    let pasted_rect = pasted
        .iter()
        .find(|element| element.element_type_name() == "rectangle")
        .expect("pasted rect");
    if let Element::Arrow(arrow) = pasted_arrow {
        assert_eq!(
            arrow.start_binding.as_ref().unwrap().element_id,
            *pasted_rect.id()
        );
        assert_eq!(arrow.end_binding, None);
    } else {
        panic!("expected arrow");
    }
}

#[test]
fn grouped_paste_mints_fresh_groups() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();
    doc.upsert(rectangle("r2", 60.0, 0.0, &mut gen)).unwrap();
    let group = group_elements(&mut doc, &[ElementId::of("r1"), ElementId::of("r2")]).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1"), ElementId::of("r2")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted.len(), 2);
    for element in &pasted {
        assert_eq!(element.base().group_ids.len(), 1);
        assert_ne!(element.base().group_ids[0], group);
    }
    // Both copies share the one fresh group (never merge into the source).
    assert_eq!(pasted[0].base().group_ids, pasted[1].base().group_ids);
    // The source group is untouched.
    assert!(doc.get("r1").unwrap().base().group_ids.contains(&group));
}

#[test]
fn frame_and_container_references_remap_or_detach() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    let mut frame = create_frame(&mut gen);
    frame.base.id = ElementId::of("frame-1");
    doc.upsert(Element::Frame(frame)).unwrap();
    let mut child = create_rectangle(&mut gen);
    child.base.id = ElementId::of("child-1");
    child.base.frame_id = Some(ElementId::of("frame-1"));
    doc.upsert(Element::Rectangle(child)).unwrap();
    let mut text = create_text(&mut gen);
    text.base.id = ElementId::of("text-1");
    text.container_id = Some(ElementId::of("child-1"));
    doc.upsert(Element::Text(text)).unwrap();

    // Copying the whole family remaps the references to the fresh ids.
    let mut clipboard = Clipboard::new();
    clipboard.copy(
        &doc,
        &[
            ElementId::of("frame-1"),
            ElementId::of("child-1"),
            ElementId::of("text-1"),
        ],
    );
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    let pasted_frame = pasted
        .iter()
        .find(|element| element.element_type_name() == "frame")
        .unwrap();
    let pasted_child = pasted
        .iter()
        .find(|element| {
            element.id().as_str() != pasted_frame.id().as_str()
                && element.element_type_name() == "rectangle"
        })
        .unwrap();
    assert_eq!(
        pasted_child.base().frame_id.as_ref(),
        Some(pasted_frame.id())
    );
    let pasted_text = pasted
        .iter()
        .find(|element| element.element_type_name() == "text")
        .unwrap();
    if let Element::Text(text) = pasted_text {
        assert_eq!(text.container_id.as_ref(), Some(pasted_child.id()));
    } else {
        panic!("expected text");
    }

    // Copying the child alone detaches it from the original frame.
    clipboard.copy(&doc, &[ElementId::of("child-1")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted[0].base().frame_id, None);
}

// ---------------------------------------------------------------------------
// Fresh identity policy
// ---------------------------------------------------------------------------

#[test]
fn paste_restarts_version_stream_with_fresh_nonce_and_seed() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();
    let mut moved = doc.get("r1").unwrap().clone();
    moved.base_mut_of().x = 5.0;
    // (external helper keeps this test independent of command internals)
    doc.upsert(moved).unwrap();
    let source = doc.get("r1").unwrap().clone();
    assert_eq!(source.base().version, 1);

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted[0].base().version, 0);
    assert_ne!(pasted[0].base().version_nonce, source.base().version_nonce);
    assert_ne!(pasted[0].base().seed, source.base().seed);
}

#[test]
fn paste_unlocks_but_preserves_hidden() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    let mut rect = create_rectangle(&mut gen);
    rect.base.id = ElementId::of("r1");
    rect.base.locked = true;
    rect.base.hidden = true;
    doc.upsert(Element::Rectangle(rect)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    // TS parity: pastes start unlocked, while `hidden` clones verbatim
    // (the TS comment overclaims a hidden reset the code never performs).
    assert!(!pasted[0].base().locked);
    assert!(pasted[0].base().hidden);
}

#[test]
fn fresh_ids_skip_collisions_with_imported_content() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    // Occupy the counter generator's first id with foreign content, as an
    // import of another document's ids could.
    doc.upsert(rectangle("el-1", 999.0, 999.0, &mut gen))
        .unwrap();
    doc.upsert(rectangle("src", 0.0, 0.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("src")]);
    let pasted = clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(pasted[0].id().as_str(), "el-2");
    assert_eq!(doc.get("el-1").unwrap().base().x, 999.0);
}

// ---------------------------------------------------------------------------
// Undo / redo integration
// ---------------------------------------------------------------------------

#[test]
fn undo_redo_paste_cut_round_trip() {
    let (mut doc, mut history, mut gen) = stocked_pair();
    doc.upsert(rectangle("r1", 0.0, 0.0, &mut gen)).unwrap();

    let mut clipboard = Clipboard::new();
    clipboard.copy(&doc, &[ElementId::of("r1")]);
    clipboard.paste(&mut doc, &mut history, None).unwrap();
    assert_eq!(doc.element_count(), 2);

    assert!(history.undo(&mut doc).unwrap());
    assert_eq!(doc.element_count(), 1);
    assert!(history.redo(&mut doc).unwrap());
    assert_eq!(doc.element_count(), 2);

    clipboard
        .cut(&mut doc, &mut history, &[ElementId::of("r1")])
        .unwrap();
    assert!(doc.get("r1").unwrap().base().is_deleted);
    assert!(history.undo(&mut doc).unwrap());
    assert!(!doc.get("r1").unwrap().base().is_deleted);
}

// ---------------------------------------------------------------------------
// Local helper: mutable base access from outside the crate
// ---------------------------------------------------------------------------

trait BaseMutOf {
    fn base_mut_of(&mut self) -> &mut opennary_core::element::BaseElement;
}

impl BaseMutOf for Element {
    fn base_mut_of(&mut self) -> &mut opennary_core::element::BaseElement {
        match self {
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
}
