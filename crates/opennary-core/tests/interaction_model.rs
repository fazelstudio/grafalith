//! Phase-05 scenario tests: the master-prompt editor behaviors through the
//! normalized dispatch (`click → select → drag → undo → redo`, text
//! create/type/commit, rotate/resize, multi-drag, keyboard, tools).
//!
//! Every test drives [`Editor`] like a host would (screen pixels through
//! `pointer_*`, keys through `handle_key`, IME through the composition
//! calls) and asserts document + selection + history outcomes. TS sources:
//! `selection.test.ts`, `transform.test.ts`, `editor.test.ts`,
//! `crop-handler.test.ts` (session slice), and the remediation
//! interaction slice.

use std::f64::consts::{FRAC_PI_2, PI};

use opennary_core::command::CommandOutcome;
use opennary_core::editor::{Editor, EscapeOutcome, InputOutcome, KeyAction, PointerUpOutcome};
use opennary_core::element::{create_rectangle, CounterIdGenerator, Element, ElementId};
use opennary_core::geometry::rotation::rotate_point_around;
use opennary_core::geometry::transform::get_rotate_handle_position;
use opennary_core::geometry::Bounds;
use opennary_core::interaction::{
    ContextMenuIntent, InputEvent, Key, KeyIntent, Modifiers, PointerButton,
};
use opennary_core::text_session::FallbackMeasurer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> Element {
    let mut gen = CounterIdGenerator::new();
    let mut el = create_rectangle(&mut gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.width = w;
    el.base.height = h;
    Element::Rectangle(el)
}

fn place(editor: &mut Editor, id: &str, x: f64, y: f64, w: f64, h: f64) -> ElementId {
    editor.create(rect(id, x, y, w, h)).unwrap()
}

fn none() -> Modifiers {
    Modifiers::none()
}

fn shift() -> Modifiers {
    Modifiers::shift()
}

fn cmd() -> Modifiers {
    Modifiers {
        ctrl_or_cmd: true,
        ..Modifiers::none()
    }
}

fn click(editor: &mut Editor, x: f64, y: f64) {
    editor
        .pointer_down(x, y, PointerButton::Left, none(), 1)
        .unwrap();
    editor
        .pointer_up(x, y, PointerButton::Left, none())
        .unwrap();
}

fn shift_click(editor: &mut Editor, x: f64, y: f64) {
    editor
        .pointer_down(x, y, PointerButton::Left, shift(), 1)
        .unwrap();
    editor
        .pointer_up(x, y, PointerButton::Left, shift())
        .unwrap();
}

fn drag(
    editor: &mut Editor,
    from: (f64, f64),
    to: (f64, f64),
    modifiers: Modifiers,
) -> PointerUpOutcome {
    editor
        .pointer_down(from.0, from.1, PointerButton::Left, none(), 1)
        .unwrap();
    assert!(
        editor.pointer_move(to.0, to.1, modifiers).unwrap(),
        "drag must cross the threshold"
    );
    editor
        .pointer_up(to.0, to.1, PointerButton::Left, modifiers)
        .unwrap()
}

fn selected(editor: &Editor) -> Vec<ElementId> {
    editor.state().selection.ids().to_vec()
}

fn x_of(editor: &Editor, id: &str) -> f64 {
    editor.document().get(id).unwrap().base().x
}

fn y_of(editor: &Editor, id: &str) -> f64 {
    editor.document().get(id).unwrap().base().y
}

// ---------------------------------------------------------------------------
// Click vs drag threshold
// ---------------------------------------------------------------------------

#[test]
fn click_selects_without_mutation_or_history() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    let nonce = editor.document().scene_nonce();
    let undo_before = editor.history().undo_len();
    click(&mut editor, 50.0, 50.0);
    assert_eq!(selected(&editor), vec![ElementId::of("r1")]);
    assert_eq!(editor.document().scene_nonce(), nonce);
    assert_eq!(editor.history().undo_len(), undo_before);
}

#[test]
fn below_threshold_stays_a_click() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    let undo_before = editor.history().undo_len();
    editor
        .pointer_down(50.0, 50.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert!(!editor.pointer_move(52.0, 52.0, none()).unwrap());
    assert!(editor.pointer_phase().is_captured());
    assert!(!editor.pointer_phase().is_dragging());
    editor
        .pointer_up(52.0, 52.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(x_of(&editor, "r1"), 0.0);
    assert_eq!(editor.history().undo_len(), undo_before);
}

#[test]
fn drag_commits_one_entry_and_undo_restores() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    let undo_before = editor.history().undo_len();
    // Press at the center: corners/edges belong to the resize handles.
    let outcome = drag(&mut editor, (50.0, 50.0), (70.0, 65.0), none());
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    assert_eq!((x_of(&editor, "r1"), y_of(&editor, "r1")), (20.0, 15.0));
    assert_eq!(editor.history().undo_len(), undo_before + 1);
    assert!(editor.undo().unwrap());
    assert_eq!((x_of(&editor, "r1"), y_of(&editor, "r1")), (0.0, 0.0));
    assert!(editor.redo().unwrap());
    assert_eq!((x_of(&editor, "r1"), y_of(&editor, "r1")), (20.0, 15.0));
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

#[test]
fn shift_click_multi_selects() {
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 200.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    shift_click(&mut editor, 250.0, 250.0);
    assert_eq!(selected(&editor).len(), 2);
    assert!(selected(&editor).contains(&ElementId::of("a")));
    assert!(selected(&editor).contains(&ElementId::of("b")));
}

#[test]
fn rubber_band_selects_many_and_additive_extends() {
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 200.0, 100.0, 100.0);
    place(&mut editor, "c", 600.0, 600.0, 30.0, 30.0);
    editor
        .pointer_down(150.0, 150.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert!(editor.pointer_move(350.0, 350.0, none()).unwrap());
    let outcome = editor
        .pointer_up(350.0, 350.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(
        outcome,
        PointerUpOutcome::RubberBand(vec![ElementId::of("b")])
    );
    // Additive band from empty space adds without dropping `b`.
    editor
        .pointer_down(-50.0, -50.0, PointerButton::Left, shift(), 1)
        .unwrap();
    editor.pointer_move(150.0, 150.0, shift()).unwrap();
    editor
        .pointer_up(150.0, 150.0, PointerButton::Left, shift())
        .unwrap();
    let sel = selected(&editor);
    assert!(sel.contains(&ElementId::of("a")) && sel.contains(&ElementId::of("b")));
    assert!(!sel.contains(&ElementId::of("c")));
}

#[test]
fn locked_click_passes_through_to_below() {
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 0.0, 0.0, 100.0, 100.0);
    editor.lock(vec![ElementId::of("b")]).unwrap();
    click(&mut editor, 50.0, 50.0);
    assert_eq!(selected(&editor), vec![ElementId::of("a")]);
}

#[test]
fn top_wins_on_overlap() {
    let mut editor = Editor::new();
    place(&mut editor, "bottom", 0.0, 0.0, 200.0, 200.0);
    place(&mut editor, "top", 50.0, 50.0, 100.0, 100.0);
    click(&mut editor, 100.0, 100.0);
    assert_eq!(selected(&editor), vec![ElementId::of("top")]);
}

#[test]
fn rubber_band_includes_locked() {
    // TS parity: the rubber query skips deleted/hidden, not locked.
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    editor.lock(vec![ElementId::of("a")]).unwrap();
    editor
        .pointer_down(-10.0, -10.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.pointer_move(200.0, 200.0, none()).unwrap();
    let outcome = editor
        .pointer_up(200.0, 200.0, PointerButton::Left, none())
        .unwrap();
    assert!(matches!(outcome, PointerUpOutcome::RubberBand(_)));
    assert_eq!(selected(&editor), vec![ElementId::of("a")]);
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

#[test]
fn click_selects_outermost_group() {
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 0.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    shift_click(&mut editor, 250.0, 50.0);
    let group = editor.group_selected().unwrap().expect("grouped");
    assert_eq!(editor.history().undo_len(), 3);
    click(&mut editor, 50.0, 50.0);
    let mut sel = selected(&editor);
    sel.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    assert_eq!(sel, vec![ElementId::of("a"), ElementId::of("b")]);
    // One undo ungroups the whole set.
    assert!(editor.undo().unwrap());
    assert!(editor
        .document()
        .get("a")
        .unwrap()
        .base()
        .group_ids
        .is_empty());
    let _ = group;
}

#[test]
fn double_click_drills_in_and_escape_exits() {
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 0.0, 100.0, 100.0);
    editor.select(vec![ElementId::of("a"), ElementId::of("b")]);
    editor.group_selected().unwrap();
    editor
        .pointer_down(50.0, 50.0, PointerButton::Left, none(), 2)
        .unwrap();
    editor
        .pointer_up(50.0, 50.0, PointerButton::Left, none())
        .unwrap();
    assert!(editor.editing_group_id().is_some());
    assert_eq!(selected(&editor), vec![ElementId::of("a")]);
    click(&mut editor, 250.0, 50.0);
    assert_eq!(selected(&editor), vec![ElementId::of("b")]);
    let action = editor.handle_key(Key::Escape, none()).unwrap();
    assert!(matches!(
        action,
        opennary_core::editor::KeyAction::EscapeHandled(EscapeOutcome::GroupExited)
    ));
    assert!(selected(&editor).is_empty());
}

#[test]
fn group_press_keeps_multi_for_drag_and_click_keeps_group() {
    // TS parity: pressing a member of the already-selected group keeps the
    // group (no collapse to the single member); a bare click keeps the
    // group too — only drill-in re-targets singles. Ungrouped multis
    // collapse to the pressed member immediately (immediate reselect).
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 0.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    shift_click(&mut editor, 250.0, 50.0);
    editor.group_selected().unwrap();
    click(&mut editor, 50.0, 50.0);
    assert_eq!(selected(&editor).len(), 2);
    // Press on `a` keeps the set for a potential drag.
    editor
        .pointer_down(50.0, 50.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert_eq!(selected(&editor).len(), 2);
    editor.pointer_move(80.0, 50.0, none()).unwrap();
    let outcome = editor
        .pointer_up(80.0, 50.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    assert_eq!((x_of(&editor, "a"), x_of(&editor, "b")), (30.0, 230.0));
    assert_eq!(selected(&editor).len(), 2);
    // A bare re-click on the member keeps the group (no single collapse).
    click(&mut editor, 80.0, 50.0);
    assert_eq!(selected(&editor).len(), 2);
}

#[test]
fn ungrouped_press_collapses_immediately() {
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 0.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    shift_click(&mut editor, 250.0, 50.0);
    assert_eq!(selected(&editor).len(), 2);
    click(&mut editor, 50.0, 50.0);
    assert_eq!(selected(&editor), vec![ElementId::of("a")]);
}

// ---------------------------------------------------------------------------
// Drag semantics
// ---------------------------------------------------------------------------

#[test]
fn multi_drag_skips_locked_in_one_entry() {
    let mut editor = Editor::new();
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 0.0, 100.0, 100.0);
    editor.lock(vec![ElementId::of("b")]).unwrap();
    // Group first: only the exact group selection survives a press without
    // collapsing, so the drag moves the whole set (TS parity).
    editor.select(vec![ElementId::of("a"), ElementId::of("b")]);
    editor.group_selected().unwrap();
    let undo_before = editor.history().undo_len();
    click(&mut editor, 50.0, 50.0);
    assert_eq!(selected(&editor).len(), 2);
    let outcome = drag(&mut editor, (50.0, 50.0), (100.0, 50.0), none());
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    assert_eq!(x_of(&editor, "a"), 50.0);
    assert_eq!(x_of(&editor, "b"), 200.0, "locked member stays");
    assert_eq!(editor.history().undo_len(), undo_before + 1);
    assert!(editor.undo().unwrap());
    assert_eq!(x_of(&editor, "a"), 0.0);
}

#[test]
fn escape_cancels_drag_atomically() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    let undo_before = editor.history().undo_len();
    let nonce_before = editor.document().scene_nonce();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.pointer_move(60.0, 60.0, none()).unwrap();
    let action = editor.handle_key(Key::Escape, none()).unwrap();
    assert!(matches!(
        action,
        KeyAction::EscapeHandled(EscapeOutcome::GestureCancelled)
    ));
    let outcome = editor
        .pointer_up(60.0, 60.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(outcome, PointerUpOutcome::Dismissed);
    assert_eq!(x_of(&editor, "r1"), 0.0);
    assert_eq!(editor.history().undo_len(), undo_before);
    assert_eq!(editor.document().scene_nonce(), nonce_before);
}

#[test]
fn pointer_cancel_cancels_without_trace() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    let undo_before = editor.history().undo_len();
    editor
        .pointer_down(50.0, 50.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.pointer_move(90.0, 60.0, none()).unwrap();
    editor.pointer_cancel().unwrap();
    assert_eq!(x_of(&editor, "r1"), 0.0);
    assert_eq!(editor.history().undo_len(), undo_before);
}

#[test]
fn shift_locks_drag_to_dominant_axis() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    let outcome = drag(&mut editor, (10.0, 10.0), (40.0, 20.0), shift());
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    assert_eq!((x_of(&editor, "r1"), y_of(&editor, "r1")), (30.0, 0.0));
}

#[test]
fn snap_hook_is_zoom_independent() {
    // Gap of 1 scene unit after the drag: snaps at zoom 1 (1px < 5px),
    // ignores at zoom 10 (10px > 5px).
    let mut near = Editor::new();
    place(&mut near, "a", 0.0, 0.0, 50.0, 50.0);
    place(&mut near, "b", 54.0, 200.0, 50.0, 50.0);
    let outcome = drag(&mut near, (10.0, 10.0), (15.0, 10.0), none());
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    assert_eq!(x_of(&near, "a"), 4.0, "right edge lands exactly on x=54");
    assert!(!near.last_snap_guides().is_empty());

    let mut far = Editor::new();
    place(&mut far, "a", 0.0, 0.0, 50.0, 50.0);
    place(&mut far, "b", 54.0, 200.0, 50.0, 50.0);
    far.zoom_by(10.0, 0.0, 0.0).unwrap();
    far.pointer_down(100.0, 100.0, PointerButton::Left, none(), 1)
        .unwrap();
    far.pointer_move(150.0, 100.0, none()).unwrap();
    let outcome = far
        .pointer_up(150.0, 100.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    assert_eq!(x_of(&far, "a"), 5.0, "no snap at zoom 10");
    assert!(far.last_snap_guides().is_empty());
}

#[test]
fn frame_drag_carries_unselected_children_in_one_entry() {
    let mut editor = Editor::new();
    let mut gen = CounterIdGenerator::new();
    let mut frame = opennary_core::element::create_frame(&mut gen);
    frame.base.id = ElementId::of("f");
    frame.base.x = 0.0;
    frame.base.y = 0.0;
    editor.create(Element::Frame(frame)).unwrap();
    let mut child = rect("c", 50.0, 50.0, 60.0, 40.0);
    if let Element::Rectangle(inner) = &mut child {
        inner.base.frame_id = Some(ElementId::of("f"));
    }
    editor.create(child).unwrap();
    let undo_before = editor.history().undo_len();
    let outcome = drag(&mut editor, (350.0, 250.0), (360.0, 260.0), none());
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    assert_eq!((x_of(&editor, "f"), y_of(&editor, "f")), (10.0, 10.0));
    assert_eq!((x_of(&editor, "c"), y_of(&editor, "c")), (60.0, 60.0));
    assert_eq!(editor.history().undo_len(), undo_before + 1);
    assert!(editor.undo().unwrap());
    assert_eq!((x_of(&editor, "f"), x_of(&editor, "c")), (0.0, 50.0));
}

// ---------------------------------------------------------------------------
// Resize / rotate
// ---------------------------------------------------------------------------

#[test]
fn resize_bottom_right_matches_ts_numbers() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 100.0, 100.0, 80.0, 60.0);
    click(&mut editor, 140.0, 130.0);
    editor
        .pointer_down(180.0, 160.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert!(editor.pointer_move(220.0, 200.0, none()).unwrap());
    let outcome = editor
        .pointer_up(220.0, 200.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    let el = editor.document().get("r1").unwrap();
    assert_eq!((el.base().x, el.base().y), (100.0, 100.0));
    assert_eq!((el.base().width, el.base().height), (120.0, 100.0));
    assert!(editor.undo().unwrap());
    let el = editor.document().get("r1").unwrap();
    assert_eq!((el.base().width, el.base().height), (80.0, 60.0));
}

#[test]
fn resize_top_left_moves_origin_and_keeps_far_corner() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 100.0, 100.0, 80.0, 60.0);
    click(&mut editor, 140.0, 130.0);
    let outcome = drag(&mut editor, (100.0, 100.0), (80.0, 80.0), none());
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    let el = editor.document().get("r1").unwrap();
    assert_eq!(
        (el.base().x, el.base().y, el.base().width, el.base().height),
        (80.0, 80.0, 100.0, 80.0)
    );
}

#[test]
fn direct_resize_guards_match_ts() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 10.0, 20.0, 100.0, 100.0);
    let outcome = editor
        .resize_element(ElementId::of("r1"), 10.0, 20.0, 200.0, 150.0)
        .unwrap();
    assert!(outcome.changed);
    // Sub-minimum is a no-op.
    let noop = editor
        .resize_element(ElementId::of("r1"), 0.0, 0.0, 0.5, 10.0)
        .unwrap();
    assert!(!noop.changed);
    assert_eq!(editor.document().get("r1").unwrap().base().width, 200.0);
    // Locked is a no-op.
    editor.lock(vec![ElementId::of("r1")]).unwrap();
    let locked = editor
        .resize_element(ElementId::of("r1"), 0.0, 0.0, 50.0, 50.0)
        .unwrap();
    assert!(!locked.changed);
    // Non-finite is a typed error, never a silent corrupt.
    assert!(editor
        .resize_element(ElementId::of("r1"), f64::NAN, 0.0, 50.0, 50.0)
        .is_err());
}

#[test]
fn aspect_lock_holds_ratio_on_shift_drag() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 80.0, 60.0);
    click(&mut editor, 40.0, 30.0);
    editor
        .pointer_down(80.0, 60.0, PointerButton::Left, shift(), 1)
        .unwrap();
    editor.pointer_move(120.0, 200.0, shift()).unwrap();
    editor
        .pointer_up(120.0, 200.0, PointerButton::Left, shift())
        .unwrap();
    let el = editor.document().get("r1").unwrap();
    let ratio = el.base().width / el.base().height;
    assert!((ratio - 80.0 / 60.0).abs() < 1e-9);
}

#[test]
fn rotated_resize_preserves_rotation_and_valid_dims() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 100.0, 100.0, 80.0, 60.0);
    editor
        .rotate_element(ElementId::of("r1"), FRAC_PI_2)
        .unwrap();
    click(&mut editor, 140.0, 130.0);
    // Rotated bottom-right handle position, computed like the overlay.
    let bounds = Bounds::from_xywh(100.0, 100.0, 80.0, 60.0);
    let center = bounds.center();
    let local_br = [bounds.max_x, bounds.max_y];
    let handle = rotate_point_around(&local_br, &[center[0], center[1]], FRAC_PI_2);
    editor
        .pointer_down(handle[0], handle[1], PointerButton::Left, none(), 1)
        .unwrap();
    assert!(editor
        .pointer_move(handle[0] + 20.0, handle[1] + 20.0, none())
        .unwrap());
    let outcome = editor
        .pointer_up(
            handle[0] + 20.0,
            handle[1] + 20.0,
            PointerButton::Left,
            none(),
        )
        .unwrap();
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    let el = editor.document().get("r1").unwrap();
    assert_eq!(el.base().rotation, FRAC_PI_2);
    assert!(el.base().width >= 1.0 && el.base().height >= 1.0);
}

#[test]
fn rotate_drag_applies_angle_and_undo_restores() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 100.0, 100.0, 80.0, 60.0);
    click(&mut editor, 140.0, 130.0);
    // Rotate handle sits 24px above the top edge (default theme, zoom 1).
    let bounds = Bounds::from_xywh(100.0, 100.0, 80.0, 60.0);
    let offset = editor.theme().sizes.rotate_handle_offset;
    let handle = get_rotate_handle_position(&bounds, 1.0, offset);
    assert_eq!(handle, [140.0, 76.0]);
    editor
        .pointer_down(handle[0], handle[1], PointerButton::Left, none(), 1)
        .unwrap();
    editor.pointer_move(140.0, 180.0, none()).unwrap();
    let outcome = editor
        .pointer_up(140.0, 180.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(outcome, PointerUpOutcome::DragCommitted(true));
    let rotation = editor.document().get("r1").unwrap().base().rotation;
    assert!(rotation.abs() > 0.1, "rotation {rotation} applies");
    assert!(editor.undo().unwrap());
    assert_eq!(editor.document().get("r1").unwrap().base().rotation, 0.0);
}

#[test]
fn rotate_shift_snaps_to_15_degrees() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 100.0, 100.0, 80.0, 60.0);
    click(&mut editor, 140.0, 130.0);
    let bounds = Bounds::from_xywh(100.0, 100.0, 80.0, 60.0);
    let offset = editor.theme().sizes.rotate_handle_offset;
    let handle = get_rotate_handle_position(&bounds, 1.0, offset);
    editor
        .pointer_down(handle[0], handle[1], PointerButton::Left, shift(), 1)
        .unwrap();
    // ~20.6° of travel snaps to the 15° increment.
    editor.pointer_move(180.0, 145.0, shift()).unwrap();
    editor
        .pointer_up(180.0, 145.0, PointerButton::Left, shift())
        .unwrap();
    let rotation = editor.document().get("r1").unwrap().base().rotation;
    // ~20.6° of travel snaps down to the 105° (7 × 15°) increment.
    assert!(
        (rotation - 7.0 * PI / 12.0).abs() < 1e-9,
        "rotation {rotation} snaps"
    );
}

#[test]
fn direct_rotate_guards_match_ts() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 50.0, 50.0);
    let outcome = editor
        .rotate_element(ElementId::of("r1"), PI / 4.0)
        .unwrap();
    assert!(outcome.changed);
    assert_eq!(
        editor.document().get("r1").unwrap().base().rotation,
        PI / 4.0
    );
    editor.lock(vec![ElementId::of("r1")]).unwrap();
    let locked = editor.rotate_element(ElementId::of("r1"), 1.0).unwrap();
    assert!(!locked.changed);
    assert!(editor
        .rotate_element(ElementId::of("r1"), f64::NAN)
        .is_err());
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

#[test]
fn text_tool_creates_types_and_commits() {
    let mut editor = Editor::new();
    assert!(editor.set_active_tool("text").unwrap());
    let down = editor
        .pointer_down(300.0, 300.0, PointerButton::Left, none(), 1)
        .unwrap();
    let id = down.began_text_edit.clone().expect("session starts");
    assert_eq!(editor.text_editing(), Some(&id));
    assert!(editor.text_insert("hi").unwrap());
    assert_eq!(editor.text_draft(), Some("hi"));
    assert_eq!(editor.text_caret(), Some(2));
    let measurer = FallbackMeasurer;
    assert!(editor.commit_text(&measurer).unwrap());
    assert!(editor.text_editing().is_none());
    let el = editor.document().get(id.as_str()).unwrap();
    assert_eq!(el.element_type_name(), "text");
    // Two entries: creation + commit (TS observer parity).
    assert_eq!(editor.history().undo_len(), 2);
    assert!(editor.undo().unwrap());
    assert_eq!(
        editor
            .document()
            .get(id.as_str())
            .unwrap()
            .element_type_name(),
        "text"
    );
    assert!(editor.undo().unwrap());
    assert!(editor.document().get(id.as_str()).is_none());
}

#[test]
fn double_click_edits_existing_text() {
    let mut editor = Editor::new();
    editor.set_active_tool("text").unwrap();
    editor
        .pointer_down(300.0, 300.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.text_insert("hi").unwrap();
    editor.commit_text(&FallbackMeasurer).unwrap();
    editor.set_active_tool("select").unwrap();
    let id = editor.document().order().into_iter().next().unwrap();
    let el = editor.document().get(id.as_str()).unwrap();
    let cx = el.base().x + el.base().width / 2.0;
    let cy = el.base().y + el.base().height / 2.0;
    editor
        .pointer_down(cx, cy, PointerButton::Left, none(), 2)
        .unwrap();
    editor
        .pointer_up(cx, cy, PointerButton::Left, none())
        .unwrap();
    assert_eq!(editor.text_editing(), Some(&id));
    assert_eq!(editor.text_draft(), Some("hi"));
    editor.text_insert("!").unwrap();
    editor.commit_text(&FallbackMeasurer).unwrap();
    assert_eq!(
        editor
            .document()
            .get(id.as_str())
            .unwrap()
            .element_type_name(),
        "text"
    );
}

#[test]
fn ime_intermediate_updates_never_finalize() {
    let mut editor = Editor::new();
    editor.set_active_tool("text").unwrap();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.composition_start().unwrap();
    assert!(editor.text_composing());
    assert!(
        !editor.text_insert("x").unwrap(),
        "plain input blocked mid-IME"
    );
    assert_eq!(editor.text_draft(), Some(""));
    editor.composition_update("nihon".to_string()).unwrap();
    assert_eq!(editor.text_draft(), Some(""), "intermediate stays out");
    editor.composition_end("日本").unwrap();
    assert!(!editor.text_composing());
    assert_eq!(editor.text_draft(), Some("日本"));
    assert_eq!(editor.text_caret(), Some(2));
    editor.commit_text(&FallbackMeasurer).unwrap();
}

#[test]
fn empty_commit_deletes_and_whitespace_trims_at_ends_only() {
    let mut editor = Editor::new();
    editor.set_active_tool("text").unwrap();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    let id = editor.text_editing().cloned().unwrap();
    editor.text_insert("   ").unwrap();
    assert!(editor.commit_text(&FallbackMeasurer).unwrap());
    assert!(
        editor
            .document()
            .get(id.as_str())
            .unwrap()
            .base()
            .is_deleted
    );

    editor
        .pointer_down(400.0, 400.0, PointerButton::Left, none(), 1)
        .unwrap();
    let id2 = editor.text_editing().cloned().unwrap();
    editor.text_insert("  a  b  ").unwrap();
    editor.commit_text(&FallbackMeasurer).unwrap();
    let committed = match editor.document().get(id2.as_str()).unwrap() {
        Element::Text(text) => text.text.clone(),
        _ => panic!("must be text"),
    };
    assert_eq!(committed, "a  b", "ends trim, inner gaps stay");
}

#[test]
fn outside_click_and_escape_commit() {
    let mut editor = Editor::new();
    editor.set_active_tool("text").unwrap();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    let id = editor.text_editing().cloned().unwrap();
    editor.text_insert("abc").unwrap();
    // Outside click commits first, then processes the press.
    let down = editor
        .pointer_down(500.0, 500.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert!(down.committed_text);
    assert!(
        editor.text_editing().is_some(),
        "text tool starts a new session"
    );
    editor.cancel_text().unwrap();

    editor.set_active_tool("select").unwrap();
    assert!(editor.text_editing().is_none());
    let committed = match editor.document().get(id.as_str()).unwrap() {
        Element::Text(text) => text.text.clone(),
        _ => panic!("must be text"),
    };
    assert_eq!(committed, "abc");

    // Escape commits too (TS finishEditing parity — never discards).
    editor.start_text_at(510.0, 510.0).unwrap();
    editor.text_insert("xyz").unwrap();
    let action = editor.handle_key(Key::Escape, none()).unwrap();
    assert!(matches!(
        action,
        KeyAction::EscapeHandled(EscapeOutcome::TextCommitted(true))
    ));
}

#[test]
fn undo_refused_while_editing() {
    let mut editor = Editor::new();
    editor.set_active_tool("text").unwrap();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert!(!editor.undo().unwrap());
    assert!(!editor.redo().unwrap());
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

#[test]
fn delete_key_deletes_and_undo_restores() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    let action = editor.handle_key(Key::Delete, none()).unwrap();
    assert!(matches!(
        action,
        KeyAction::Deleted(CommandOutcome { changed: true, .. })
    ));
    assert!(editor.document().get("r1").unwrap().base().is_deleted);
    assert!(editor.undo().unwrap());
    assert!(!editor.document().get("r1").unwrap().base().is_deleted);
}

#[test]
fn arrows_nudge_with_shift_step() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    assert!(matches!(
        editor.handle_key(Key::ArrowRight, none()).unwrap(),
        KeyAction::Nudged(_)
    ));
    assert_eq!(x_of(&editor, "r1"), 1.0);
    assert!(matches!(
        editor.handle_key(Key::ArrowDown, shift()).unwrap(),
        KeyAction::Nudged(_)
    ));
    assert_eq!(y_of(&editor, "r1"), 10.0);
}

#[test]
fn history_shortcuts_follow_ts_modifiers() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    // Drag from the center: corners/edges belong to the resize handles.
    drag(&mut editor, (50.0, 50.0), (70.0, 50.0), none());
    assert!(matches!(
        editor.handle_key(Key::Char('z'), cmd()).unwrap(),
        KeyAction::Undone(true)
    ));
    assert_eq!(x_of(&editor, "r1"), 0.0);
    assert!(matches!(
        editor.handle_key(Key::Char('y'), cmd()).unwrap(),
        KeyAction::Redone(true)
    ));
    assert_eq!(x_of(&editor, "r1"), 20.0);
    assert!(matches!(
        editor.handle_key(Key::Char('d'), cmd()).unwrap(),
        KeyAction::UnhandledIntent(KeyIntent::Duplicate)
    ));
}

#[test]
fn keys_ignored_while_editing() {
    let mut editor = Editor::new();
    editor.set_active_tool("text").unwrap();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert_eq!(
        editor.handle_key(Key::Delete, none()).unwrap(),
        KeyAction::Ignored
    );
    assert_eq!(
        editor.handle_key(Key::ArrowLeft, none()).unwrap(),
        KeyAction::Ignored
    );
}

// ---------------------------------------------------------------------------
// Tools / context menu / viewport / input routing
// ---------------------------------------------------------------------------

#[test]
fn draw_tool_drag_creates_and_click_creates_nothing() {
    let mut editor = Editor::new();
    assert!(editor.set_active_tool("rectangle").unwrap());
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.pointer_move(60.0, 60.0, none()).unwrap();
    let outcome = editor
        .pointer_up(60.0, 60.0, PointerButton::Left, none())
        .unwrap();
    let PointerUpOutcome::ShapeCreated(Some(id)) = outcome else {
        panic!("drag creates, got {outcome:?}");
    };
    let el = editor.document().get(id.as_str()).unwrap();
    assert_eq!((el.base().width, el.base().height), (50.0, 50.0));
    assert_eq!(selected(&editor), vec![id]);

    editor
        .pointer_down(200.0, 200.0, PointerButton::Left, none(), 1)
        .unwrap();
    let outcome = editor
        .pointer_up(200.0, 200.0, PointerButton::Left, none())
        .unwrap();
    assert_eq!(outcome, PointerUpOutcome::ShapeCreated(None));
}

#[test]
fn context_menu_intents_follow_selection() {
    let mut editor = Editor::new();
    assert!(editor.context_menu().is_empty());
    place(&mut editor, "a", 0.0, 0.0, 100.0, 100.0);
    place(&mut editor, "b", 200.0, 0.0, 100.0, 100.0);
    click(&mut editor, 50.0, 50.0);
    let single = editor.context_menu();
    assert!(single.contains(&ContextMenuIntent::Delete));
    assert!(single.contains(&ContextMenuIntent::Lock));
    assert!(!single.contains(&ContextMenuIntent::Group));
    assert!(!single.contains(&ContextMenuIntent::Ungroup));
    shift_click(&mut editor, 250.0, 50.0);
    let pair = editor.context_menu();
    assert!(pair.contains(&ContextMenuIntent::Group));
    editor.group_selected().unwrap();
    let grouped = editor.context_menu();
    assert!(grouped.contains(&ContextMenuIntent::Ungroup));
    editor.lock(vec![ElementId::of("a")]).unwrap();
    let locked = editor.context_menu();
    assert!(locked.contains(&ContextMenuIntent::Unlock));
}

#[test]
fn viewport_pan_zoom_and_wheel() {
    let mut editor = Editor::new();
    editor.pan_by_screen(100.0, 50.0).unwrap();
    assert_eq!(editor.state().viewport.scroll_x, 100.0);
    editor.zoom_by(2.0, 0.0, 0.0).unwrap();
    assert_eq!(editor.state().viewport.zoom, 2.0);
    editor.zoom_by(100.0, 0.0, 0.0).unwrap();
    assert_eq!(editor.state().viewport.zoom, 10.0, "clamped to MAX");
    editor.apply_wheel(0.0, 100.0, true, 50.0, 50.0).unwrap();
    assert!(editor.state().viewport.zoom < 10.0);
    assert!(editor.apply_wheel(f64::NAN, 0.0, false, 0.0, 0.0).is_err());
}

#[test]
fn handle_input_routes_every_normalized_event() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    let down = editor
        .handle_input(InputEvent::PointerDown {
            x: 50.0,
            y: 50.0,
            button: PointerButton::Left,
            modifiers: none(),
            click_count: 1,
        })
        .unwrap();
    assert!(matches!(down, InputOutcome::PointerDown(_)));
    let up = editor
        .handle_input(InputEvent::PointerUp {
            x: 50.0,
            y: 50.0,
            button: PointerButton::Left,
            modifiers: none(),
        })
        .unwrap();
    assert!(matches!(
        up,
        InputOutcome::PointerUp(PointerUpOutcome::Click)
    ));
    assert_eq!(selected(&editor), vec![ElementId::of("r1")]);
    let key = editor
        .handle_input(InputEvent::KeyDown {
            key: Key::Backspace,
            modifiers: none(),
        })
        .unwrap();
    assert!(matches!(key, InputOutcome::Key(KeyAction::Deleted(_))));
    // Non-finite input is rejected with the phase untouched.
    assert!(editor
        .handle_input(InputEvent::PointerDown {
            x: f64::NAN,
            y: 0.0,
            button: PointerButton::Left,
            modifiers: none(),
            click_count: 1,
        })
        .is_err());
    assert!(!editor.pointer_phase().is_captured());
}

#[test]
fn pointer_guards_and_undo_refusals() {
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);
    editor
        .gesture_begin(vec![ElementId::of("r1")], 0.0, 0.0)
        .unwrap();
    assert!(editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .is_err());
    editor.gesture_cancel().unwrap();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.pointer_move(50.0, 10.0, none()).unwrap();
    assert!(!editor.undo().unwrap(), "undo refused while captured");
    assert!(!editor.redo().unwrap());
    editor.pointer_cancel().unwrap();
}

// ---------------------------------------------------------------------------
// Freedraw drag + text in-session editing
// ---------------------------------------------------------------------------

#[test]
fn freedraw_drag_accumulates_and_commits_one_stroke() {
    let mut editor = Editor::new();
    assert!(editor.set_active_tool("freedraw").unwrap());
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    assert!(editor.pointer_move(30.0, 20.0, none()).unwrap());
    assert!(editor.pointer_move(50.0, 10.0, none()).unwrap());
    let up = editor
        .pointer_up(50.0, 10.0, PointerButton::Left, none())
        .unwrap();
    let PointerUpOutcome::ShapeCreated(Some(id)) = up else {
        panic!("freedraw drag must create, got {up:?}");
    };
    let Element::Freedraw(stroke) = editor.document().get(id.as_str()).unwrap() else {
        panic!("created element must be freedraw");
    };
    assert!(stroke.points.len() >= 3, "origin + two moves");
    assert_eq!(stroke.points[0], [0.0, 0.0], "origin-relative");
    assert_eq!(stroke.pressures.len(), stroke.points.len());
    assert_eq!(stroke.base.x, 10.0);
    assert_eq!(stroke.base.y, 10.0);
    assert_eq!(selected(&editor), vec![id.clone()]);
    assert!(editor.undo().unwrap());
    assert!(editor.document().get(id.as_str()).is_none());
}

#[test]
fn freedraw_tap_creates_nothing() {
    let mut editor = Editor::new();
    assert!(editor.set_active_tool("freedraw").unwrap());
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    let up = editor
        .pointer_up(10.0, 10.0, PointerButton::Left, none())
        .unwrap();
    assert!(
        matches!(up, PointerUpOutcome::ShapeCreated(None)),
        "below-threshold tap creates nothing"
    );
    assert_eq!(editor.document().element_count(), 0);
}

#[test]
fn text_backspace_delete_and_caret_follow_engine_contract() {
    let mut editor = Editor::new();
    editor.set_active_tool("text").unwrap();
    editor
        .pointer_down(10.0, 10.0, PointerButton::Left, none(), 1)
        .unwrap();
    editor.text_insert("abc").unwrap();
    assert_eq!(editor.text_set_caret(1).unwrap(), 1);
    assert!(editor.text_delete_forward().unwrap());
    assert_eq!(editor.text_draft(), Some("ac"));
    assert_eq!(editor.text_caret(), Some(1));
    assert!(editor.text_backspace().unwrap());
    assert_eq!(editor.text_draft(), Some("c"));
    assert_eq!(editor.text_caret(), Some(0));
    assert!(!editor.text_backspace().unwrap(), "start deletes nothing");
    assert_eq!(editor.text_set_caret(99).unwrap(), 1, "caret clamps");
    assert!(editor.commit_text(&FallbackMeasurer).unwrap());
    let id = editor.document().order().into_iter().next().unwrap();
    let Element::Text(committed) = editor.document().get(id.as_str()).unwrap() else {
        panic!("must be text");
    };
    assert_eq!(committed.text, "c");
}

#[test]
fn text_edit_ops_require_a_session() {
    let mut editor = Editor::new();
    assert!(editor.text_backspace().is_err());
    assert!(editor.text_delete_forward().is_err());
    assert!(editor.text_set_caret(0).is_err());
}

#[test]
fn transform_previews_agree_with_commit() {
    use opennary_core::geometry::transform::HandleType;
    let mut editor = Editor::new();
    place(&mut editor, "r1", 0.0, 0.0, 100.0, 100.0);

    // Move preview matches the committed drag delta.
    let (dx, dy, _) = editor
        .preview_move(&[ElementId::of("r1")], [10.0, 10.0], [40.0, 60.0], false)
        .unwrap();
    assert_eq!((dx, dy), (30.0, 50.0));

    // Resize preview matches the committed box.
    let preview = editor
        .preview_resize(
            &ElementId::of("r1"),
            HandleType::BottomRight,
            [200.0, 150.0],
            false,
        )
        .unwrap()
        .expect("preview");
    editor
        .resize_element(
            ElementId::of("r1"),
            preview.x,
            preview.y,
            preview.width,
            preview.height,
        )
        .unwrap();
    let el = editor.document().get("r1").unwrap();
    assert_eq!((el.base().x, el.base().y), (preview.x, preview.y));
    assert_eq!(
        (el.base().width, el.base().height),
        (preview.width, preview.height)
    );
    assert!(editor.undo().unwrap(), "one entry undoes the resize");
    let restored = editor.document().get("r1").unwrap();
    assert_eq!(
        (restored.base().width, restored.base().height),
        (100.0, 100.0)
    );

    // Rotate preview matches the committed angle.
    let angle = editor
        .preview_rotate(&ElementId::of("r1"), [0.0, 0.0], [50.0, 0.0], false)
        .unwrap()
        .expect("preview");
    editor.rotate_element(ElementId::of("r1"), angle).unwrap();
    assert_eq!(editor.document().get("r1").unwrap().base().rotation, angle);

    // Locked targets preview as unchanged, like the commit no-op.
    editor.lock(vec![ElementId::of("r1")]).unwrap();
    assert!(editor
        .preview_resize(
            &ElementId::of("r1"),
            HandleType::BottomRight,
            [300.0, 300.0],
            false
        )
        .unwrap()
        .is_none());
    assert!(editor
        .preview_rotate(&ElementId::of("r1"), [0.0, 0.0], [50.0, 0.0], false)
        .unwrap()
        .is_none());
}
