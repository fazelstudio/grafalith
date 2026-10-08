//! End-to-end proof that an out-of-workspace crate extends the engine:
//! tool wiring, history-tracked command execution with undo, and custom
//! hit-test behavior through the dispatch helpers.

use ext_sticker::{
    StickerExtension, StickerShape, STICKER_CREATE_COMMAND, STICKER_TOOL, STICKER_TYPE,
};
use opennary_core::editor::Editor;
use opennary_core::element::{CustomElement, Element};
use opennary_core::interaction::ToolId;
use opennary_core::shape_extension::{dispatch_bounds, dispatch_hit_test};

fn sticker_custom(editor: &Editor) -> CustomElement {
    let live = editor.document().get_all();
    assert_eq!(live.len(), 1);
    match live[0] {
        Element::Custom(ref custom) => custom.clone(),
        _ => panic!("sticker command creates a Custom element"),
    }
}

#[test]
fn external_extension_registers_tool_shape_and_command() {
    let mut editor = Editor::new();
    editor
        .register_extension(Box::new(StickerExtension::new()))
        .expect("compatible extension registers");
    assert!(editor
        .tool_registry()
        .contains(&ToolId::Custom(STICKER_TOOL.to_string())));
    assert_eq!(
        editor.extension_command_ids(),
        vec![STICKER_CREATE_COMMAND.to_string()]
    );
    assert_eq!(editor.extension_registry().shapes().len(), 1);
    assert_eq!(editor.extension_registry().shapes()[0].0, STICKER_TYPE);
}

#[test]
fn external_command_creates_and_undoes_one_entry() {
    let mut editor = Editor::new();
    editor
        .register_extension(Box::new(StickerExtension::new()))
        .expect("compatible extension registers");
    let outcome = editor
        .execute_extension_command(STICKER_CREATE_COMMAND)
        .expect("sticker command runs");
    assert!(outcome.changed);
    let custom = sticker_custom(&editor);
    assert_eq!(custom.type_name, STICKER_TYPE);

    assert!(editor.undo().expect("undo works"));
    assert_eq!(editor.document().element_count(), 0);
    assert!(editor.redo().expect("redo works"));
    assert_eq!(editor.document().element_count(), 1);
}

#[test]
fn external_shape_has_circle_hit_behavior() {
    let mut editor = Editor::new();
    editor
        .register_extension(Box::new(StickerExtension::new()))
        .expect("compatible extension registers");
    editor
        .execute_extension_command(STICKER_CREATE_COMMAND)
        .expect("sticker command runs");
    // Sticker sits at (100, 100), 120x120: center hits, the box corner
    // (inside the AABB, outside the circle) misses.
    let custom = sticker_custom(&editor);
    let shape = StickerShape;
    assert_eq!(dispatch_hit_test(&shape, &custom, 160.0, 160.0), Some(true));
    assert_eq!(dispatch_hit_test(&shape, &custom, 100.0, 100.0), Some(false));
    assert_eq!(
        dispatch_bounds(&shape, &custom).map(|bounds| (bounds.min_x, bounds.min_y)),
        Some((100.0, 100.0))
    );
}
