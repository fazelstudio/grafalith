//! `fitViewport` / `fillViewport`: content framing math over the JSON
//! boundary (session change, never history).

use opennary_bindings::Engine;
use serde_json::{json, Value};

fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> Value {
    json!({
        "id": id,
        "type": "rectangle",
        "x": x, "y": y, "width": w, "height": h,
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

fn run(engine: &mut Engine, ops: Value) -> Value {
    let out = engine.apply_batch(&ops.to_string());
    serde_json::from_str(&out).expect("batch result parses")
}

fn viewport_of(result: &Value) -> (f64, f64, f64) {
    let viewport = &result["results"][0]["data"]["viewport"];
    (
        viewport["scrollX"].as_f64().expect("scrollX"),
        viewport["scrollY"].as_f64().expect("scrollY"),
        viewport["zoom"].as_f64().expect("zoom"),
    )
}

fn engine_with_content() -> Engine {
    let mut engine = Engine::new();
    let result = run(
        &mut engine,
        json!([
            {"op": "create", "element": rect("f1", 0.0, 0.0, 200.0, 100.0)},
            {"op": "create", "element": rect("f2", 400.0, 400.0, 100.0, 100.0)},
        ]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(result["results"][1]["ok"], true);
    engine
}

fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9
}

#[test]
fn fit_frames_all_content_centered() {
    let mut engine = engine_with_content();
    // Content spans (0,0)-(500,500); canvas 800x600, no padding.
    let result = run(
        &mut engine,
        json!([{"op": "fitViewport", "canvasWidth": 800, "canvasHeight": 600}]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    let (sx, sy, zoom) = viewport_of(&result);
    assert!(approx(zoom, 1.2));
    assert!(approx(sx, 800.0 / 2.4 - 250.0));
    assert!(approx(sy, 600.0 / 2.4 - 250.0));
}

#[test]
fn fill_covers_canvas_and_may_crop() {
    let mut engine = engine_with_content();
    let result = run(
        &mut engine,
        json!([{"op": "fillViewport", "canvasWidth": 800, "canvasHeight": 600}]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    let (_, _, zoom) = viewport_of(&result);
    // max(800/500, 600/500) = 1.6.
    assert!(approx(zoom, 1.6));
}

#[test]
fn fit_respects_ids_and_padding() {
    let mut engine = engine_with_content();
    // Only f1 (200x100 at origin) with 10 scene units of padding.
    let result = run(
        &mut engine,
        json!([{"op": "fitViewport", "canvasWidth": 800, "canvasHeight": 600, "padding": 10, "ids": ["f1"]}]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    let (sx, sy, zoom) = viewport_of(&result);
    // min(800/220, 600/120) = 800/220.
    let expected_zoom = 800.0 / 220.0;
    assert!(approx(zoom, expected_zoom));
    assert!(approx(sx, 800.0 / (2.0 * expected_zoom) - 100.0));
    assert!(approx(sy, 600.0 / (2.0 * expected_zoom) - 50.0));
}

#[test]
fn frame_errors_are_explicit_and_change_nothing() {
    let mut engine = Engine::new();
    let result = run(
        &mut engine,
        json!([
            {"op": "fitViewport", "canvasWidth": 800, "canvasHeight": 600},
            {"op": "fillViewport", "canvasWidth": 0, "canvasHeight": 600},
            {"op": "fitViewport", "canvasWidth": 800, "canvasHeight": 600, "padding": -1},
        ]),
    );
    let results = result["results"].as_array().expect("results array");
    // Empty scene: nothing to frame.
    assert_eq!(results[0]["ok"], false);
    assert_eq!(results[0]["code"], "invalidInput");
    // Degenerate canvas.
    assert_eq!(results[1]["ok"], false);
    assert_eq!(results[1]["code"], "invalidInput");
    // Negative padding.
    assert_eq!(results[2]["ok"], false);
    assert_eq!(results[2]["code"], "invalidInput");
    // Viewport untouched (identity default).
    let state = run(&mut engine, json!([{"op": "sessionState"}]));
    assert_eq!(state["results"][0]["data"]["viewport"]["zoom"], 1.0);
}
