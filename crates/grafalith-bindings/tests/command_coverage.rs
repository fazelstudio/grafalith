//! Command coverage: every [`BatchOp`](grafalith_bindings::protocol::BatchOp)
//! parses from JSON, has a well-formed unique wire name, and dispatches
//! through `apply_ops` without panicking (each yields exactly one per-op
//! result, success or typed error).

use grafalith_bindings::protocol::{op_name, BatchOp};
use grafalith_bindings::Engine;
use serde_json::{json, Value};

fn rect(id: &str) -> Value {
    json!({
        "id": id,
        "type": "rectangle",
        "x": 10, "y": 10, "width": 100, "height": 50,
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

fn ellipse(id: &str) -> Value {
    let mut el = rect(id);
    el["type"] = Value::String("ellipse".to_string());
    el.as_object_mut()
        .expect("rect helper builds an object")
        .remove("roundness");
    el
}

/// One JSON op per [`BatchOp`] variant, in a stateful order (setup first).
fn all_ops() -> Vec<Value> {
    // `mut` is only exercised when the `svg` push below compiles in.
    #[cfg_attr(not(feature = "svg"), allow(unused_mut))]
    let mut ops = vec![
        json!({"op": "importScene", "scene": {"schemaVersion": 1, "elements": [rect("cov-1"), rect("cov-2")], "elementOrder": ["cov-1", "cov-2"]}}),
        json!({"op": "create", "element": rect("cov-3")}),
        json!({"op": "move", "ids": ["cov-1"], "dx": 5, "dy": 5}),
        json!({"op": "setBounds", "id": "cov-1", "x": 0, "y": 0, "width": 10, "height": 10}),
        json!({"op": "setRotation", "id": "cov-1", "rotation": 0.5}),
        json!({"op": "setStyle", "ids": ["cov-1"], "patch": {"strokeWidth": 3}}),
        json!({"op": "setLocked", "ids": ["cov-2"], "locked": true}),
        json!({"op": "reorder", "order": ["cov-2", "cov-1", "cov-3"]}),
        json!({"op": "group", "ids": ["cov-1", "cov-3"]}),
        json!({"op": "ungroup", "groupId": "group-404"}),
        json!({"op": "select", "ids": ["cov-1"]}),
        json!({"op": "setTool", "tool": "rectangle"}),
        json!({"op": "copy", "ids": ["cov-1"]}),
        json!({"op": "paste"}),
        json!({"op": "duplicate", "ids": ["cov-1"]}),
        json!({"op": "cut", "ids": ["cov-3"]}),
        json!({"op": "nudge", "dx": 1, "dy": 0}),
        json!({"op": "deleteSelected"}),
        json!({"op": "undo"}),
        json!({"op": "redo"}),
        json!({"op": "exportScene"}),
        json!({"op": "pointerDown", "x": 10, "y": 10, "button": "left"}),
        json!({"op": "pointerMove", "x": 12, "y": 12}),
        json!({"op": "pointerUp", "x": 12, "y": 12, "button": "left"}),
        json!({"op": "pointerCancel"}),
        json!({"op": "keyDown", "key": "Delete"}),
        json!({"op": "wheel", "dx": 0, "dy": 10, "x": 5, "y": 5}),
        json!({"op": "startTextAt", "x": 400, "y": 400}),
        json!({"op": "textInput", "text": "hi"}),
        json!({"op": "textBackspace"}),
        json!({"op": "textDelete"}),
        json!({"op": "textSetCaret", "caret": 1}),
        json!({"op": "compositionStart"}),
        json!({"op": "compositionUpdate", "buffer": "x"}),
        json!({"op": "compositionEnd", "finalText": "y"}),
        json!({"op": "commitText"}),
        json!({"op": "cancelText"}),
        json!({"op": "bringToFront", "ids": ["cov-1"]}),
        json!({"op": "sendToBack", "ids": ["cov-1"]}),
        json!({"op": "bringForward", "ids": ["cov-1"]}),
        json!({"op": "sendBackward", "ids": ["cov-1"]}),
        json!({"op": "align", "ids": ["cov-1", "cov-2"], "mode": "left"}),
        json!({"op": "distribute", "ids": ["cov-1", "cov-2"], "axis": "horizontal"}),
        json!({"op": "applyAutoLayout", "frameId": "frame-404"}),
        json!({"op": "resizeSelection", "ids": ["cov-1"], "original": {"minX": 0, "minY": 0, "maxX": 10, "maxY": 10}, "next": {"minX": 0, "minY": 0, "maxX": 20, "maxY": 20}}),
        json!({"op": "penBegin"}),
        json!({"op": "penClick", "x": 1, "y": 1}),
        json!({"op": "penDragHandle", "x": 2, "y": 2}),
        json!({"op": "penCommit"}),
        json!({"op": "penCancel"}),
        json!({"op": "cropStart", "id": "cov-1"}),
        json!({"op": "cropDrag", "handle": "right", "x": 5, "y": 5}),
        json!({"op": "cropCommit"}),
        json!({"op": "cropCancel"}),
        json!({"op": "pathEditBegin", "id": "path-404"}),
        json!({"op": "pathEditPress", "x": 1, "y": 1}),
        json!({"op": "pathEditDrag", "x": 2, "y": 2}),
        json!({"op": "pathEditRelease"}),
        json!({"op": "pathEditCommit"}),
        json!({"op": "pathEditCancel"}),
        json!({"op": "setViewport", "scrollX": 0, "scrollY": 0, "zoom": 1}),
        json!({"op": "fitViewport", "canvasWidth": 800, "canvasHeight": 600}),
        json!({"op": "fillViewport", "canvasWidth": 800, "canvasHeight": 600, "ids": ["cov-1"]}),
        json!({"op": "configure", "theme": {}}),
        json!({"op": "notifyAssetsChanged"}),
        json!({"op": "renderModel", "canvasWidth": 800, "canvasHeight": 600}),
        json!({"op": "previewMove", "ids": [], "from": {"x": 0, "y": 0}, "to": {"x": 1, "y": 1}}),
        json!({"op": "previewResize", "id": "cov-1", "handle": "bottom-right", "x": 5, "y": 5}),
        json!({"op": "previewRotate", "id": "cov-1", "anchor": {"x": 0, "y": 0}, "current": {"x": 1, "y": 1}}),
        json!({"op": "contextMenu"}),
        json!({"op": "drainEvents"}),
        json!({"op": "sessionState"}),
        json!({"op": "executeCommand", "commandId": "acme.missing.nope"}),
        // Boolean ops work on fresh rectangles (earlier ops mutate cov-*).
        json!({"op": "create", "element": rect("b1")}),
        json!({"op": "create", "element": rect("b2")}),
        json!({"op": "create", "element": rect("b3")}),
        json!({"op": "create", "element": rect("b4")}),
        json!({"op": "create", "element": rect("b5")}),
        json!({"op": "create", "element": rect("b6")}),
        json!({"op": "create", "element": rect("b7")}),
        json!({"op": "create", "element": rect("b8")}),
        json!({"op": "create", "element": ellipse("el1")}),
        json!({"op": "booleanUnion", "ids": ["el1", "b1"]}),
        json!({"op": "booleanUnion", "ids": ["b1", "b2"]}),
        json!({"op": "booleanSubtract", "ids": ["b3", "b4"]}),
        json!({"op": "booleanIntersect", "ids": ["b5", "b6"]}),
        json!({"op": "booleanExclude", "ids": ["b7", "b8"]}),
        json!({"op": "booleanUnion", "ids": ["b1"]}),
        json!({"op": "booleanUnion", "ids": ["ghost-1", "ghost-2"]}),
        // Second delete exercises a different path than the first.
        json!({"op": "delete", "ids": ["cov-2"]}),
    ];
    // importSvg exists only with the `svg` feature (zero-cost default).
    #[cfg(feature = "svg")]
    ops.push(json!({"op": "importSvg", "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "tracked": false}));
    ops
}

fn is_camel_case(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => (),
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric())
}

#[test]
fn every_op_has_a_unique_well_formed_wire_name() {
    let ops: Vec<BatchOp> = all_ops()
        .iter()
        .map(|op| serde_json::from_value(op.clone()).expect("every coverage op parses"))
        .collect();
    // 71 built-ins plus executeCommand (72), plus nine boolean-support
    // creates and seven boolean ops (88), plus fit/fill (90).
    // With the `svg` feature the importSvg op makes 91 occurrences.
    #[cfg(not(feature = "svg"))]
    assert_eq!(ops.len(), 90);
    #[cfg(feature = "svg")]
    assert_eq!(ops.len(), 91);

    let mut names: Vec<&str> = ops.iter().map(op_name).collect();
    for name in &names {
        assert!(is_camel_case(name), "wire name '{name}' is lowerCamel");
    }
    names.sort_unstable();
    names.dedup();
    // 71 built-ins plus executeCommand (72), plus four boolean ops (76),
    // plus fit/fill viewport (78). With the `svg` feature, importSvg
    // makes 79. Setup ops reuse names on purpose; uniqueness is per wire
    // name.
    #[cfg(not(feature = "svg"))]
    assert_eq!(names.len(), 78);
    #[cfg(feature = "svg")]
    assert_eq!(names.len(), 79);
    for required in [
        "executeCommand",
        "booleanUnion",
        "booleanSubtract",
        "booleanIntersect",
        "booleanExclude",
        "fitViewport",
        "fillViewport",
    ] {
        assert!(
            names.contains(&required),
            "wire name '{required}' is covered"
        );
    }
}

#[test]
fn every_op_dispatches_exactly_one_result_without_panicking() {
    let ops: Vec<BatchOp> = all_ops()
        .iter()
        .map(|op| serde_json::from_value(op.clone()).expect("every coverage op parses"))
        .collect();
    let expected: Vec<&str> = ops.iter().map(op_name).collect();

    let mut engine = Engine::new();
    let result = engine.apply_ops(ops);
    assert_eq!(result.results.len(), expected.len());
    for (outcome, name) in result.results.iter().zip(expected.iter()) {
        assert_eq!(&outcome.op, name);
        if !outcome.ok {
            assert!(
                outcome.code.is_some() && outcome.message.is_some(),
                "failed op '{name}' carries a stable code and message"
            );
        }
    }
    let ok_count = result.results.iter().filter(|r| r.ok).count();
    assert_eq!(result.applied, ok_count);
}
