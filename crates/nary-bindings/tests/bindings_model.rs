//! Boundary tests for `nary-bindings`.
//!
//! Every test crosses the boundary the way a JS host would: JSON strings
//! in, JSON strings out. Assertions pin the wire contract (protocol
//! version, envelope shapes, per-op codes, whitelisted status keys) plus
//! the engine semantics behind it.

use nary_bindings::{Engine, PROTOCOL_VERSION};
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
        "roundness": null
    })
}

fn scene_of(elements: &[Value]) -> Value {
    let order: Vec<Value> = elements
        .iter()
        .map(|element| element["id"].clone())
        .collect();
    json!({
        "schemaVersion": 1,
        "elements": elements,
        "elementOrder": order,
    })
}

/// Applies already-built ops and parses the result envelope.
fn apply(engine: &mut Engine, ops: Value) -> Value {
    let out = engine.apply_batch(&ops.to_string());
    serde_json::from_str(&out).expect("batch result must be JSON")
}

fn result_at(result: &Value, index: usize) -> &Value {
    &result["results"][index]
}

fn seed_two(engine: &mut Engine) -> Value {
    apply(
        engine,
        json!([
            {"op": "create", "element": rect("a", 10.0, 20.0)},
            {"op": "create", "element": rect("b", 200.0, 20.0)},
        ]),
    )
}

#[test]
fn version_and_protocol_are_stable() {
    assert_eq!(Engine::version(), "0.1.0");
    assert_eq!(PROTOCOL_VERSION, 1);
}

#[test]
fn status_exposes_only_whitelisted_keys() {
    let engine = Engine::new();
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status is JSON");
    let mut keys: Vec<&str> = status
        .as_object()
        .expect("status is an object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "assetGeneration",
            "bindingsVersion",
            "canRedo",
            "canUndo",
            "cropping",
            "elementCount",
            "order",
            "pathEditing",
            "penActive",
            "pointerPhase",
            "protocolVersion",
            "redoLen",
            "sceneNonce",
            "schemaVersion",
            "selection",
            "textEditing",
            "tool",
            "undoLen",
            "viewport",
        ],
        "status must not leak internals (no elements/history/clipboard dumps)"
    );
    assert_eq!(status["protocolVersion"], 1);
    assert_eq!(status["tool"], "select");
    assert_eq!(status["elementCount"], 0);
    assert_eq!(status["pointerPhase"], "idle");
    assert_eq!(status["textEditing"], Value::Null);
    assert_eq!(status["penActive"], false);
    assert_eq!(status["cropping"], Value::Null);
    assert_eq!(status["pathEditing"], Value::Null);
    assert_eq!(status["assetGeneration"], 0);
    assert_eq!(status["viewport"]["scrollX"], 0.0);
    assert_eq!(status["viewport"]["scrollY"], 0.0);
    assert_eq!(status["viewport"]["zoom"], 1.0);
}

#[test]
fn export_empty_scene_matches_envelope_contract() {
    let engine = Engine::new();
    let exported = engine.export_scene().expect("empty export succeeds");
    let value: Value = serde_json::from_str(&exported).expect("export is JSON");
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["version"], 1);
    assert_eq!(value["elements"], json!([]));
    assert_eq!(value["elementOrder"], json!([]));
}

#[test]
fn create_and_undo_round_trip() {
    let mut engine = Engine::new();
    let result = apply(
        &mut engine,
        json!([{"op": "create", "element": rect("a", 1.0, 2.0)}]),
    );
    assert_eq!(result["version"], 1);
    assert_eq!(result["applied"], 1);
    assert_eq!(result_at(&result, 0)["ok"], true);
    assert_eq!(result_at(&result, 0)["data"]["ids"], json!(["a"]));
    assert_eq!(engine.element_count(), 1);

    let undone = apply(&mut engine, json!([{"op": "undo"}]));
    assert_eq!(undone["results"][0]["data"], json!({"undone": true}));
    assert_eq!(engine.element_count(), 0);

    let redone = apply(&mut engine, json!([{"op": "redo"}]));
    assert_eq!(redone["results"][0]["data"], json!({"redone": true}));
    assert_eq!(engine.element_count(), 1);
}

#[test]
fn create_rejects_unknown_types_without_touch() {
    let mut engine = Engine::new();
    let nonce_before = engine.scene_nonce();
    let mut bad = rect("x", 0.0, 0.0);
    bad["type"] = json!("starship");
    let result = apply(&mut engine, json!([{"op": "create", "element": bad}]));
    assert_eq!(result["applied"], 0);
    assert_eq!(result_at(&result, 0)["ok"], false);
    assert_eq!(result_at(&result, 0)["code"], "invalidInput");
    assert_eq!(engine.element_count(), 0);
    assert_eq!(engine.scene_nonce(), nonce_before);
}

#[test]
fn create_rejects_id_collisions_explicitly() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(
        &mut engine,
        json!([{"op": "create", "element": rect("a", 9.0, 9.0)}]),
    );
    assert_eq!(result_at(&result, 0)["ok"], false);
    assert_eq!(result_at(&result, 0)["code"], "invariantViolation");
}

#[test]
fn one_batch_applies_many_ops_in_a_single_crossing() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(
        &mut engine,
        json!([
            {"op": "move", "ids": ["a", "b"], "dx": 5.0, "dy": -5.0},
            {"op": "setBounds", "id": "a", "x": 0.0, "y": 0.0, "width": 40.0, "height": 30.0},
            {"op": "setRotation", "id": "b", "rotation": 0.5},
            {"op": "setStyle", "ids": ["a"], "patch": {"strokeColor": "#ff0000", "opacity": 80.0}},
            {"op": "setLocked", "ids": ["b"], "locked": true},
            {"op": "reorder", "order": ["b", "a"]},
        ]),
    );
    assert_eq!(result["applied"], 6, "failing op: {result}");
    assert_eq!(engine.document().get("a").expect("a exists").base().x, 0.0);
    assert!(engine.document().get("b").expect("b exists").base().locked);
    let order: Vec<String> = engine
        .document()
        .order()
        .iter()
        .map(|id| id.as_str().to_string())
        .collect();
    assert_eq!(order, ["b", "a"]);
}

#[test]
fn batch_skips_unknown_ids_per_ts_parity() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(
        &mut engine,
        json!([
            {"op": "move", "ids": ["a"], "dx": 1.0, "dy": 1.0},
            {"op": "setBounds", "id": "ghost", "x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0},
            {"op": "setStyle", "ids": ["b"], "patch": {"strokeWidth": 5.0}},
        ]),
    );
    // Unknown ids are skips (ok with empty affected), so all
    // three report ok here; the shape under test is ordering + counts.
    assert_eq!(result["applied"], 3);
    assert_eq!(result["results"].as_array().expect("array").len(), 3);
}

#[test]
fn batch_records_hard_failures_per_op_and_keeps_going() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(
        &mut engine,
        json!([
            {"op": "move", "ids": ["a"], "dx": 1.0, "dy": 1.0},
            {"op": "setStyle", "ids": ["a"], "patch": {"strokeStyle": "wavy"}},
            {"op": "move", "ids": ["b"], "dx": 2.0, "dy": 2.0},
        ]),
    );
    assert_eq!(result["applied"], 2);
    assert_eq!(result_at(&result, 1)["ok"], false);
    assert_eq!(result_at(&result, 1)["code"], "invalidInput");
    // The ops around the failure still applied.
    assert_eq!(engine.document().get("a").expect("a").base().x, 11.0);
    assert_eq!(engine.document().get("b").expect("b").base().x, 202.0);
}

#[test]
fn gradient_background_object_sets_a_gradient_fill() {
    use nary_core::element::FillStyle;

    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(
        &mut engine,
        json!([{"op": "setStyle", "ids": ["a"],
                "patch": {"background": {"type": "gradient", "gradientType": "linear",
                    "angle": 45.0, "stops": [{"offset": 0.0, "color": "#000000"},
                        {"offset": 1.0, "color": "#ffffff"}]}}}]),
    );
    assert_eq!(result_at(&result, 0)["ok"], true);
    assert!(matches!(
        &engine
            .document()
            .get("a")
            .expect("a")
            .base()
            .background_color,
        FillStyle::Gradient { .. }
    ));
    // Undoable like any style change.
    let undo = apply(&mut engine, json!([{"op": "undo"}]));
    assert_eq!(result_at(&undo, 0)["ok"], true);
    assert!(matches!(
        &engine
            .document()
            .get("a")
            .expect("a")
            .base()
            .background_color,
        FillStyle::Solid { .. }
    ));
}

#[test]
fn mistyped_background_is_invalid_input() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(
        &mut engine,
        json!([{"op": "setStyle", "ids": ["a"], "patch": {"background": 42}}]),
    );
    assert_eq!(result_at(&result, 0)["ok"], false);
    assert_eq!(result_at(&result, 0)["code"], "invalidInput");
}

#[test]
fn solid_string_background_sets_a_solid_fill() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(
        &mut engine,
        json!([{"op": "setStyle", "ids": ["a"], "patch": {"background": "#ff0000"}}]),
    );
    assert_eq!(result_at(&result, 0)["ok"], true);
}

#[test]
fn unparseable_batch_is_a_top_level_envelope() {
    let mut engine = Engine::new();
    let out = engine.apply_batch("not json [");
    let value: Value = serde_json::from_str(&out).expect("envelope is JSON");
    assert_eq!(value["ok"], false);
    assert_eq!(value["code"], "parseError");
    assert_eq!(value["version"], 1);
}

#[test]
fn unknown_op_is_a_top_level_parse_error() {
    let mut engine = Engine::new();
    let out = engine.apply_batch(r#"[{"op": "teleport", "ids": ["a"]}]"#);
    let value: Value = serde_json::from_str(&out).expect("envelope is JSON");
    assert_eq!(value["ok"], false);
    assert_eq!(value["code"], "parseError");
    assert_eq!(engine.element_count(), 0, "failed batch stores nothing");
}

#[test]
fn group_and_ungroup_round_trip() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let grouped = apply(&mut engine, json!([{"op": "group", "ids": ["a", "b"]}]));
    assert_eq!(grouped["results"][0]["ok"], true);
    let group_id = grouped["results"][0]["data"]["groupId"]
        .as_str()
        .expect("group id")
        .to_string();
    assert!(!group_id.is_empty());

    let ungrouped = apply(&mut engine, json!([{"op": "ungroup", "groupId": group_id}]));
    assert_eq!(ungrouped["results"][0]["ok"], true);
}

#[test]
fn copy_paste_mints_fresh_ids_with_cascade() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let copied = apply(&mut engine, json!([{"op": "copy", "ids": ["a"]}]));
    assert_eq!(copied["results"][0]["data"]["buffered"], 1);

    let first = apply(&mut engine, json!([{"op": "paste"}]));
    let second = apply(&mut engine, json!([{"op": "paste"}]));
    let first_id = first["results"][0]["data"]["ids"][0]
        .as_str()
        .expect("id")
        .to_string();
    let second_id = second["results"][0]["data"]["ids"][0]
        .as_str()
        .expect("id")
        .to_string();
    assert_ne!(first_id, second_id);
    assert_ne!(first_id, "a");
    let first_el = engine.document().get(&first_id).expect("pasted");
    let second_el = engine.document().get(&second_id).expect("pasted twice");
    assert_eq!(first_el.base().x, 20.0, "first paste cascades +10");
    assert_eq!(second_el.base().x, 30.0, "second paste cascades +20");
}

#[test]
fn cut_then_undo_restores() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let cut = apply(&mut engine, json!([{"op": "cut", "ids": ["a"]}]));
    assert_eq!(cut["results"][0]["data"]["buffered"], 1);
    assert_eq!(engine.element_count(), 1);
    apply(&mut engine, json!([{"op": "undo"}]));
    assert_eq!(engine.element_count(), 2);
}

#[test]
fn duplicate_offsets_without_touching_the_buffer() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let duplicated = apply(&mut engine, json!([{"op": "duplicate", "ids": ["a"]}]));
    let dup_id = duplicated["results"][0]["data"]["ids"][0]
        .as_str()
        .expect("id")
        .to_string();
    assert_ne!(dup_id, "a");
    assert_eq!(engine.element_count(), 3);
    // The copy buffer is still empty, so paste is a no-op success.
    let pasted = apply(&mut engine, json!([{"op": "paste"}]));
    assert_eq!(pasted["results"][0]["data"]["count"], 0);
    assert_eq!(engine.element_count(), 3);
}

#[test]
fn delete_selected_prunes_the_selection_mirror() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    apply(&mut engine, json!([{"op": "select", "ids": ["a", "b"]}]));
    let deleted = apply(&mut engine, json!([{"op": "deleteSelected"}]));
    assert_eq!(deleted["results"][0]["ok"], true);
    assert_eq!(engine.element_count(), 0);
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["selection"], json!([]));
}

#[test]
fn nudge_moves_the_current_selection() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    apply(&mut engine, json!([{"op": "select", "ids": ["a"]}]));
    apply(&mut engine, json!([{"op": "nudge", "dx": 3.0, "dy": 4.0}]));
    let moved = engine.document().get("a").expect("a");
    assert_eq!(moved.base().x, 13.0);
    assert_eq!(moved.base().y, 24.0);
}

#[test]
fn select_and_set_tool_mirror_into_status() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    apply(
        &mut engine,
        json!([
            {"op": "select", "ids": ["b"]},
            {"op": "setTool", "tool": "rectangle"},
        ]),
    );
    let status: Value = serde_json::from_str(&engine.status_json()).expect("status");
    assert_eq!(status["selection"], json!(["b"]));
    assert_eq!(status["tool"], "rectangle");
}

#[test]
fn import_scene_op_replaces_content_with_counts() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let scene = scene_of(&[rect("solo", 5.0, 5.0)]);
    let result = apply(&mut engine, json!([{"op": "importScene", "scene": scene}]));
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(
        result["results"][0]["data"],
        json!({"imported": 1, "skipped": 0})
    );
    assert_eq!(engine.element_count(), 1);
}

#[test]
fn import_scene_op_failure_leaves_the_document_untouched() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let nonce_before = engine.scene_nonce();
    let result = apply(
        &mut engine,
        json!([{"op": "importScene", "scene": {"schemaVersion": 99, "elements": [], "elementOrder": []}}]),
    );
    assert_eq!(result["results"][0]["ok"], false);
    assert_eq!(engine.element_count(), 2);
    assert_eq!(engine.scene_nonce(), nonce_before);
}

#[test]
fn export_scene_op_returns_the_live_scene() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    let result = apply(&mut engine, json!([{"op": "exportScene"}]));
    assert_eq!(result["results"][0]["ok"], true);
    let scene = &result["results"][0]["data"];
    assert_eq!(scene["schemaVersion"], 1);
    assert_eq!(scene["elements"].as_array().expect("array").len(), 2);
}

#[test]
fn rust_export_imports_into_a_fresh_engine() {
    let mut first = Engine::new();
    seed_two(&mut first);
    let exported = first.export_scene().expect("export");
    let mut second = Engine::new();
    let summary = second.import_scene(&exported, false).expect("import");
    assert_eq!((summary.imported, summary.skipped), (2, 0));
    assert_eq!(second.element_count(), 2);
}

#[test]
fn clipboard_codec_round_trips_through_the_host_boundary() {
    let mut engine = Engine::new();
    seed_two(&mut engine);
    apply(&mut engine, json!([{"op": "copy", "ids": ["a", "b"]}]));
    let payload = engine.encode_clipboard().expect("encode");
    let decoded = Engine::decode_clipboard(&payload).expect("decode");
    assert_eq!(decoded["count"], 2);
    assert_eq!(decoded["skipped"], 0);
}

#[test]
fn decode_clipboard_rejects_garbage_explicitly() {
    assert!(Engine::decode_clipboard("definitely not a payload").is_err());
}

#[test]
fn png_plan_needs_content_and_reports_dimensions() {
    let mut engine = Engine::new();
    assert!(engine.plan_png_export("{}").is_err());
    seed_two(&mut engine);
    let plan = engine
        .plan_png_export(r#"{"background": "white", "padding": 20.0, "scale": 2.0}"#)
        .expect("plan");
    // a(10..110) + b(200..300) with 20 padding at scale 2.
    assert_eq!(plan["canvasWidthPx"], 660);
    assert_eq!(plan["canvasHeightPx"], 180);
    assert_eq!(plan["background"], "white");
}

#[test]
fn wasm_glue_constructors_stay_string_only() {
    // Exercises the same code the wasm-bindgen wrapper calls so native
    // tests pin the strings JS will receive. The `#[wasm_bindgen]` glue
    // itself lives in the `nary` distribution crate (it is test-only here
    // so a wasm build never exports `JsEngine` twice).
    let mut engine = Engine::new();
    let out = engine.apply_batch(r#"[{"op": "undo"}]"#);
    let value: Value = serde_json::from_str(&out).expect("batch JSON");
    assert_eq!(value["results"][0]["data"], json!({"undone": false}));
    assert_eq!(nary_bindings::protocol::PROTOCOL_VERSION, 1);
}

#[test]
fn jpeg_and_webp_plans_resolve_through_json_methods() {
    let mut engine = Engine::new();
    seed_two(&mut engine);

    let jpeg = engine.plan_jpeg_export("{}").expect("jpeg plans");
    assert_eq!(jpeg["background"], "#ffffff");
    assert_eq!(jpeg["quality"], 90);

    let webp = engine
        .plan_webp_export(r#"{"lossless": true}"#)
        .expect("webp plans");
    assert_eq!(webp["background"], "transparent");
    assert_eq!(webp["lossless"], true);

    assert!(engine.plan_jpeg_export("not json").is_err());
    assert!(engine.plan_webp_export("not json").is_err());

    let empty = Engine::new();
    assert!(empty.plan_jpeg_export("{}").is_err());
    assert!(empty.plan_webp_export("{}").is_err());
}
