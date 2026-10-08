//! Boolean ops over the JSON boundary: success paths record one undoable
//! entry; arity/type/identity failures carry stable per-op codes and change
//! nothing.

use opennary_bindings::Engine;
use serde_json::{json, Value};

fn rect(id: &str, x: f64, y: f64) -> Value {
    json!({
        "id": id,
        "type": "rectangle",
        "x": x, "y": y, "width": 100, "height": 50,
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

fn engine_with_pair() -> Engine {
    let mut engine = Engine::new();
    let result = run(
        &mut engine,
        json!([
            {"op": "create", "element": rect("u1", 0.0, 0.0)},
            {"op": "create", "element": rect("u2", 50.0, 0.0)},
        ]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(result["results"][1]["ok"], true);
    engine
}

#[test]
fn boolean_union_consumes_inputs_and_undoes_as_one_entry() {
    let mut engine = engine_with_pair();
    let result = run(
        &mut engine,
        json!([{"op": "booleanUnion", "ids": ["u1", "u2"]}]),
    );
    assert_eq!(result["results"][0]["op"], "booleanUnion");
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(result["results"][0]["data"]["changed"], true);
    // Disjoint exact cover: [0,50]x[0,50] plus u2's [50,150]x[0,50].
    assert_eq!(engine.element_count(), 2);

    let undo = run(&mut engine, json!([{"op": "undo"}]));
    assert_eq!(undo["results"][0]["ok"], true);
    let exported = run(&mut engine, json!([{"op": "exportScene"}]));
    let scene = &exported["results"][0]["data"];
    let ids: Vec<&str> = scene["elements"]
        .as_array()
        .expect("elements array")
        .iter()
        .map(|el| el["id"].as_str().expect("element id"))
        .collect();
    assert_eq!(ids, vec!["u1", "u2"]);
}

#[test]
fn boolean_failures_carry_stable_codes_and_change_nothing() {
    let mut engine = engine_with_pair();
    let before = engine.element_count();
    let result = run(
        &mut engine,
        json!([
            {"op": "booleanUnion", "ids": ["u1"]},
            {"op": "booleanSubtract", "ids": ["ghost-1", "ghost-2"]},
            {"op": "booleanIntersect", "ids": ["u1", "u1"]},
        ]),
    );
    let results = result["results"].as_array().expect("results array");
    assert_eq!(results[0]["ok"], false);
    assert_eq!(results[0]["code"], "invalidInput");
    assert_eq!(results[1]["ok"], false);
    assert_eq!(results[1]["code"], "notFound");
    assert_eq!(results[2]["ok"], false);
    assert_eq!(results[2]["code"], "invalidInput");
    assert_eq!(engine.element_count(), before);
    let status = run(&mut engine, json!([{"op": "sessionState"}]));
    assert_eq!(status["results"][0]["ok"], true);
}

#[test]
fn boolean_on_non_rectangle_is_explicitly_unsupported() {
    let mut engine = Engine::new();
    let mut ellipse = rect("e1", 0.0, 0.0);
    ellipse["type"] = Value::String("ellipse".to_string());
    ellipse
        .as_object_mut()
        .expect("rect helper builds an object")
        .remove("roundness");
    let created = run(&mut engine, json!([{"op": "create", "element": ellipse}]));
    assert_eq!(created["results"][0]["ok"], true);

    let result = run(
        &mut engine,
        json!([
            {"op": "booleanUnion", "ids": ["e1", "e1"]},
            {"op": "booleanExclude", "ids": ["e1", "ghost-9"]},
        ]),
    );
    // Same-id check fires before the type check.
    assert_eq!(result["results"][0]["code"], "invalidInput");
    assert_eq!(result["results"][1]["ok"], false);
    assert_eq!(result["results"][1]["code"], "unsupported");
    assert_eq!(engine.element_count(), 1);
}

fn closed_path(id: &str, x: f64, y: f64, size: f64) -> Value {
    json!({
        "id": id,
        "type": "path",
        "x": x, "y": y, "width": size, "height": size,
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
        "segments": [
            {"point": [0, 0]},
            {"point": [size, 0]},
            {"point": [size, size]},
            {"point": [0, size]},
        ],
        "closed": true,
    })
}

#[test]
fn boolean_union_of_paths_returns_one_closed_path() {
    let mut engine = Engine::new();
    let created = run(
        &mut engine,
        json!([
            {"op": "create", "element": closed_path("pa", 0.0, 0.0, 100.0)},
            {"op": "create", "element": closed_path("pb", 50.0, 50.0, 100.0)},
        ]),
    );
    assert_eq!(created["results"][0]["ok"], true);
    assert_eq!(created["results"][1]["ok"], true);

    let result = run(
        &mut engine,
        json!([{"op": "booleanUnion", "ids": ["pa", "pb"]}]),
    );
    assert_eq!(result["results"][0]["ok"], true);
    assert_eq!(engine.element_count(), 1);

    let exported = run(&mut engine, json!([{"op": "exportScene"}]));
    let elements = exported["results"][0]["data"]["elements"]
        .as_array()
        .expect("elements array");
    assert_eq!(elements.len(), 1);
    assert_eq!(elements[0]["type"], "path");
    assert_eq!(elements[0]["closed"], true);
}
