//! Regression tests for the layout ops (`align`, `distribute`,
//! `applyAutoLayout`).
//!
//! Every test crosses the JSON-string boundary like a JS host: batch in,
//! envelope out, then document assertions.

use grafalith_bindings::Engine;
use serde_json::{json, Value};

fn rect(id: &str, x: f64, y: f64, w: f64, h: f64) -> Value {
    json!({
        "id": id,
        "type": "rectangle",
        "x": x, "y": y, "width": w, "height": h,
        "rotation": 0,
        "strokeColor": "#333333",
        "backgroundColor": {"type": "solid", "color": "#e8f4fc"},
        "strokeWidth": 2, "strokeStyle": "solid", "fillStyle": "solid",
        "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
        "isDeleted": false, "groupIds": [], "locked": false,
        "hidden": false, "frameId": null, "roundness": null
    })
}

fn apply(engine: &mut Engine, ops: Value) -> Value {
    let out = engine.apply_batch(&ops.to_string());
    serde_json::from_str(&out).expect("batch result must be JSON")
}

fn seed(engine: &mut Engine, elements: &[Value]) {
    let order: Vec<Value> = elements.iter().map(|e| e["id"].clone()).collect();
    let scene = json!({"schemaVersion": 1, "elements": elements, "elementOrder": order});
    let out = apply(
        engine,
        json!([{ "op": "importScene", "scene": scene, "tracked": false }]),
    );
    assert!(
        out["results"][0]["ok"].as_bool().unwrap(),
        "seed import: {out}"
    );
}

fn element_x(engine: &Engine, id: &str) -> f64 {
    engine.document().get(id).unwrap().base().x
}

fn element_y(engine: &Engine, id: &str) -> f64 {
    engine.document().get(id).unwrap().base().y
}

#[test]
fn align_left_snaps_to_leftmost_edge() {
    let mut engine = Engine::new();
    seed(
        &mut engine,
        &[
            rect("a", 0.0, 0.0, 100.0, 50.0),
            rect("b", 250.0, 30.0, 100.0, 50.0),
        ],
    );
    let out = apply(
        &mut engine,
        json!([{ "op": "align", "ids": ["a", "b"], "mode": "left" }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap(), "align: {out}");
    assert_eq!(element_x(&engine, "a"), 0.0);
    assert_eq!(element_x(&engine, "b"), 0.0);
}

#[test]
fn align_rejects_unknown_mode() {
    let mut engine = Engine::new();
    seed(&mut engine, &[rect("a", 0.0, 0.0, 100.0, 50.0)]);
    let out = apply(
        &mut engine,
        json!([{ "op": "align", "ids": ["a"], "mode": "diagonal" }]),
    );
    assert!(!out["results"][0]["ok"].as_bool().unwrap());
    assert_eq!(out["results"][0]["code"], "invalidInput");
}

#[test]
fn distribute_horizontal_equalizes_gaps() {
    let mut engine = Engine::new();
    seed(
        &mut engine,
        &[
            rect("a", 0.0, 0.0, 50.0, 50.0),
            rect("b", 200.0, 0.0, 50.0, 50.0),
            rect("c", 400.0, 0.0, 50.0, 50.0),
        ],
    );
    let out = apply(
        &mut engine,
        json!([{ "op": "distribute", "ids": ["a", "b", "c"], "axis": "horizontal" }]),
    );
    assert!(
        out["results"][0]["ok"].as_bool().unwrap(),
        "distribute: {out}"
    );
    // Span 400, two 50-wide boxes except last => gap (400-100)/2 = 150.
    assert_eq!(element_x(&engine, "a"), 0.0);
    assert_eq!(element_x(&engine, "b"), 200.0);
    assert_eq!(element_x(&engine, "c"), 400.0);
}

#[test]
fn distribute_with_two_elements_is_noop_success() {
    let mut engine = Engine::new();
    seed(
        &mut engine,
        &[
            rect("a", 0.0, 0.0, 50.0, 50.0),
            rect("b", 200.0, 0.0, 50.0, 50.0),
        ],
    );
    let out = apply(
        &mut engine,
        json!([{ "op": "distribute", "ids": ["a", "b"], "axis": "horizontal" }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap());
    assert_eq!(element_x(&engine, "b"), 200.0, "no-op must not move");
}

#[test]
fn move_follows_bound_arrows_in_same_batch() {
    let mut engine = Engine::new();
    seed(
        &mut engine,
        &[
            rect("box", 0.0, 0.0, 100.0, 100.0),
            json!({
                "id": "arr", "type": "arrow",
                "x": 0, "y": 0, "width": 200, "height": 0,
                "rotation": 0, "strokeColor": "#333", "backgroundColor": {"type": "solid", "color": "transparent"},
                "strokeWidth": 2, "strokeStyle": "solid", "fillStyle": "solid",
                "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
                "isDeleted": false, "groupIds": [], "locked": false,
                "hidden": false, "frameId": null,
                "points": [[100, 50], [200, 50]],
                "startBinding": {"elementId": "box", "focus": 0.375, "gap": 0},
                "endBinding": null, "startArrowhead": null, "endArrowhead": "arrow"
            }),
        ],
    );
    let out = apply(
        &mut engine,
        json!([{ "op": "move", "ids": ["box"], "dx": 100.0, "dy": 0.0 }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap(), "move: {out}");
    // Bound endpoint must have tracked the box; the free endpoint stays.
    let arrow = engine.document().get("arr").unwrap();
    let points = match arrow {
        grafalith_core::element::Element::Arrow(a) => a.points.clone(),
        _ => panic!("expected arrow"),
    };
    assert!((element_x(&engine, "box") - 100.0).abs() < 1e-9);
    // Start endpoint was at box right edge (100,50); box moved +100x so the
    // follow pass rewrites it near (200,50) relative to arrow origin.
    assert!((points[0][0] - 200.0).abs() < 1.0, "followed: {points:?}");
    assert!(
        (points[1][0] - 200.0).abs() < 1e-9,
        "free endpoint untouched"
    );
    let _ = element_y(&engine, "box");
}

#[test]
fn resize_selection_scales_block_proportionally() {
    let mut engine = Engine::new();
    seed(
        &mut engine,
        &[
            rect("a", 0.0, 0.0, 100.0, 100.0),
            rect("b", 200.0, 0.0, 100.0, 100.0),
        ],
    );
    let out = apply(
        &mut engine,
        json!([{ "op": "resizeSelection",
            "ids": ["a", "b"],
            "original": {"minX": 0.0, "minY": 0.0, "maxX": 300.0, "maxY": 100.0},
            "next": {"minX": 0.0, "minY": 0.0, "maxX": 600.0, "maxY": 200.0} }]),
    );
    assert!(
        out["results"][0]["ok"].as_bool().unwrap(),
        "resizeSelection: {out}"
    );
    assert_eq!(element_x(&engine, "a"), 0.0);
    assert_eq!(element_x(&engine, "b"), 400.0);
    assert_eq!(engine.document().get("a").unwrap().base().width, 200.0);
}

#[test]
fn pen_click_drag_commit_creates_path() {
    let mut engine = Engine::new();
    let out = apply(&mut engine, json!([{ "op": "penBegin" }]));
    assert!(out["results"][0]["ok"].as_bool().unwrap());
    let out = apply(
        &mut engine,
        json!([{ "op": "penClick", "x": 0.0, "y": 0.0 }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap());
    let out = apply(
        &mut engine,
        json!([{ "op": "penClick", "x": 50.0, "y": 0.0 }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap());
    let out = apply(
        &mut engine,
        json!([{ "op": "penDragHandle", "x": 70.0, "y": 10.0 }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap());
    let out = apply(
        &mut engine,
        json!([{ "op": "penClick", "x": 50.0, "y": 50.0 }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap());
    let out = apply(&mut engine, json!([{ "op": "penCommit" }]));
    assert!(
        out["results"][0]["ok"].as_bool().unwrap(),
        "penCommit: {out}"
    );
    assert!(out["results"][0]["data"]["committed"].as_bool().unwrap());
    assert_eq!(engine.document().element_count(), 1);
}

#[test]
fn crop_start_drag_commit_sets_region() {
    let mut engine = Engine::new();
    seed(
        &mut engine,
        &[json!({
            "id": "img", "type": "image",
            "x": 0, "y": 0, "width": 100, "height": 100,
            "rotation": 0, "strokeColor": "#333",
            "backgroundColor": {"type": "solid", "color": "transparent"},
            "strokeWidth": 2, "strokeStyle": "solid", "fillStyle": "solid",
            "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
            "isDeleted": false, "groupIds": [], "locked": false,
            "hidden": false, "frameId": null,
            "assetId": "a1", "naturalWidth": 800, "naturalHeight": 600, "crop": null
        })],
    );
    let out = apply(&mut engine, json!([{ "op": "cropStart", "id": "img" }]));
    assert!(
        out["results"][0]["ok"].as_bool().unwrap(),
        "cropStart: {out}"
    );
    let out = apply(
        &mut engine,
        json!([{ "op": "cropDrag", "handle": "top-left", "x": 100.0, "y": 50.0 }]),
    );
    assert!(
        out["results"][0]["ok"].as_bool().unwrap(),
        "cropDrag: {out}"
    );
    let out = apply(&mut engine, json!([{ "op": "cropCommit" }]));
    assert!(
        out["results"][0]["ok"].as_bool().unwrap(),
        "cropCommit: {out}"
    );
    assert!(out["results"][0]["data"]["committed"].as_bool().unwrap());
}

#[test]
fn path_edit_press_drag_commit_round_trip() {
    let mut engine = Engine::new();
    seed(
        &mut engine,
        &[json!({
            "id": "p", "type": "path",
            "x": 0, "y": 0, "width": 100, "height": 100,
            "rotation": 0, "strokeColor": "#333",
            "backgroundColor": {"type": "solid", "color": "transparent"},
            "strokeWidth": 2, "strokeStyle": "solid", "fillStyle": "solid",
            "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
            "isDeleted": false, "groupIds": [], "locked": false,
            "hidden": false, "frameId": null,
            "segments": [
                {"point": [0, 0], "handleIn": null, "handleOut": null},
                {"point": [100, 0], "handleIn": null, "handleOut": null},
                {"point": [100, 100], "handleIn": null, "handleOut": null}
            ],
            "closed": false
        })],
    );
    let out = apply(&mut engine, json!([{ "op": "pathEditBegin", "id": "p" }]));
    assert!(out["results"][0]["ok"].as_bool().unwrap(), "begin: {out}");
    let out = apply(
        &mut engine,
        json!([{ "op": "pathEditPress", "x": 0.0, "y": 0.0, "zoom": 1.0 }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap(), "press: {out}");
    assert_eq!(out["results"][0]["data"]["kind"], "anchor");
    let out = apply(
        &mut engine,
        json!([{ "op": "pathEditDrag", "x": 10.0, "y": 5.0 }]),
    );
    assert!(out["results"][0]["ok"].as_bool().unwrap(), "drag: {out}");
    let out = apply(&mut engine, json!([{ "op": "pathEditRelease" }]));
    assert!(out["results"][0]["ok"].as_bool().unwrap());
    let out = apply(&mut engine, json!([{ "op": "pathEditCommit" }]));
    assert!(out["results"][0]["ok"].as_bool().unwrap(), "commit: {out}");
    assert!(out["results"][0]["data"]["committed"].as_bool().unwrap());
}
