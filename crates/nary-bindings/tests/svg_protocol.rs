//! `importSvg` protocol tests (M8, `svg` feature): SVG import over the
//! JSON boundary with tracked/untracked semantics and undo.

#![cfg(feature = "svg")]

use nary_bindings::Engine;
use serde_json::{json, Value};

const SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="40" fill="#ff0000"/>
  <circle cx="50" cy="70" r="10" fill="#0000ff"/>
</svg>"##;

fn run(engine: &mut Engine, ops: Value) -> Value {
    let out = engine.apply_batch(&ops.to_string());
    serde_json::from_str(&out).expect("batch result parses")
}

#[test]
fn import_svg_replaces_content_and_counts() {
    let mut engine = Engine::new();
    let result = run(&mut engine, json!([{"op": "importSvg", "svg": SVG}]));
    assert_eq!(result["results"][0]["op"], "importSvg");
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(result["results"][0]["data"]["imported"], 2);
    assert_eq!(engine.element_count(), 2);
}

#[test]
fn import_svg_tracked_is_one_undoable_entry() {
    let mut engine = Engine::new();
    let result = run(
        &mut engine,
        json!([{"op": "importSvg", "svg": SVG, "tracked": true}]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(engine.element_count(), 2);
    let undo = run(&mut engine, json!([{"op": "undo"}]));
    assert_eq!(undo["results"][0]["ok"], true);
    assert_eq!(engine.element_count(), 0);
}

#[test]
fn import_svg_rejects_garbage_without_touching_state() {
    let mut engine = Engine::new();
    let result = run(
        &mut engine,
        json!([{"op": "importSvg", "svg": "not xml <"}]),
    );
    assert_eq!(result["results"][0]["ok"], false);
    assert_eq!(result["results"][0]["code"], "invalidInput");
    assert_eq!(engine.element_count(), 0);
}
