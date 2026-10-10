//! Custom UI button scenario in Rust: a host builds its own toolbar
//! with zero built-in UI and drives the engine purely through commands.
//!
//! Run: `cargo run -p grafalith-bindings --example custom_button`

use grafalith_bindings::Engine;

fn apply(engine: &mut Engine, ops: &str) -> serde_json::Value {
    let out = engine.apply_batch(ops);
    serde_json::from_str(&out).expect("batch result parses")
}

fn main() {
    let mut engine = Engine::new();

    // 1. A custom "Rectangle" button: activates the tool, exactly like a
    //    host-designed toolbar would.
    let clicked = apply(&mut engine, r#"[{"op": "setTool", "tool": "rectangle"}]"#);
    assert_eq!(clicked["results"][0]["data"]["accepted"], true);
    println!("rectangle button accepted");

    // 2. The canvas gesture commits one rectangle (pointer ops), then the
    //    host reads toolbar state (undo/redo/selection) for reactivity.
    let drawn = apply(
        &mut engine,
        r#"[
            {"op": "pointerDown", "x": 10, "y": 10, "button": "left"},
            {"op": "pointerMove", "x": 110, "y": 60},
            {"op": "pointerUp", "x": 110, "y": 60, "button": "left"},
            {"op": "sessionState"}
        ]"#,
    );
    let state = &drawn["results"][3]["data"];
    assert_eq!(engine.element_count(), 1);
    println!(
        "drawn: selection={} can_undo={}",
        state["selection"], state["canUndo"]
    );

    // 3. A custom "Delete" button removes the selection; undo restores it.
    apply(&mut engine, r#"[{"op": "deleteSelected"}]"#);
    assert_eq!(engine.element_count(), 0);
    apply(&mut engine, r#"[{"op": "undo"}]"#);
    assert_eq!(engine.element_count(), 1);
    println!("delete + undo round-trip ok");

    // 4. One crossing renders the frame hosts paint.
    let frame = apply(
        &mut engine,
        r#"[{"op": "renderModel", "canvasWidth": 800, "canvasHeight": 600}]"#,
    );
    assert_eq!(
        frame["results"][0]["data"]["base"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    println!("renderModel carries 1 entry — custom UI scenario complete");
}
