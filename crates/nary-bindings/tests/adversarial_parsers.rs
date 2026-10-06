//! Adversarial parser corpus: hostile inputs must yield typed JSON
//! errors, never panics.
//!
//! This is the deterministic stand-in for `cargo-fuzz` (libfuzzer is
//! unavailable on the stable-only toolchain here): a checked-in corpus of
//! truncated, mistyped, extreme, and oversized payloads across every parse
//! entry point (`apply_batch`, `importScene`, clipboard decode, export
//! plans). A follow-up wires these same shapes into `cargo-fuzz` targets.

use nary_bindings::Engine;
use serde_json::{json, Value};

/// Every crossing returns JSON (result or envelope) — never a panic, never
/// a non-JSON string.
fn crossing_is_json(out: &str) -> Value {
    serde_json::from_str(out).expect("every crossing returns JSON")
}

#[test]
fn hostile_batches_never_panic_and_stay_typed() {
    let mut engine = Engine::new();
    let hostile: Vec<String> = [
        "",
        "[",
        "{",
        "null",
        "42",
        "\"executeCommand\"",
        "[null]",
        "[true]",
        "[[]]",
        "[{}]",
    ]
    .iter()
    .map(|s| s.to_string())
    .chain(
        [
            json!([{"op": "create"}]).to_string(),
            json!([{"op": "create", "element": null}]).to_string(),
        json!([{"op": "create", "element": {"type": "rectangle"}}]).to_string(),
        json!([{"op": "move", "ids": "not-an-array", "dx": 1, "dy": 1}]).to_string(),
        json!([{"op": "setBounds", "id": "x", "x": 1e308, "y": -1e308, "width": 1e308, "height": 0}])
            .to_string(),
        json!([{"op": "setRotation", "id": "x", "rotation": 1e308}]).to_string(),
        json!([{"op": "reorder", "order": [null, 42, true]}]).to_string(),
        json!([{"op": "importScene", "scene": [1, 2, 3]}]).to_string(),
        json!([{"op": "importScene", "scene": {"schemaVersion": 999, "elements": []}}])
            .to_string(),
        json!([{"op": "renderModel", "canvasWidth": -5, "canvasHeight": 0}]).to_string(),
        json!([{"op": "setViewport", "scrollX": 0, "scrollY": 0, "zoom": 1e308}])
            .to_string(),
        json!([{"op": "textSetCaret", "caret": 9999999999999999999u64}]).to_string(),
        json!([{"op": "resizeSelection", "ids": [], "original": {"minX": 0, "minY": 0, "maxX": 0, "maxY": 0}, "next": {"minX": 0, "minY": 0, "maxX": 0, "maxY": 0}}])
            .to_string(),
        // Deeply nested arrays (serde recursion limit must error, not hang).
        format!("[{{\"op\": \"create\", \"element\": {}}}]", "[".repeat(300)),
        // Unknown op fails the whole batch loudly (skew detection).
        json!([{"op": "definitelyNotAnOp"}]).to_string(),
        // Emoji/unicode ids are accepted as opaque strings or rejected typed.
        json!([{"op": "select", "ids": ["🎨\u{0}\n\r\t"]}]).to_string(),
        ],
    )
    .collect::<Vec<String>>();
    for payload in &hostile {
        let value = crossing_is_json(&engine.apply_batch(payload));
        let preview: String = payload.chars().take(80).collect();
        // Either a per-op result array or a top-level error envelope.
        assert!(
            value.get("results").is_some() || value.get("code").is_some(),
            "hostile input stays in the JSON envelope: {preview}"
        );
    }
}

#[test]
fn oversized_but_valid_batches_still_apply() {
    let mut engine = Engine::new();
    // 500 creates in one crossing (large-paste shape).
    let creates: Vec<Value> = (0..500)
        .map(|i| {
            json!({"op": "create", "element": {
                "id": format!("bulk-{i}"), "type": "rectangle",
                "x": i, "y": i, "width": 10, "height": 10, "rotation": 0,
                "strokeColor": "#000",
                "backgroundColor": {"type": "solid", "color": "#fff"},
                "strokeWidth": 1, "strokeStyle": "solid", "fillStyle": "solid",
                "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
                "isDeleted": false, "groupIds": [], "locked": false,
                "hidden": false, "frameId": null, "roundness": null,
            }})
        })
        .collect();
    let value = crossing_is_json(&engine.apply_batch(&serde_json::to_string(&creates).unwrap()));
    assert_eq!(value["applied"], 500);
    assert_eq!(engine.element_count(), 500);
}

#[test]
fn clipboard_and_plan_entry_points_reject_garbage_typed() {
    let engine = Engine::new();
    assert!(Engine::decode_clipboard("not json").is_err());
    assert!(Engine::decode_clipboard("[1,2,3]").is_err());
    assert!(Engine::decode_clipboard("{\"schemaVersion\": 999, \"elements\": []}").is_err());
    assert!(engine.plan_png_export("[").is_err());
    assert!(engine.plan_jpeg_export("null").is_err());
    assert!(engine.plan_webp_export("42").is_err());
}
