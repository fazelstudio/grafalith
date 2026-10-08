//! `Editor::apply_boolean`: two rectangles in, exact result boxes out, one
//! undoable entry (inputs soft-deleted, fresh result rectangles on top).

use opennary_core::boolean::BooleanOp;
use opennary_core::editor::Editor;
use opennary_core::element::{
    create_ellipse, create_rectangle, CounterIdGenerator, Element, ElementId, FillStyle,
};
use opennary_core::{EngineError, EngineResult};

fn rect(
    gen: &mut CounterIdGenerator,
    id: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    color: &str,
) -> Element {
    let mut el = create_rectangle(gen);
    el.base.id = ElementId::of(id);
    el.base.x = x;
    el.base.y = y;
    el.base.width = w;
    el.base.height = h;
    el.base.background_color = FillStyle::Solid {
        color: color.to_string(),
    };
    Element::Rectangle(el)
}

fn editor_with_overlap() -> EngineResult<Editor> {
    let mut editor = Editor::new();
    let mut gen = CounterIdGenerator::new();
    editor.create(rect(&mut gen, "a", 0.0, 0.0, 10.0, 10.0, "#ff0000"))?;
    editor.create(rect(&mut gen, "b", 5.0, 5.0, 10.0, 10.0, "#0000ff"))?;
    Ok(editor)
}

#[test]
fn union_replaces_inputs_with_exact_cover_and_first_style() {
    let mut editor = editor_with_overlap().unwrap();
    let outcome = editor
        .apply_boolean(BooleanOp::Union, ElementId::of("a"), ElementId::of("b"))
        .unwrap();
    assert!(outcome.changed);
    assert_eq!(editor.history().undo_len(), 3);

    let live = editor.document().get_all();
    assert_eq!(live.len(), 3);
    for element in &live {
        assert_eq!(
            element.base().background_color,
            FillStyle::Solid {
                color: "#ff0000".to_string()
            },
            "results inherit the first input's fill"
        );
        assert!(!["a", "b"].contains(&element.base().id.as_str()));
    }
    // Exact cover: 75 + 75 - 25 overlap... union area is 175.
    let area: f64 = live
        .iter()
        .map(|el| el.base().width * el.base().height)
        .sum();
    assert_eq!(area, 175.0);

    editor.undo().unwrap();
    assert_eq!(editor.document().element_count(), 2);
    assert!(editor.document().get("a").is_some());
    assert!(editor.document().get("b").is_some());

    editor.redo().unwrap();
    assert_eq!(editor.document().element_count(), 3);
}

#[test]
fn full_cover_subtraction_destroys_both_inputs() {
    let mut editor = Editor::new();
    let mut gen = CounterIdGenerator::new();
    editor
        .create(rect(&mut gen, "big", 0.0, 0.0, 20.0, 20.0, "#00ff00"))
        .unwrap();
    editor
        .create(rect(&mut gen, "cover", -5.0, -5.0, 30.0, 30.0, "#00ff00"))
        .unwrap();
    editor
        .apply_boolean(
            BooleanOp::Subtract,
            ElementId::of("big"),
            ElementId::of("cover"),
        )
        .unwrap();
    assert_eq!(editor.document().element_count(), 0);
    editor.undo().unwrap();
    assert_eq!(editor.document().element_count(), 2);
}

#[test]
fn boolean_errors_are_explicit_per_input_kind() {
    let mut editor = editor_with_overlap().unwrap();
    // Same id twice.
    assert!(matches!(
        editor.apply_boolean(BooleanOp::Union, ElementId::of("a"), ElementId::of("a")),
        Err(EngineError::InvalidInput(_))
    ));
    // Unknown id.
    assert!(matches!(
        editor.apply_boolean(BooleanOp::Union, ElementId::of("a"), ElementId::of("ghost")),
        Err(EngineError::NotFound(_))
    ));
    // Non-rectangle is Unsupported, and changes nothing.
    let mut gen = CounterIdGenerator::new();
    let mut ellipse = create_ellipse(&mut gen);
    ellipse.base.id = ElementId::of("e");
    editor.create(Element::Ellipse(ellipse)).unwrap();
    let nonce_before = editor.document().scene_nonce();
    assert!(matches!(
        editor.apply_boolean(BooleanOp::Union, ElementId::of("e"), ElementId::of("a")),
        Err(EngineError::Unsupported(_))
    ));
    assert_eq!(editor.document().scene_nonce(), nonce_before);
}

use opennary_core::element::{PathElement, PathSegment};

fn closed_square(gen: &mut CounterIdGenerator, id: &str, x: f64, y: f64, size: f64) -> Element {
    let mut base = create_rectangle(gen).base;
    base.id = ElementId::of(id);
    base.x = x;
    base.y = y;
    base.width = size;
    base.height = size;
    Element::Path(PathElement {
        base,
        segments: vec![
            PathSegment {
                point: [0.0, 0.0],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [size, 0.0],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [size, size],
                handle_in: None,
                handle_out: None,
            },
            PathSegment {
                point: [0.0, size],
                handle_in: None,
                handle_out: None,
            },
        ],
        closed: true,
    })
}

#[test]
fn path_union_replaces_inputs_with_one_path_and_undoes() {
    let mut editor = Editor::new();
    let mut gen = CounterIdGenerator::new();
    editor
        .create(closed_square(&mut gen, "pa", 0.0, 0.0, 10.0))
        .unwrap();
    editor
        .create(closed_square(&mut gen, "pb", 5.0, 5.0, 10.0))
        .unwrap();
    let outcome = editor
        .apply_boolean(
            opennary_core::boolean::BooleanOp::Union,
            ElementId::of("pa"),
            ElementId::of("pb"),
        )
        .unwrap();
    assert!(outcome.changed);
    let live = editor.document().get_all();
    assert_eq!(live.len(), 1);
    assert!(matches!(live[0], Element::Path(_)));
    assert!(live[0].base().width > 0.0 && live[0].base().height > 0.0);

    editor.undo().unwrap();
    assert_eq!(editor.document().element_count(), 2);
    assert!(editor.document().get("pa").is_some());
}
