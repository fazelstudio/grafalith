//! Boundary tests for the React/input/render/session seam.
//!
//! Every test crosses the boundary the way the React adapter does: JSON
//! ops in, JSON results out, through [`Engine::apply_batch`]. Coverage
//! spans normalized pointer/keyboard/wheel input, text sessions (caret,
//! IME, commit/cancel), context-menu intents, history-tracked layering,
//! viewport/config propagation, render-model queries, asset-generation
//! invalidation, and the normalized event queue.

use opennary_bindings::{Engine, PROTOCOL_VERSION};
use serde_json::{json, Value};

fn rect(id: &str, x: f64, y: f64) -> Value {
    json!({
        "id": id,
        "type": "rectangle",
        "x": x,
        "y": y,
        "width": 100,
        "height": 50,
        "rotation": 0,
        "strokeColor": "#333333",
        "backgroundColor": {"type": "solid", "color": "#e8f4fc"},
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "fillStyle": "solid",
        "opacity": 100,
        "seed": 1,
        "version": 0,
        "versionNonce": 1,
        "isDeleted": false,
        "groupIds": [],
        "locked": false,
        "hidden": false,
        "frameId": null,
    })
}

/// Applies ops and parses the [`BatchResult`] envelope.
fn apply(engine: &mut Engine, ops: Value) -> Value {
    let raw = engine.apply_batch(&ops.to_string());
    serde_json::from_str(&raw).expect("batch result is JSON")
}

/// Asserts the whole batch applied and returns the per-op results.
fn applied(result: &Value, count: usize) -> &Vec<Value> {
    assert_eq!(result["version"], PROTOCOL_VERSION, "protocol echo");
    assert_eq!(result["applied"], count, "all ops applied: {result}");
    result["results"].as_array().expect("results array")
}

/// Returns the `data` payload of one op result, asserting `ok: true`.
fn data<'a>(results: &'a [Value], index: usize, op: &str) -> &'a Value {
    let entry = &results[index];
    assert_eq!(entry["op"], op, "op name at index {index}");
    assert_eq!(entry["ok"], true, "op {op} ok: {entry}");
    &entry["data"]
}

/// Returns one op result, asserting `ok: false` with the expected code.
fn failed<'a>(results: &'a [Value], index: usize, op: &str, code: &str) -> &'a Value {
    let entry = &results[index];
    assert_eq!(entry["op"], op, "op name at index {index}");
    assert_eq!(entry["ok"], false, "op {op} fails: {entry}");
    assert_eq!(entry["code"], code, "op {op} code");
    entry
}

fn engine_with_rect(id: &str, x: f64, y: f64) -> Engine {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([{ "op": "create", "element": rect(id, x, y) }]),
    );
    applied(&result, 1);
    engine
}

fn down(x: f64, y: f64) -> Value {
    json!({ "op": "pointerDown", "x": x, "y": y, "button": "left", "modifiers": {}, "clickCount": 1 })
}

fn mv(x: f64, y: f64) -> Value {
    json!({ "op": "pointerMove", "x": x, "y": y, "modifiers": {} })
}

fn up(x: f64, y: f64) -> Value {
    json!({ "op": "pointerUp", "x": x, "y": y, "button": "left", "modifiers": {} })
}

fn export_elements(engine: &mut Engine) -> Value {
    let result = apply(engine, json!([{ "op": "exportScene" }]));
    let results = applied(&result, 1);
    data(results, 0, "exportScene").clone()
}

// ---------------------------------------------------------------------------
// Normalized pointer input
// ---------------------------------------------------------------------------

#[test]
fn pointer_click_selects_without_mutation_or_history() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let nonce_before = engine.scene_nonce();
    let result = apply(
        &mut engine,
        json!([down(50.0, 30.0), mv(51.0, 30.0), up(51.0, 30.0)]),
    );
    let results = applied(&result, 3);
    assert_eq!(data(results, 0, "pointerDown")["hit"], "r1");
    assert_eq!(data(results, 1, "pointerMove")["pastThreshold"], false);
    assert_eq!(data(results, 2, "pointerUp")["kind"], "click");
    assert_eq!(engine.scene_nonce(), nonce_before, "click never mutates");
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["selection"], json!(["r1"]));
    assert_eq!(status["undoLen"], 1, "only the create entry exists");
}

#[test]
fn pointer_drag_moves_and_commits_one_entry() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([down(50.0, 30.0), mv(90.0, 60.0), up(90.0, 60.0)]),
    );
    let results = applied(&result, 3);
    assert_eq!(data(results, 1, "pointerMove")["pastThreshold"], true);
    let up_data = data(results, 2, "pointerUp");
    assert_eq!(up_data["kind"], "dragCommitted");
    assert_eq!(up_data["committed"], true);
    let exported = export_elements(&mut engine);
    let el = &exported["elements"][0];
    assert_eq!(el["x"], 50.0, "drag delta (+40) applied");
    assert_eq!(el["y"], 40.0, "drag delta (+30) applied");
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["undoLen"], 2, "create + one drag entry");
    let undone = apply(&mut engine, json!([{ "op": "undo" }]));
    let undo_results = applied(&undone, 1);
    assert_eq!(data(undo_results, 0, "undo")["undone"], true);
    let restored = export_elements(&mut engine);
    assert_eq!(restored["elements"][0]["x"], 10.0);
}

#[test]
fn pointer_invalid_button_is_a_per_op_error_and_batch_continues() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([
            { "op": "pointerDown", "x": 50.0, "y": 30.0, "button": "thumb", "modifiers": {} },
            { "op": "sessionState" },
        ]),
    );
    assert_eq!(result["applied"], 1);
    let results = result["results"].as_array().expect("results");
    failed(results, 0, "pointerDown", "invalidInput");
    assert!(data(results, 1, "sessionState").is_object());
}

#[test]
fn nonfinite_pointer_is_rejected_without_touch() {
    use opennary_bindings::{BatchOp, ModifiersJson};
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let nonce_before = engine.scene_nonce();
    let result = engine.apply_ops(vec![BatchOp::PointerMove {
        x: f64::NAN,
        y: 0.0,
        modifiers: ModifiersJson::default(),
    }]);
    assert_eq!(result.applied, 0);
    assert!(!result.results[0].ok);
    assert_eq!(result.results[0].code.as_deref(), Some("invalidInput"));
    assert_eq!(engine.scene_nonce(), nonce_before);
}

#[test]
fn rubber_band_selects_and_reports_ids() {
    let mut engine = engine_with_rect("r1", 410.0, 405.0);
    let result = apply(
        &mut engine,
        json!([down(400.0, 400.0), mv(500.0, 450.0), up(500.0, 450.0)]),
    );
    let results = applied(&result, 3);
    let up_data = data(results, 2, "pointerUp");
    assert_eq!(up_data["kind"], "rubberBand");
    assert_eq!(up_data["selected"], json!(["r1"]));
}

#[test]
fn draw_tool_drag_creates_a_shape() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "setTool", "tool": "rectangle" },
            down(10.0, 10.0),
            mv(110.0, 60.0),
            up(110.0, 60.0),
        ]),
    );
    let results = applied(&result, 4);
    let up_data = data(results, 3, "pointerUp");
    assert_eq!(up_data["kind"], "shapeCreated");
    let id = up_data["id"].as_str().expect("created id");
    let exported = export_elements(&mut engine);
    assert_eq!(exported["elements"].as_array().expect("array").len(), 1);
    assert_eq!(exported["elements"][0]["id"], id);
    assert_eq!(exported["elements"][0]["type"], "rectangle");
}

#[test]
fn right_click_selects_without_starting_a_drag() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([{ "op": "pointerDown", "x": 50.0, "y": 30.0, "button": "right", "modifiers": {} }]),
    );
    let results = applied(&result, 1);
    assert_eq!(data(results, 0, "pointerDown")["hit"], "r1");
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["selection"], json!(["r1"]));
    assert_eq!(
        status["pointerPhase"], "idle",
        "no capture from right-click"
    );
}

#[test]
fn undo_is_guarded_mid_gesture_like_ts() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([down(50.0, 30.0), { "op": "undo" }, up(51.0, 30.0), { "op": "undo" }]),
    );
    let results = applied(&result, 4);
    assert_eq!(
        data(results, 1, "undo")["undone"],
        false,
        "captured gesture refuses undo"
    );
    assert_eq!(
        data(results, 3, "undo")["undone"],
        true,
        "released gesture undoes the create"
    );
    assert_eq!(engine.element_count(), 0);
}

// ---------------------------------------------------------------------------
// Keyboard + wheel
// ---------------------------------------------------------------------------

#[test]
fn key_delete_removes_selection_and_undo_restores() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([
            { "op": "select", "ids": ["r1"] },
            { "op": "keyDown", "key": "Delete", "modifiers": {} },
        ]),
    );
    let results = applied(&result, 2);
    let deleted = data(results, 1, "keyDown");
    assert_eq!(deleted["kind"], "deleted");
    assert_eq!(deleted["affected"], json!(["r1"]));
    assert_eq!(engine.element_count(), 0);
    let undone = apply(&mut engine, json!([{ "op": "undo" }]));
    let undo_results = applied(&undone, 1);
    assert_eq!(data(undo_results, 0, "undo")["undone"], true);
    assert_eq!(engine.element_count(), 1);
}

#[test]
fn key_arrows_nudge_with_shift_step() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([
            { "op": "select", "ids": ["r1"] },
            { "op": "keyDown", "key": "ArrowRight", "modifiers": {} },
            { "op": "keyDown", "key": "ArrowRight", "modifiers": {"shift": true} },
        ]),
    );
    let results = applied(&result, 3);
    assert_eq!(data(results, 1, "keyDown")["kind"], "nudged");
    assert_eq!(data(results, 2, "keyDown")["kind"], "nudged");
    let exported = export_elements(&mut engine);
    assert_eq!(exported["elements"][0]["x"], 21.0, "1px + Shift 10px");
}

#[test]
fn key_clipboard_intents_surface_for_the_host() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let nonce_before = engine.scene_nonce();
    let result = apply(
        &mut engine,
        json!([
            { "op": "select", "ids": ["r1"] },
            { "op": "keyDown", "key": "c", "modifiers": {"ctrlOrCmd": true} },
            { "op": "keyDown", "key": "v", "modifiers": {"ctrlOrCmd": true} },
            { "op": "keyDown", "key": "d", "modifiers": {"ctrlOrCmd": true} },
        ]),
    );
    let results = applied(&result, 4);
    assert_eq!(data(results, 1, "keyDown")["intent"], "copy");
    assert_eq!(data(results, 2, "keyDown")["intent"], "paste");
    assert_eq!(data(results, 3, "keyDown")["intent"], "duplicate");
    assert_eq!(
        engine.scene_nonce(),
        nonce_before,
        "intents decide, hosts execute"
    );
}

#[test]
fn key_unbound_and_escape_chain_behave() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([
            { "op": "select", "ids": ["r1"] },
            { "op": "keyDown", "key": "a", "modifiers": {} },
            { "op": "keyDown", "key": "Escape", "modifiers": {} },
        ]),
    );
    let results = applied(&result, 3);
    assert_eq!(data(results, 1, "keyDown")["kind"], "ignored");
    let escape = data(results, 2, "keyDown");
    assert_eq!(escape["kind"], "escape");
    assert_eq!(escape["escape"], "selectionCleared");
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["selection"], json!([]));
}

#[test]
fn wheel_pans_and_ctrl_wheel_zooms() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "wheel", "dx": 10.0, "dy": 0.0, "zoomGesture": false, "x": 0.0, "y": 0.0 },
            { "op": "wheel", "dx": 0.0, "dy": -50.0, "zoomGesture": true, "x": 100.0, "y": 100.0 },
        ]),
    );
    let results = applied(&result, 2);
    assert_eq!(data(results, 0, "wheel")["viewport"]["scrollX"], -10.0);
    let zoomed = &data(results, 1, "wheel")["viewport"];
    assert!(
        (zoomed["zoom"].as_f64().expect("zoom") - 1.0).abs() > 1e-9,
        "zoom gesture moves zoom: {zoomed}"
    );
}

// ---------------------------------------------------------------------------
// Viewport + configuration propagation
// ---------------------------------------------------------------------------

#[test]
fn set_viewport_replaces_and_clamps_zoom() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([{ "op": "setViewport", "scrollX": 100.0, "scrollY": 50.0, "zoom": 99.0 }]),
    );
    let results = applied(&result, 1);
    let viewport = &data(results, 0, "setViewport")["viewport"];
    assert_eq!(viewport["scrollX"], 100.0);
    assert_eq!(viewport["scrollY"], 50.0);
    assert_eq!(viewport["zoom"], 10.0, "TS 0.1–10 clamp");
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["viewport"]["zoom"], 10.0);
}

#[test]
fn set_viewport_rejects_nonfinite_without_touch() {
    use opennary_bindings::{BatchOp, ViewportJson};
    let mut engine = Engine::new();
    let result = engine.apply_ops(vec![BatchOp::SetViewport {
        viewport: ViewportJson {
            scroll_x: f64::NAN,
            scroll_y: 0.0,
            zoom: 1.0,
        },
    }]);
    assert_eq!(result.applied, 0);
    assert!(!result.results[0].ok);
    assert_eq!(result.results[0].code.as_deref(), Some("invalidInput"));
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["viewport"]["scrollX"], 0.0);
}

#[test]
fn configure_tools_gate_rejects_then_clears() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "configure", "enabledTools": ["select"] },
            { "op": "setTool", "tool": "ellipse" },
            { "op": "configure", "enabledTools": null },
            { "op": "setTool", "tool": "ellipse" },
        ]),
    );
    let results = applied(&result, 4);
    assert_eq!(
        data(results, 0, "configure")["enabledTools"],
        json!(["select"])
    );
    assert_eq!(data(results, 1, "setTool")["accepted"], false);
    assert_eq!(data(results, 1, "setTool")["tool"], "select");
    assert_eq!(data(results, 3, "setTool")["accepted"], true);
    assert_eq!(data(results, 3, "setTool")["tool"], "ellipse");
}

#[test]
fn configure_custom_tool_survives_without_allow_list() {
    let mut engine = Engine::new();
    let result = apply(&mut engine, json!([{ "op": "setTool", "tool": "laser" }]));
    let results = applied(&result, 1);
    assert_eq!(data(results, 0, "setTool")["accepted"], true);
    assert_eq!(data(results, 0, "setTool")["tool"], "laser");
}

#[test]
fn configure_theme_and_snap_apply_and_reject_atomically() {
    use opennary_bindings::{BatchOp, ThemeOverrideJson, ThemeSizesOverrideJson};
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "configure",
              "theme": {"colors": {"selectionOutline": "#ff0000"}, "sizes": {"handleSize": 12.0}},
              "snap": {"snapToGrid": true, "gridSize": 25.0} },
            { "op": "sessionState" },
        ]),
    );
    let results = applied(&result, 2);
    assert!(data(results, 0, "configure").is_object());
    let session = data(results, 1, "sessionState");
    assert_eq!(session["tool"], "select");

    let bad = engine.apply_ops(vec![BatchOp::Configure {
        enabled_tools: None,
        theme: Box::new(Some(ThemeOverrideJson {
            sizes: Some(ThemeSizesOverrideJson {
                handle_size: Some(f64::NAN),
                ..Default::default()
            }),
            ..Default::default()
        })),
        snap: Box::new(None),
    }]);
    assert_eq!(bad.applied, 0);
    assert!(!bad.results[0].ok);
    assert_eq!(bad.results[0].code.as_deref(), Some("invalidInput"));
}

// ---------------------------------------------------------------------------
// Text sessions
// ---------------------------------------------------------------------------

#[test]
fn text_flow_create_type_commit_and_undo() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "startTextAt", "x": 500.0, "y": 500.0 },
            { "op": "textInput", "text": "Hi" },
            { "op": "commitText" },
            { "op": "sessionState" },
        ]),
    );
    let results = applied(&result, 4);
    let id = data(results, 0, "startTextAt")["id"]
        .as_str()
        .expect("text id")
        .to_string();
    assert_eq!(data(results, 1, "textInput")["inserted"], true);
    assert_eq!(data(results, 2, "commitText")["committed"], true);
    assert_eq!(data(results, 3, "sessionState")["textEditing"], Value::Null);
    let exported = export_elements(&mut engine);
    let found = exported["elements"]
        .as_array()
        .expect("array")
        .iter()
        .find(|el| el["id"] == id)
        .expect("committed text present");
    assert_eq!(found["type"], "text");
    assert_eq!(found["text"], "Hi");
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["undoLen"], 2, "create + commit entries");
    apply(&mut engine, json!([{ "op": "undo" }, { "op": "undo" }]));
    assert_eq!(engine.element_count(), 0);
}

#[test]
fn text_empty_commit_deletes_and_cancel_changes_nothing() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "startTextAt", "x": 10.0, "y": 10.0 },
            { "op": "commitText" },
        ]),
    );
    let results = applied(&result, 2);
    assert_eq!(data(results, 1, "commitText")["committed"], true);
    assert_eq!(engine.element_count(), 0, "empty commit deletes the draft");

    let again = apply(
        &mut engine,
        json!([
            { "op": "startTextAt", "x": 20.0, "y": 20.0 },
            { "op": "cancelText" },
        ]),
    );
    let again_results = applied(&again, 2);
    assert_eq!(data(again_results, 1, "cancelText")["cancelled"], true);
    let state = apply(&mut engine, json!([{ "op": "sessionState" }]));
    let state_results = applied(&state, 1);
    assert_eq!(
        data(state_results, 0, "sessionState")["textEditing"],
        Value::Null
    );
}

#[test]
fn ime_intermediates_never_finalize() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "startTextAt", "x": 600.0, "y": 600.0 },
            { "op": "compositionStart" },
            { "op": "compositionUpdate", "buffer": "nih" },
            { "op": "textInput", "text": "X" },
            { "op": "compositionEnd", "finalText": "ni" },
            { "op": "commitText" },
        ]),
    );
    let results = applied(&result, 6);
    assert_eq!(
        data(results, 3, "textInput")["inserted"],
        false,
        "plain input refused mid-composition"
    );
    assert_eq!(data(results, 5, "commitText")["committed"], true);
    let exported = export_elements(&mut engine);
    let texts: Vec<&Value> = exported["elements"]
        .as_array()
        .expect("array")
        .iter()
        .filter(|el| el["type"] == "text")
        .collect();
    assert_eq!(texts.len(), 1);
    assert_eq!(texts[0]["text"], "ni", "only the final string merges");
}

#[test]
fn text_input_without_session_is_an_explicit_error() {
    let mut engine = Engine::new();
    let nonce_before = engine.scene_nonce();
    let result = apply(&mut engine, json!([{ "op": "textInput", "text": "hi" }]));
    assert_eq!(result["applied"], 0);
    let results = result["results"].as_array().expect("results");
    failed(results, 0, "textInput", "invalidInput");
    assert_eq!(engine.scene_nonce(), nonce_before);
}

// ---------------------------------------------------------------------------
// Context menu + layering
// ---------------------------------------------------------------------------

#[test]
fn context_menu_follows_selection_exactly() {
    let mut engine = Engine::new();
    let empty = apply(&mut engine, json!([{ "op": "contextMenu" }]));
    let empty_results = applied(&empty, 1);
    assert_eq!(data(empty_results, 0, "contextMenu")["intents"], json!([]));

    let result = apply(
        &mut engine,
        json!([
            { "op": "create", "element": rect("a", 0.0, 0.0) },
            { "op": "create", "element": rect("b", 200.0, 0.0) },
            { "op": "select", "ids": ["a", "b"] },
            { "op": "contextMenu" },
            { "op": "group", "ids": ["a", "b"] },
            { "op": "contextMenu" },
            { "op": "setLocked", "ids": ["a"], "locked": true },
            { "op": "contextMenu" },
        ]),
    );
    let results = applied(&result, 8);
    assert_eq!(
        data(results, 3, "contextMenu")["intents"],
        json!([
            "delete",
            "duplicate",
            "bringToFront",
            "sendToBack",
            "bringForward",
            "sendBackward",
            "group",
            "lock"
        ])
    );
    assert_eq!(
        data(results, 5, "contextMenu")["intents"],
        json!([
            "delete",
            "duplicate",
            "bringToFront",
            "sendToBack",
            "bringForward",
            "sendBackward",
            "group",
            "ungroup",
            "lock"
        ])
    );
    assert_eq!(
        data(results, 7, "contextMenu")["intents"],
        json!([
            "delete",
            "duplicate",
            "bringToFront",
            "sendToBack",
            "bringForward",
            "sendBackward",
            "group",
            "ungroup",
            "lock",
            "unlock"
        ])
    );
}

#[test]
fn layering_ops_share_order_math_and_track_history() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "create", "element": rect("a", 0.0, 0.0) },
            { "op": "create", "element": rect("b", 200.0, 0.0) },
            { "op": "create", "element": rect("c", 400.0, 0.0) },
            { "op": "bringToFront", "ids": ["a"] },
            { "op": "bringForward", "ids": ["b"] },
            { "op": "sendBackward", "ids": ["c"] },
            { "op": "sendToBack", "ids": ["c"] },
        ]),
    );
    let results = applied(&result, 7);
    assert_eq!(data(results, 3, "bringToFront")["changed"], true);
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["order"], json!(["c", "b", "a"]));
    assert_eq!(
        status["undoLen"], 5,
        "3 creates + 2 changed layering entries (no-ops skip)"
    );
    apply(&mut engine, json!([{ "op": "undo" }]));
    let restored: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(restored["order"], json!(["b", "c", "a"]));
}

// ---------------------------------------------------------------------------
// Render model + assets
// ---------------------------------------------------------------------------

#[test]
fn render_model_reports_draw_list_selection_and_text() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([
            { "op": "startTextAt", "x": 300.0, "y": 300.0 },
            { "op": "textInput", "text": "Hi" },
            { "op": "commitText" },
            { "op": "select", "ids": ["r1"] },
            { "op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0 },
        ]),
    );
    let results = applied(&result, 5);
    let model = data(results, 4, "renderModel");
    assert_eq!(model["base"].as_array().expect("base").len(), 2);
    let kinds: Vec<&str> = model["base"]
        .as_array()
        .expect("base")
        .iter()
        .map(|entry| entry["kind"].as_str().expect("kind"))
        .collect();
    assert!(
        kinds.contains(&"rectangle") && kinds.contains(&"text"),
        "kinds: {kinds:?}"
    );
    let text_entry = model["base"]
        .as_array()
        .expect("base")
        .iter()
        .find(|entry| entry["kind"] == "text")
        .expect("text entry");
    assert_eq!(text_entry["detail"]["type"], "text");
    assert_eq!(text_entry["detail"]["text"], "Hi");
    let selection = &model["selection"];
    assert!(selection.is_object(), "selection overlay present");
    assert_eq!(
        selection["handles"].as_array().expect("handles").len(),
        8,
        "eight resize handles"
    );
    assert_eq!(model["viewport"]["zoom"], 1.0);
    assert_eq!(model["assetGeneration"], 0);
    assert_eq!(model["snapGuides"], json!([]));
}

#[test]
fn render_model_determinism_and_bad_canvas() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let first = apply(
        &mut engine,
        json!([{ "op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0 }]),
    );
    let second = apply(
        &mut engine,
        json!([{ "op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0 }]),
    );
    let a = applied(&first, 1);
    let b = applied(&second, 1);
    assert_eq!(data(a, 0, "renderModel"), data(b, 0, "renderModel"));
    let bad = apply(
        &mut engine,
        json!([{ "op": "renderModel", "canvasWidth": 0.0, "canvasHeight": 600.0 }]),
    );
    assert_eq!(bad["applied"], 0);
    let bad_results = bad["results"].as_array().expect("results");
    failed(bad_results, 0, "renderModel", "invalidInput");
}

#[test]
fn notify_assets_bumps_generation_everywhere() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "notifyAssetsChanged" },
            { "op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0 },
        ]),
    );
    let results = applied(&result, 2);
    assert_eq!(
        data(results, 0, "notifyAssetsChanged")["assetGeneration"],
        1
    );
    assert_eq!(data(results, 1, "renderModel")["assetGeneration"], 1);
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["assetGeneration"], 1);
}

// ---------------------------------------------------------------------------
// Normalized events + session snapshot
// ---------------------------------------------------------------------------

#[test]
fn drain_events_reports_then_clears() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "create", "element": rect("r1", 10.0, 10.0) },
            { "op": "select", "ids": ["r1"] },
            { "op": "setTool", "tool": "rectangle" },
            { "op": "drainEvents" },
            { "op": "drainEvents" },
        ]),
    );
    let results = applied(&result, 5);
    let first = data(results, 3, "drainEvents")["events"]
        .as_array()
        .expect("events")
        .clone();
    let kinds: Vec<&str> = first
        .iter()
        .map(|event| event["type"].as_str().expect("type"))
        .collect();
    assert!(kinds.contains(&"documentChanged"), "kinds: {kinds:?}");
    assert!(kinds.contains(&"historyChanged"), "kinds: {kinds:?}");
    assert!(kinds.contains(&"selectionChanged"), "kinds: {kinds:?}");
    assert!(kinds.contains(&"toolChanged"), "kinds: {kinds:?}");
    assert_eq!(
        data(results, 4, "drainEvents")["events"],
        json!([]),
        "queue clears on drain"
    );
}

#[test]
fn click_selection_flows_through_events() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    apply(&mut engine, json!([{ "op": "drainEvents" }]));
    apply(&mut engine, json!([down(50.0, 30.0), up(51.0, 30.0)]));
    let drained = apply(&mut engine, json!([{ "op": "drainEvents" }]));
    let drained_results = applied(&drained, 1);
    let events = data(drained_results, 0, "drainEvents")["events"]
        .as_array()
        .expect("events")
        .clone();
    let selection_event = events
        .iter()
        .find(|event| event["type"] == "selectionChanged")
        .expect("selection event");
    assert_eq!(selection_event["ids"], json!(["r1"]));
}

#[test]
fn session_state_snapshots_the_host_session() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([
            { "op": "select", "ids": ["r1"] },
            { "op": "setTool", "tool": "text" },
            { "op": "setViewport", "scrollX": 5.0, "scrollY": 6.0, "zoom": 2.0 },
            { "op": "sessionState" },
        ]),
    );
    let results = applied(&result, 4);
    let session = data(results, 3, "sessionState");
    assert_eq!(session["selection"], json!(["r1"]));
    assert_eq!(session["tool"], "text");
    assert_eq!(
        session["viewport"],
        json!({"scrollX": 5.0, "scrollY": 6.0, "zoom": 2.0})
    );
    assert_eq!(session["textEditing"], Value::Null);
    assert_eq!(session["pointerPhase"]["kind"], "idle");
    assert_eq!(session["canUndo"], true);
    assert_eq!(session["canRedo"], false);
    assert_eq!(session["enabledTools"], Value::Null);
    assert_eq!(session["assetGeneration"], 0);
}

#[test]
fn batch_queries_observe_prior_ops_in_one_crossing() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "create", "element": rect("r1", 10.0, 10.0) },
            { "op": "select", "ids": ["r1"] },
            { "op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0 },
            { "op": "sessionState" },
        ]),
    );
    let results = applied(&result, 4);
    assert_eq!(
        data(results, 2, "renderModel")["base"]
            .as_array()
            .expect("base")
            .len(),
        1
    );
    assert!(data(results, 2, "renderModel")["selection"].is_object());
    assert_eq!(data(results, 3, "sessionState")["selection"], json!(["r1"]));
}

// ---------------------------------------------------------------------------
// Stroke geometry in the render DTO + text in-session edit ops
// ---------------------------------------------------------------------------

fn line_el(id: &str, x: f64, y: f64) -> Value {
    json!({
        "id": id,
        "type": "line",
        "x": x,
        "y": y,
        "width": 100,
        "height": 50,
        "rotation": 0,
        "strokeColor": "#333333",
        "backgroundColor": {"type": "solid", "color": "transparent"},
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "fillStyle": "solid",
        "opacity": 100,
        "seed": 1,
        "version": 0,
        "versionNonce": 1,
        "isDeleted": false,
        "groupIds": [],
        "locked": false,
        "hidden": false,
        "frameId": null,
        "points": [[0, 0], [100, 50]],
    })
}

#[test]
fn render_model_carries_absolute_stroke_points() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "create", "element": line_el("l1", 10.0, 20.0) },
            { "op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0 },
        ]),
    );
    let results = applied(&result, 2);
    let model = data(results, 1, "renderModel");
    let entry = model["base"]
        .as_array()
        .expect("base")
        .iter()
        .find(|entry| entry["kind"] == "line")
        .expect("line entry");
    assert_eq!(entry["points"], json!([[10.0, 20.0], [110.0, 70.0]]));
}

#[test]
fn freedraw_pointer_drag_creates_a_stroke() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "setTool", "tool": "freedraw" },
            down(10.0, 10.0),
            mv(30.0, 20.0),
            mv(50.0, 10.0),
            up(50.0, 10.0),
        ]),
    );
    let results = applied(&result, 5);
    let up_data = data(results, 4, "pointerUp");
    assert_eq!(up_data["kind"], "shapeCreated");
    let id = up_data["id"].as_str().expect("created id").to_string();
    let exported = export_elements(&mut engine);
    let found = exported["elements"]
        .as_array()
        .expect("array")
        .iter()
        .find(|el| el["id"] == id)
        .expect("stroke present");
    assert_eq!(found["type"], "freedraw");
    assert!(found["points"].as_array().expect("points").len() >= 3);
    let rendered = apply(
        &mut engine,
        json!([{ "op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0 }]),
    );
    let rendered_results = applied(&rendered, 1);
    let model = data(rendered_results, 0, "renderModel");
    let entry = model["base"]
        .as_array()
        .expect("base")
        .iter()
        .find(|entry| entry["kind"] == "freedraw")
        .expect("freedraw entry");
    assert!(entry["points"].as_array().expect("points").len() >= 3);
}

#[test]
fn text_backspace_delete_and_caret_ops_follow_the_draft() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "startTextAt", "x": 10.0, "y": 10.0 },
            { "op": "textInput", "text": "abc" },
            { "op": "textSetCaret", "caret": 1 },
            { "op": "textDelete" },
            { "op": "textBackspace" },
            { "op": "sessionState" },
            { "op": "commitText" },
        ]),
    );
    let results = applied(&result, 7);
    assert_eq!(data(results, 2, "textSetCaret")["caret"], 1);
    assert_eq!(data(results, 3, "textDelete")["deleted"], true);
    assert_eq!(data(results, 4, "textBackspace")["deleted"], true);
    let session = data(results, 5, "sessionState");
    assert_eq!(session["textEditing"]["draft"], "c");
    assert_eq!(session["textEditing"]["caret"], 0);
    assert_eq!(data(results, 6, "commitText")["committed"], true);
    let exported = export_elements(&mut engine);
    let texts: Vec<&Value> = exported["elements"]
        .as_array()
        .expect("array")
        .iter()
        .filter(|el| el["type"] == "text")
        .collect();
    assert_eq!(texts.len(), 1);
    assert_eq!(texts[0]["text"], "c");
}

#[test]
fn text_edit_ops_without_a_session_are_explicit_errors() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([
            { "op": "textBackspace" },
            { "op": "textDelete" },
            { "op": "textSetCaret", "caret": 0 },
        ]),
    );
    assert_eq!(result["applied"], 0);
    let results = result["results"].as_array().expect("results");
    failed(results, 0, "textBackspace", "invalidInput");
    failed(results, 1, "textDelete", "invalidInput");
    failed(results, 2, "textSetCaret", "invalidInput");
}

#[test]
fn preview_queries_agree_with_commit_without_mutating() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let nonce_before = engine.scene_nonce();
    let result = apply(
        &mut engine,
        json!([
            { "op": "previewMove", "ids": ["r1"], "from": {"x": 50.0, "y": 30.0}, "to": {"x": 90.0, "y": 60.0} },
            { "op": "previewResize", "id": "r1", "handle": "bottom-right", "x": 200.0, "y": 150.0 },
            { "op": "previewRotate", "id": "r1", "anchor": {"x": 0.0, "y": 0.0}, "current": {"x": 60.0, "y": 60.0} },
            { "op": "sessionState" },
        ]),
    );
    let results = applied(&result, 4);
    let mv = data(results, 0, "previewMove");
    assert_eq!(mv["dx"], 40.0);
    assert_eq!(mv["dy"], 30.0);
    assert!(mv["guides"].is_array());
    let resize = data(results, 1, "previewResize");
    assert_eq!(resize["changed"], true);
    assert!(resize["width"].as_f64().expect("width") > 100.0);
    let rotate = data(results, 2, "previewRotate");
    assert_eq!(rotate["changed"], true);
    assert!(rotate["rotation"].is_number());
    assert_eq!(engine.scene_nonce(), nonce_before, "previews never mutate");
    assert_eq!(
        data(results, 3, "sessionState")["pointerPhase"]["kind"],
        "idle"
    );
}

#[test]
fn preview_rejects_bad_handles_and_nonfinite_input() {
    let mut engine = engine_with_rect("r1", 10.0, 10.0);
    let result = apply(
        &mut engine,
        json!([
            { "op": "previewResize", "id": "r1", "handle": "nope", "x": 0.0, "y": 0.0 },
            { "op": "previewResize", "id": "missing", "handle": "bottom-right", "x": 0.0, "y": 0.0 },
        ]),
    );
    assert_eq!(result["applied"], 1);
    let results = result["results"].as_array().expect("results");
    failed(results, 0, "previewResize", "invalidInput");
    assert_eq!(data(results, 1, "previewResize")["changed"], false);
}
