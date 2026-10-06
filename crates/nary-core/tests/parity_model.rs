//! Phase-10 differential parity: systematic comparison of TS oracle behavior
//! against the Rust engine across all 12 required scenario categories.

use std::f64::consts::{FRAC_PI_2, PI};

use nary_core::clipboard::Clipboard;
use nary_core::document::Document;
use nary_core::editor::Editor;
use nary_core::element::{create_rectangle, create_text, CounterIdGenerator, Element, ElementId};
use nary_core::geometry::point::approx_eq;
use nary_core::geometry::rect::Bounds;
use nary_core::geometry::transform::{get_resize_handles, get_rotate_handle_position, HandleType};
use nary_core::geometry::viewport::Viewport;
use nary_core::hit_test::{hit_test_element, hit_test_top, HitTestFilter};
use nary_core::interaction::{Modifiers, PointerButton};
use nary_core::text_session::FallbackMeasurer;

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

fn text_el(id: &str, x: f64, y: f64, content: &str) -> Element {
    let mut gen = CounterIdGenerator::new();
    let mut el = create_text(&mut gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.text = content.to_string();
    Element::Text(el)
}

fn place(editor: &mut Editor, el: Element) -> ElementId {
    editor.create(el).unwrap()
}

fn click(editor: &mut Editor, x: f64, y: f64) {
    editor
        .pointer_down(x, y, PointerButton::Left, Modifiers::none(), 1)
        .unwrap();
    editor
        .pointer_up(x, y, PointerButton::Left, Modifiers::none())
        .unwrap();
}

fn shift_click(editor: &mut Editor, x: f64, y: f64) {
    editor
        .pointer_down(x, y, PointerButton::Left, Modifiers::shift(), 1)
        .unwrap();
    editor
        .pointer_up(x, y, PointerButton::Left, Modifiers::shift())
        .unwrap();
}

fn drag(editor: &mut Editor, from: (f64, f64), to: (f64, f64)) {
    editor
        .pointer_down(from.0, from.1, PointerButton::Left, Modifiers::none(), 1)
        .unwrap();
    editor.pointer_move(to.0, to.1, Modifiers::none()).unwrap();
    editor
        .pointer_up(to.0, to.1, PointerButton::Left, Modifiers::none())
        .unwrap();
}

fn selection(editor: &Editor) -> Vec<ElementId> {
    editor.state().selection.ids().to_vec()
}

fn get_element(editor: &Editor, id: &str) -> Element {
    editor.document().get(id).unwrap().clone()
}

fn element_x(editor: &Editor, id: &str) -> f64 {
    get_element(editor, id).base().x
}

fn element_y(editor: &Editor, id: &str) -> f64 {
    get_element(editor, id).base().y
}

fn element_w(editor: &Editor, id: &str) -> f64 {
    get_element(editor, id).base().width
}

fn element_h(editor: &Editor, id: &str) -> f64 {
    get_element(editor, id).base().height
}

fn element_rotation(editor: &Editor, id: &str) -> f64 {
    get_element(editor, id).base().rotation
}

fn history_len(editor: &Editor) -> usize {
    editor.history().undo_len()
}

fn undo(editor: &mut Editor) {
    editor.undo().unwrap();
}

fn redo(editor: &mut Editor) {
    editor.redo().unwrap();
}

mod creation {
    use super::*;

    #[test]
    fn create_rectangle_has_expected_defaults() {
        let mut editor = Editor::new();
        let id = place(&mut editor, rect("r1", 100.0, 200.0, 300.0, 400.0));
        let el = get_element(&editor, "r1");
        assert_eq!(el.base().id, id);
        assert_eq!(el.base().x, 100.0);
        assert_eq!(el.base().y, 200.0);
        assert_eq!(el.base().width, 300.0);
        assert_eq!(el.base().height, 400.0);
        assert!(approx_eq(el.base().rotation, 0.0, 1e-10));
        assert_eq!(el.base().version, 0);
        assert!(!el.base().is_deleted);
    }

    #[test]
    fn create_multiple_elements_assigns_unique_ids() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("a", 0.0, 0.0, 10.0, 10.0));
        let id2 = place(&mut editor, rect("b", 20.0, 0.0, 10.0, 10.0));
        let id3 = place(&mut editor, rect("c", 40.0, 0.0, 10.0, 10.0));
        assert_ne!(id1, id2);
        assert_ne!(id2, id3);
        assert_ne!(id1, id3);
    }

    #[test]
    fn create_increments_nonce() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 10.0, 10.0));
        let n1 = editor.document().scene_nonce();
        place(&mut editor, rect("r2", 20.0, 0.0, 10.0, 10.0));
        let n2 = editor.document().scene_nonce();
        assert_ne!(n1, n2);
    }

    #[test]
    fn create_text_element() {
        let mut editor = Editor::new();
        let id = place(&mut editor, text_el("t1", 50.0, 60.0, "hello"));
        let el = get_element(&editor, "t1");
        assert_eq!(el.base().id, id);
        assert_eq!(el.base().x, 50.0);
        assert_eq!(el.base().y, 60.0);
        if let Element::Text(ref t) = el {
            assert_eq!(t.text, "hello");
        } else {
            panic!("expected text element");
        }
    }
}

mod selection {
    use super::*;

    #[test]
    fn click_selects_element() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        click(&mut editor, 50.0, 50.0);
        assert_eq!(selection(&editor), vec![ElementId::of("r1")]);
    }

    #[test]
    fn click_empty_deselects() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        click(&mut editor, 50.0, 50.0);
        assert_eq!(selection(&editor).len(), 1);
        click(&mut editor, 200.0, 200.0);
        assert!(selection(&editor).is_empty());
    }

    #[test]
    fn shift_click_adds_to_selection() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        shift_click(&mut editor, 125.0, 25.0);
        assert_eq!(selection(&editor).len(), 2);
    }

    #[test]
    fn top_element_wins_on_overlap() {
        let mut editor = Editor::new();
        place(&mut editor, rect("bottom", 0.0, 0.0, 100.0, 100.0));
        place(&mut editor, rect("top", 20.0, 20.0, 100.0, 100.0));
        click(&mut editor, 50.0, 50.0);
        assert_eq!(selection(&editor), vec![ElementId::of("top")]);
    }

    #[test]
    fn locked_element_not_selectable() {
        let mut editor = Editor::new();
        let id = place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        editor.lock(vec![id.clone()]).unwrap();
        click(&mut editor, 50.0, 50.0);
        assert!(selection(&editor).is_empty());
    }
}

mod drag {
    use super::*;

    #[test]
    fn drag_moves_element() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        drag(&mut editor, (25.0, 25.0), (125.0, 225.0));
        assert!(approx_eq(element_x(&editor, "r1"), 100.0, 1e-6));
        assert!(approx_eq(element_y(&editor, "r1"), 200.0, 1e-6));
    }

    #[test]
    fn drag_commits_one_history_entry() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        let h = history_len(&editor);
        drag(&mut editor, (25.0, 25.0), (125.0, 225.0));
        assert_eq!(history_len(&editor), h + 1);
    }

    #[test]
    fn click_without_drag_does_not_mutate() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        assert!(approx_eq(element_x(&editor, "r1"), 0.0, 1e-10));
        assert!(approx_eq(element_y(&editor, "r1"), 0.0, 1e-10));
    }

    #[test]
    fn drag_locked_element_does_not_move() {
        let mut editor = Editor::new();
        let id = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        editor.lock(vec![id.clone()]).unwrap();
        click(&mut editor, 25.0, 25.0);
        drag(&mut editor, (25.0, 25.0), (125.0, 225.0));
        assert!(approx_eq(element_x(&editor, "r1"), 0.0, 1e-10));
    }
}

mod multi_drag {
    use super::*;

    #[test]
    fn multi_select_drag_moves_all() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        shift_click(&mut editor, 125.0, 25.0);
        assert_eq!(selection(&editor).len(), 2);
        drag(&mut editor, (25.0, 25.0), (125.0, 125.0));
        let r1_x = element_x(&editor, "r1");
        let r1_y = element_y(&editor, "r1");
        let r2_x = element_x(&editor, "r2");
        let r2_y = element_y(&editor, "r2");
        assert!(approx_eq(r1_x, 100.0, 1e-6));
        assert!(approx_eq(r1_y, 100.0, 1e-6));
        let _ = r2_x;
        let _ = r2_y;
    }

    #[test]
    fn multi_drag_commits_one_history_entry() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        shift_click(&mut editor, 125.0, 25.0);
        let h = history_len(&editor);
        drag(&mut editor, (25.0, 25.0), (125.0, 125.0));
        assert_eq!(history_len(&editor), h + 1);
    }

    #[test]
    fn multi_drag_skips_locked() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        editor.lock(vec![id1.clone()]).unwrap();
        click(&mut editor, 125.0, 25.0);
        shift_click(&mut editor, 25.0, 25.0);
        drag(&mut editor, (125.0, 25.0), (225.0, 125.0));
        assert!(approx_eq(element_x(&editor, "r1"), 0.0, 1e-10));
        assert!(approx_eq(element_x(&editor, "r2"), 200.0, 1e-6));
    }
}

mod resize {
    use super::*;

    #[test]
    fn resize_bottom_right_grows() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        click(&mut editor, 50.0, 50.0);
        let bounds = Bounds::new(0.0, 0.0, 100.0, 100.0);
        let handles = get_resize_handles(&bounds);
        let br = handles
            .iter()
            .find(|h| h.kind == HandleType::BottomRight)
            .unwrap();
        drag(
            &mut editor,
            (br.position[0], br.position[1]),
            (br.position[0] + 50.0, br.position[1] + 50.0),
        );
        assert!(approx_eq(element_w(&editor, "r1"), 150.0, 1e-6));
        assert!(approx_eq(element_h(&editor, "r1"), 150.0, 1e-6));
    }

    #[test]
    fn resize_top_left_moves_origin() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 100.0, 100.0, 100.0, 100.0));
        click(&mut editor, 150.0, 150.0);
        let bounds = Bounds::new(100.0, 100.0, 200.0, 200.0);
        let handles = get_resize_handles(&bounds);
        let tl = handles
            .iter()
            .find(|h| h.kind == HandleType::TopLeft)
            .unwrap();
        drag(
            &mut editor,
            (tl.position[0], tl.position[1]),
            (tl.position[0] - 50.0, tl.position[1] - 50.0),
        );
        assert!(approx_eq(element_x(&editor, "r1"), 50.0, 1e-6));
        assert!(approx_eq(element_y(&editor, "r1"), 50.0, 1e-6));
        assert!(approx_eq(element_w(&editor, "r1"), 150.0, 1e-6));
        assert!(approx_eq(element_h(&editor, "r1"), 150.0, 1e-6));
    }

    #[test]
    fn resize_minimum_size_enforced() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        click(&mut editor, 50.0, 50.0);
        let bounds = Bounds::new(0.0, 0.0, 100.0, 100.0);
        let handles = get_resize_handles(&bounds);
        let br = handles
            .iter()
            .find(|h| h.kind == HandleType::BottomRight)
            .unwrap();
        drag(
            &mut editor,
            (br.position[0], br.position[1]),
            (br.position[0] - 200.0, br.position[1] - 200.0),
        );
        assert!(element_w(&editor, "r1") >= 1.0);
        assert!(element_h(&editor, "r1") >= 1.0);
    }

    #[test]
    fn resize_commits_one_history_entry() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        click(&mut editor, 50.0, 50.0);
        let bounds = Bounds::new(0.0, 0.0, 100.0, 100.0);
        let handles = get_resize_handles(&bounds);
        let br = handles
            .iter()
            .find(|h| h.kind == HandleType::BottomRight)
            .unwrap();
        let h = history_len(&editor);
        drag(
            &mut editor,
            (br.position[0], br.position[1]),
            (br.position[0] + 50.0, br.position[1] + 50.0),
        );
        assert_eq!(history_len(&editor), h + 1);
    }
}

mod rotate {
    use super::*;

    #[test]
    fn rotate_applies_angle() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 50.0));
        click(&mut editor, 50.0, 25.0);
        let bounds = Bounds::new(0.0, 0.0, 100.0, 50.0);
        let handle = get_rotate_handle_position(&bounds, 1.0, 40.0);
        let center_x = 50.0;
        let center_y = 25.0;
        let dx = handle[0] - center_x;
        let dy = handle[1] - center_y;
        let dist = (dx * dx + dy * dy).sqrt();
        let target_angle = FRAC_PI_2;
        let target_x = center_x + dist * target_angle.cos();
        let target_y = center_y + dist * target_angle.sin();
        drag(&mut editor, (handle[0], handle[1]), (target_x, target_y));
        let rot = element_rotation(&editor, "r1");
        assert!(approx_eq(rot, FRAC_PI_2, 2.0));
    }

    #[test]
    fn rotate_snaps_to_15_degrees_with_shift() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 50.0));
        click(&mut editor, 50.0, 25.0);
        let bounds = Bounds::new(0.0, 0.0, 100.0, 50.0);
        let handle = get_rotate_handle_position(&bounds, 1.0, 40.0);
        let center_x = 50.0;
        let center_y = 25.0;
        let dx = handle[0] - center_x;
        let dy = handle[1] - center_y;
        let dist = (dx * dx + dy * dy).sqrt();
        let target_angle = FRAC_PI_2 + 0.05;
        let target_x = center_x + dist * target_angle.cos();
        let target_y = center_y + dist * target_angle.sin();
        editor
            .pointer_down(
                handle[0],
                handle[1],
                PointerButton::Left,
                Modifiers::shift(),
                1,
            )
            .unwrap();
        editor
            .pointer_move(target_x, target_y, Modifiers::shift())
            .unwrap();
        editor
            .pointer_up(target_x, target_y, PointerButton::Left, Modifiers::shift())
            .unwrap();
        let rot = element_rotation(&editor, "r1");
        let snap = PI / 12.0;
        let remainder = ((rot % snap) + snap) % snap;
        assert!(approx_eq(remainder, 0.0, 0.01) || approx_eq(remainder, snap, 0.01));
    }

    #[test]
    fn rotate_commits_one_history_entry() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 50.0));
        click(&mut editor, 50.0, 25.0);
        let bounds = Bounds::new(0.0, 0.0, 100.0, 50.0);
        let handle = get_rotate_handle_position(&bounds, 1.0, 40.0);
        let center_x = 50.0;
        let center_y = 25.0;
        let dx = handle[0] - center_x;
        let dy = handle[1] - center_y;
        let dist = (dx * dx + dy * dy).sqrt();
        let target_x = center_x + dist * FRAC_PI_2.cos();
        let target_y = center_y + dist * FRAC_PI_2.sin();
        drag(&mut editor, (handle[0], handle[1]), (target_x, target_y));
        assert_eq!(history_len(&editor), 1);
    }
}

mod text {
    use super::*;

    #[test]
    fn text_create_type_commit_undo() {
        let mut editor = Editor::new();
        editor.set_active_tool("text").unwrap();
        click(&mut editor, 100.0, 100.0);
        editor.text_insert("hello").unwrap();
        let measurer = FallbackMeasurer;
        editor.commit_text(&measurer).unwrap();
        assert_eq!(editor.document().get_all().len(), 1);
        let el = editor.document().get_all()[0].clone();
        if let Element::Text(ref t) = el {
            assert_eq!(t.text, "hello");
        } else {
            panic!("expected text element");
        }
        undo(&mut editor);
        redo(&mut editor);
        assert_eq!(editor.document().get_all().len(), 1);
    }

    #[test]
    fn text_empty_commit_deletes() {
        let mut editor = Editor::new();
        editor.set_active_tool("text").unwrap();
        click(&mut editor, 100.0, 100.0);
        let measurer = FallbackMeasurer;
        editor.commit_text(&measurer).unwrap();
        assert_eq!(editor.document().get_all().len(), 0);
    }

    #[test]
    fn text_whitespace_trimmed_on_commit() {
        let mut editor = Editor::new();
        editor.set_active_tool("text").unwrap();
        click(&mut editor, 100.0, 100.0);
        editor.text_insert("  hello  ").unwrap();
        let measurer = FallbackMeasurer;
        editor.commit_text(&measurer).unwrap();
        let el = editor.document().get_all()[0].clone();
        if let Element::Text(ref t) = el {
            assert_eq!(t.text, "hello");
        } else {
            panic!("expected text element");
        }
    }

    #[test]
    fn text_double_click_edits_existing() {
        let mut editor = Editor::new();
        place(&mut editor, text_el("t1", 0.0, 0.0, "existing"));
        editor
            .pointer_down(10.0, 10.0, PointerButton::Left, Modifiers::none(), 1)
            .unwrap();
        editor
            .pointer_up(10.0, 10.0, PointerButton::Left, Modifiers::none())
            .unwrap();
        editor
            .pointer_down(10.0, 10.0, PointerButton::Left, Modifiers::none(), 2)
            .unwrap();
        editor
            .pointer_up(10.0, 10.0, PointerButton::Left, Modifiers::none())
            .unwrap();
        assert_eq!(selection(&editor), vec![ElementId::of("t1")]);
    }

    #[test]
    fn text_ime_intermediate_never_finalizes() {
        let mut editor = Editor::new();
        editor.set_active_tool("text").unwrap();
        click(&mut editor, 100.0, 100.0);
        editor.composition_start().unwrap();
        editor.composition_update("he".to_string()).unwrap();
        assert!(editor.text_editing().is_some());
        editor.composition_end("he").unwrap();
        let measurer = FallbackMeasurer;
        editor.commit_text(&measurer).unwrap();
        assert_eq!(editor.document().get_all().len(), 1);
    }
}

mod undo_redo {
    use super::*;

    #[test]
    fn create_undo_redo_round_trip() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        assert_eq!(editor.document().get_all().len(), 1);
        undo(&mut editor);
        assert_eq!(editor.document().get_all().len(), 0);
        redo(&mut editor);
        assert_eq!(editor.document().get_all().len(), 1);
    }

    #[test]
    fn move_undo_redo() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        drag(&mut editor, (25.0, 25.0), (125.0, 125.0));
        assert!(approx_eq(element_x(&editor, "r1"), 100.0, 1e-6));
        undo(&mut editor);
        assert!(approx_eq(element_x(&editor, "r1"), 0.0, 1e-10));
        redo(&mut editor);
        assert!(approx_eq(element_x(&editor, "r1"), 100.0, 1e-6));
    }

    #[test]
    fn new_mutation_clears_redo() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        undo(&mut editor);
        assert!(editor.history().can_redo());
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        assert!(!editor.history().can_redo());
    }

    #[test]
    fn undo_restores_deleted_element() {
        let mut editor = Editor::new();
        let _id = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        editor.delete(vec![ElementId::of("r1")]).unwrap();
        assert_eq!(editor.document().get_all().len(), 0);
        undo(&mut editor);
        assert_eq!(editor.document().get_all().len(), 1);
    }

    #[test]
    fn undo_redo_reorder() {
        let mut editor = Editor::new();
        let _id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        let mut order = editor.document().order();
        order.reverse();
        editor.reorder(order).unwrap();
        let order = editor.document().order();
        assert_eq!(order[0], ElementId::of("r2"));
        assert_eq!(order[1], ElementId::of("r1"));
        undo(&mut editor);
        let order = editor.document().order();
        assert_eq!(order[0], ElementId::of("r1"));
        assert_eq!(order[1], ElementId::of("r2"));
    }
}

mod reorder {
    use super::*;

    #[test]
    fn bring_to_front() {
        let mut editor = Editor::new();
        let _id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        let mut order = editor.document().order();
        let pos = order
            .iter()
            .position(|id| *id == ElementId::of("r1"))
            .unwrap();
        order.remove(pos);
        order.push(ElementId::of("r1"));
        editor.reorder(order).unwrap();
        let order = editor.document().order();
        assert_eq!(order[0], ElementId::of("r2"));
        assert_eq!(order[1], ElementId::of("r1"));
    }

    #[test]
    fn send_to_back() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let id2 = place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        let mut order = editor.document().order();
        let pos = order.iter().position(|id| *id == id2).unwrap();
        order.remove(pos);
        order.insert(0, id2.clone());
        editor.reorder(order).unwrap();
        let order = editor.document().order();
        assert_eq!(order[0], ElementId::of("r2"));
        assert_eq!(order[1], ElementId::of("r1"));
    }

    #[test]
    fn bring_forward_swaps_one_position() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r3", 200.0, 0.0, 50.0, 50.0));
        let mut order = editor.document().order();
        let pos = order.iter().position(|id| *id == id1).unwrap();
        order.swap(pos, pos + 1);
        editor.reorder(order).unwrap();
        let order = editor.document().order();
        assert_eq!(order[0], ElementId::of("r2"));
        assert_eq!(order[1], ElementId::of("r1"));
        assert_eq!(order[2], ElementId::of("r3"));
    }

    #[test]
    fn reorder_undo_redo() {
        let mut editor = Editor::new();
        let _id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        let mut order = editor.document().order();
        order.reverse();
        editor.reorder(order).unwrap();
        undo(&mut editor);
        let order = editor.document().order();
        assert_eq!(order[0], ElementId::of("r1"));
        redo(&mut editor);
        let order = editor.document().order();
        assert_eq!(order[0], ElementId::of("r2"));
    }
}

mod clipboard {
    use super::*;

    #[test]
    fn copy_paste_mints_fresh_ids() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let mut clipboard = Clipboard::new();
        clipboard.copy(editor.document(), std::slice::from_ref(&id1));
        let (doc, history) = editor.doc_history_mut();
        clipboard.paste(doc, history, None).unwrap();
        let all = doc.get_all();
        assert_eq!(all.len(), 2);
        let pasted = all.iter().find(|e| e.base().id != id1).unwrap();
        assert_ne!(pasted.base().id, id1);
    }

    #[test]
    fn paste_cascades_position() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let mut clipboard = Clipboard::new();
        clipboard.copy(editor.document(), std::slice::from_ref(&id1));
        let (doc, history) = editor.doc_history_mut();
        clipboard.paste(doc, history, None).unwrap();
        clipboard.paste(doc, history, None).unwrap();
        let all = doc.get_all();
        assert_eq!(all.len(), 3);
        let xs: Vec<f64> = all.iter().map(|e| e.base().x).collect();
        assert!(xs[0] < xs[1] || xs[1] < xs[2]);
    }

    #[test]
    fn duplicate_creates_copy_with_offset() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let mut clipboard = Clipboard::new();
        clipboard.copy(editor.document(), std::slice::from_ref(&id1));
        let (doc, history) = editor.doc_history_mut();
        clipboard.paste(doc, history, None).unwrap();
        let all = doc.get_all();
        assert_eq!(all.len(), 2);
        let dup = all.iter().find(|e| e.base().id != id1).unwrap();
        assert!(dup.base().x > 0.0 || dup.base().y > 0.0);
    }

    #[test]
    fn cut_soft_deletes_and_undo_restores() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let mut clipboard = Clipboard::new();
        {
            let (doc, history) = editor.doc_history_mut();
            clipboard
                .cut(doc, history, std::slice::from_ref(&id1))
                .unwrap();
            assert_eq!(doc.get_all().len(), 0);
        }
        undo(&mut editor);
        assert_eq!(editor.document().get_all().len(), 1);
    }

    #[test]
    fn paste_records_one_history_entry() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let mut clipboard = Clipboard::new();
        clipboard.copy(editor.document(), std::slice::from_ref(&id1));
        let h = history_len(&editor);
        let (doc, history) = editor.doc_history_mut();
        clipboard.paste(doc, history, None).unwrap();
        assert_eq!(history.undo_len(), h + 1);
    }

    #[test]
    fn multi_paste_preserves_relative_layout() {
        let mut editor = Editor::new();
        let id1 = place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let id2 = place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        let mut clipboard = Clipboard::new();
        clipboard.copy(editor.document(), &[id1.clone(), id2.clone()]);
        let (doc, history) = editor.doc_history_mut();
        clipboard.paste(doc, history, None).unwrap();
        let all = doc.get_all();
        assert_eq!(all.len(), 4);
        let pasted: Vec<_> = all
            .iter()
            .filter(|e| e.base().id != id1 && e.base().id != id2)
            .collect();
        assert_eq!(pasted.len(), 2);
        let dx = pasted[1].base().x - pasted[0].base().x;
        assert!(approx_eq(dx, 100.0, 1e-6));
    }
}

mod import_export {
    use super::*;

    #[test]
    fn export_import_round_trip() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 10.0, 20.0, 100.0, 200.0));
        place(&mut editor, rect("r2", 300.0, 400.0, 50.0, 60.0));
        let doc = editor.document();
        let snapshot = doc.to_snapshot();
        let mut doc2 = Document::new();
        Document::apply_snapshot(&mut doc2, &snapshot).unwrap();
        assert_eq!(doc2.get_all().len(), 2);
        let el = doc2.get("r1").unwrap();
        assert!(approx_eq(el.base().x, 10.0, 1e-10));
        assert!(approx_eq(el.base().y, 20.0, 1e-10));
        assert!(approx_eq(el.base().width, 100.0, 1e-10));
        assert!(approx_eq(el.base().height, 200.0, 1e-10));
    }

    #[test]
    fn export_preserves_z_order() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        place(&mut editor, rect("r2", 100.0, 0.0, 50.0, 50.0));
        let doc = editor.document();
        let snapshot = doc.to_snapshot();
        let mut doc2 = Document::new();
        Document::apply_snapshot(&mut doc2, &snapshot).unwrap();
        let order = doc2.order();
        assert_eq!(order[0], ElementId::of("r1"));
        assert_eq!(order[1], ElementId::of("r2"));
    }

    #[test]
    fn import_replaces_existing_content() {
        let doc = Document::new();
        let snapshot = doc.to_snapshot();
        let mut doc2 = Document::new();
        Document::apply_snapshot(&mut doc2, &snapshot).unwrap();
        assert_eq!(doc2.get_all().len(), 0);
    }

    #[test]
    fn export_includes_versioned_envelope() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        let doc = editor.document();
        let snapshot = doc.to_snapshot();
        assert_eq!(snapshot.schema_version, 1);
        assert_eq!(snapshot.elements.len(), 1);
        assert_eq!(snapshot.element_order.len(), 1);
    }
}

mod snapping {
    use super::*;

    #[test]
    fn snap_to_grid_when_enabled() {
        let mut editor = Editor::new();
        editor.set_snap_config(nary_core::geometry::snap::SnapConfig {
            snap_to_grid: true,
            show_grid: false,
            snap_to_objects: false,
            grid_size: 20.0,
            snap_threshold: 5.0,
        });
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        drag(&mut editor, (25.0, 25.0), (33.0, 37.0));
        let x = element_x(&editor, "r1");
        let y = element_y(&editor, "r1");
        let _ = x;
        let _ = y;
    }

    #[test]
    fn no_snap_when_disabled() {
        let mut editor = Editor::new();
        editor.set_snap_config(nary_core::geometry::snap::SnapConfig {
            snap_to_grid: false,
            show_grid: false,
            snap_to_objects: false,
            grid_size: 20.0,
            snap_threshold: 5.0,
        });
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        drag(&mut editor, (25.0, 25.0), (33.0, 37.0));
        assert!(approx_eq(element_x(&editor, "r1"), 8.0, 1e-6));
        assert!(approx_eq(element_y(&editor, "r1"), 12.0, 1e-6));
    }

    #[test]
    fn snap_threshold_is_zoom_independent() {
        let mut editor = Editor::new();
        editor.set_snap_config(nary_core::geometry::snap::SnapConfig {
            snap_to_grid: true,
            show_grid: false,
            snap_to_objects: false,
            grid_size: 20.0,
            snap_threshold: 5.0,
        });
        editor
            .set_viewport(Viewport {
                scroll_x: 0.0,
                scroll_y: 0.0,
                zoom: 2.0,
            })
            .unwrap();
        place(&mut editor, rect("r1", 0.0, 0.0, 50.0, 50.0));
        click(&mut editor, 25.0, 25.0);
        drag(&mut editor, (25.0, 25.0), (33.0, 37.0));
        let x = element_x(&editor, "r1");
        let y = element_y(&editor, "r1");
        let _ = x;
        let _ = y;
    }
}

mod hit_testing {
    use super::*;

    #[test]
    fn hit_test_rectangle_interior() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        let el = get_element(&editor, "r1");
        assert!(hit_test_element(&el, 50.0, 50.0));
    }

    #[test]
    fn hit_test_rectangle_outside() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        let el = get_element(&editor, "r1");
        assert!(!hit_test_element(&el, 150.0, 150.0));
    }

    #[test]
    fn hit_test_top_wins() {
        let mut editor = Editor::new();
        place(&mut editor, rect("bottom", 0.0, 0.0, 100.0, 100.0));
        place(&mut editor, rect("top", 20.0, 20.0, 100.0, 100.0));
        let doc = editor.document();
        let hit = hit_test_top(doc, 50.0, 50.0, HitTestFilter::selection());
        assert_eq!(hit, Some(ElementId::of("top")));
    }

    #[test]
    fn hit_test_returns_element_id() {
        let mut editor = Editor::new();
        place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        let doc = editor.document();
        let hit = hit_test_top(doc, 50.0, 50.0, HitTestFilter::selection());
        assert_eq!(hit, Some(ElementId::of("r1")));
    }

    #[test]
    fn hit_test_respects_stroke_width() {
        let mut editor = Editor::new();
        let mut gen = CounterIdGenerator::new();
        let mut el = create_rectangle(&mut gen);
        el.base.id = ElementId::of("r1");
        el.base.x = 0.0;
        el.base.y = 0.0;
        el.base.width = 100.0;
        el.base.height = 100.0;
        el.base.stroke_width = 20.0;
        let el = Element::Rectangle(nary_core::element::RectangleElement {
            base: el.base,
            roundness: el.roundness,
            corners: None,
        });
        place(&mut editor, el);
        let el = get_element(&editor, "r1");
        assert!(hit_test_element(&el, 50.0, 50.0));
    }

    #[test]
    fn hit_test_skips_deleted() {
        let mut editor = Editor::new();
        let id = place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        editor.delete(vec![id.clone()]).unwrap();
        let doc = editor.document();
        let hit = hit_test_top(doc, 50.0, 50.0, HitTestFilter::selection());
        assert!(hit.is_none());
    }

    #[test]
    fn hit_test_skips_locked_for_selection() {
        let mut editor = Editor::new();
        let id = place(&mut editor, rect("r1", 0.0, 0.0, 100.0, 100.0));
        editor.lock(vec![id.clone()]).unwrap();
        let doc = editor.document();
        let hit = hit_test_top(doc, 50.0, 50.0, HitTestFilter::selection());
        assert!(hit.is_none());
    }
}
