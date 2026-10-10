//! Render golden: a fixed scene produces byte-identical `renderModel` JSON.
//!
//! The fixture (`fixtures/render_model_golden.json`) is a regression lock,
//! not a hand-written oracle: regenerate it deliberately with
//! `UPDATE_GOLDEN=1` after reviewing the diff, never to silence a failure.
//! Key fields are additionally asserted explicitly so a blob change always
//! comes with a human-readable failure first.

use grafalith_bindings::Engine;
use serde_json::{json, Value};

const GOLDEN: &str = include_str!("fixtures/render_model_golden.json");

fn rect(id: &str, x: f64, y: f64, w: f64, h: f64, rotation: f64) -> Value {
    json!({
        "id": id,
        "type": "rectangle",
        "x": x, "y": y, "width": w, "height": h,
        "rotation": rotation,
        "strokeColor": "#445566",
        "backgroundColor": {"type": "solid", "color": "#112233"},
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "fillStyle": "solid",
        "opacity": 100,
        "seed": 7,
        "version": 0,
        "versionNonce": 7,
        "isDeleted": false,
        "groupIds": [],
        "locked": false,
        "hidden": false,
        "frameId": null,
        "roundness": null
    })
}

fn ellipse(id: &str, x: f64, y: f64, w: f64, h: f64) -> Value {
    let mut el = rect(id, x, y, w, h, 0.0);
    el["type"] = Value::String("ellipse".to_string());
    el.as_object_mut()
        .expect("rect helper builds an object")
        .remove("roundness");
    el
}

fn render_data() -> Value {
    let mut engine = Engine::new();
    let setup = engine.apply_batch(
        &json!([
            {"op": "create", "element": rect("r1", 10.0, 20.0, 100.0, 50.0, 0.0)},
            {"op": "create", "element": rect("r2", 300.0, 200.0, 120.0, 80.0, 0.5)},
            {"op": "create", "element": ellipse("e1", 500.0, 400.0, 90.0, 60.0)},
            {"op": "select", "ids": ["r1"]},
        ])
        .to_string(),
    );
    let setup: Value = serde_json::from_str(&setup).expect("setup parses");
    assert!(
        setup["results"]
            .as_array()
            .expect("results")
            .iter()
            .all(|r| r["ok"] == true),
        "golden setup applies cleanly: {setup}"
    );
    let out = engine.apply_batch(
        &json!([{"op": "renderModel", "canvasWidth": 800, "canvasHeight": 600}]).to_string(),
    );
    let out: Value = serde_json::from_str(&out).expect("render result parses");
    assert_eq!(out["results"][0]["ok"], true);
    out["results"][0]["data"].clone()
}

#[test]
fn render_model_matches_golden_fixture() {
    let data = render_data();
    // Explicit pins first (readable failures), blob second (lock).
    let base = data["base"].as_array().expect("base entries");
    assert_eq!(base.len(), 3);
    assert_eq!(base[0]["id"], "r1");
    assert_eq!(base[0]["kind"], "rectangle");
    assert_eq!(base[1]["kind"], "rectangle");
    assert_eq!(base[2]["kind"], "ellipse");
    assert!(data["selection"].is_object());

    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/tests/fixtures/render_model_golden.json"
            ),
            serde_json::to_string_pretty(&data).expect("golden serializes"),
        )
        .expect("golden writes");
        return;
    }
    let expected: Value = serde_json::from_str(GOLDEN).expect("fixture parses");
    assert_eq!(
        data, expected,
        "renderModel output matches the golden fixture"
    );
}

fn render_query(engine: &mut Engine) -> Value {
    let out = engine.apply_batch(
        &serde_json::json!([{"op": "renderModel", "canvasWidth": 800, "canvasHeight": 600}])
            .to_string(),
    );
    let out: Value = serde_json::from_str(&out).expect("render result parses");
    assert_eq!(out["results"][0]["ok"], true);
    out["results"][0]["data"].clone()
}

fn seeded_engine() -> Engine {
    let mut engine = Engine::new();
    let setup = engine.apply_batch(
        &serde_json::json!([
            {"op": "create", "element": rect("c1", 10.0, 20.0, 100.0, 50.0, 0.0)},
            {"op": "create", "element": rect("c2", 300.0, 200.0, 120.0, 80.0, 0.0)},
        ])
        .to_string(),
    );
    let setup: Value = serde_json::from_str(&setup).expect("setup parses");
    assert!(setup["results"]
        .as_array()
        .expect("results")
        .iter()
        .all(|r| r["ok"] == true));
    engine
}

#[test]
fn repeated_identical_polls_hit_the_cache() {
    let mut engine = seeded_engine();
    let first = render_query(&mut engine);
    assert_eq!(engine.render_cache_misses(), 1);
    let second = render_query(&mut engine);
    assert_eq!(engine.render_cache_hits(), 1);
    assert_eq!(first, second, "cached frame is identical");
    let _ = render_query(&mut engine);
    assert_eq!(engine.render_cache_hits(), 2);
}

#[test]
fn any_input_change_misses_and_never_serves_stale_frames() {
    let mut engine = seeded_engine();
    let before = render_query(&mut engine);
    // Content change invalidates.
    engine.apply_batch(
        &serde_json::json!([{"op": "move", "ids": ["c1"], "dx": 5.0, "dy": 0.0}]).to_string(),
    );
    let after_move = render_query(&mut engine);
    assert_ne!(before, after_move);
    assert_eq!(engine.render_cache_misses(), 2);
    // Selection change invalidates (overlay differs).
    engine.apply_batch(&serde_json::json!([{"op": "select", "ids": ["c2"]}]).to_string());
    let after_select = render_query(&mut engine);
    assert_ne!(after_move, after_select);
    // Viewport change invalidates.
    engine.apply_batch(
        &serde_json::json!([{"op": "setViewport", "scrollX": 10, "scrollY": 0, "zoom": 1}])
            .to_string(),
    );
    let after_pan = render_query(&mut engine);
    assert_ne!(after_select, after_pan);
    assert_eq!(engine.render_cache_misses(), 4);
    // Repeating the latest state hits again.
    let _ = render_query(&mut engine);
    assert_eq!(engine.render_cache_hits(), 1);
}
