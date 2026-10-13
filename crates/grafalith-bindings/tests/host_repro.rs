//! Host-sequence regression tests: replay the exact multi-batch flows
//! `Canvas.tsx` sends for draw drags (separate batches per DOM event with
//! interleaved watcher polls).
//!
//! Draw releases commit statelessly through `commitDraw`: the release
//! carries the host-kept press origin, release point, and freedraw trail,
//! so the store no longer depends on the pointer-phase machine. Moves only
//! ever feed the host ghost (read-only previews); the document is written
//! exactly once, on release.

use grafalith_bindings::Engine;
use serde_json::{json, Value};

/// Applies ops and parses the [`BatchResult`] envelope.
fn apply(engine: &mut Engine, ops: Value) -> Value {
    let raw = engine.apply_batch(&ops.to_string());
    serde_json::from_str(&raw).expect("batch result is JSON")
}

/// Returns the `data` payload of the last successful `op` result.
fn last_ok_data(result: &Value, op: &str) -> Value {
    let results = result["results"].as_array().expect("results array");
    let mut found = Value::Null;
    for entry in results {
        if entry["op"] == op && entry["ok"] == true {
            found = entry["data"].clone();
        }
    }
    assert!(found.is_object(), "op {op} ok: {result}");
    found
}

fn undo_len(engine: &Engine) -> i64 {
    serde_json::from_str::<Value>(&engine.status_json()).expect("status")["undoLen"]
        .as_i64()
        .expect("undoLen")
}

fn draw_commit(
    engine: &mut Engine,
    request: &str,
    shape: &str,
    origin: (f64, f64),
    current: (f64, f64),
) -> Value {
    apply(
        engine,
        json!([
            {"op": "commitDraw", "requestId": request, "shape": shape,
             "origin": {"x": origin.0, "y": origin.1},
             "current": {"x": current.0, "y": current.1}},
        ]),
    )
}

fn exported_elements(engine: &mut Engine) -> Vec<Value> {
    let exported = apply(engine, json!([{"op": "exportScene"}]));
    last_ok_data(&exported, "exportScene")["elements"]
        .as_array()
        .expect("array")
        .clone()
}

// ---------------------------------------------------------------------------
// Pointer-path draw (kept for other hosts): down -> moves -> release.
// ---------------------------------------------------------------------------

#[test]
fn host_draw_drag_sequence_commits_on_release() {
    let mut engine = Engine::new();
    let mods = json!({"shift": false, "alt": false, "ctrlOrCmd": false});

    // Tool-switch effect.
    let switched = apply(
        &mut engine,
        json!([
            {"op": "configure", "theme": {"colors": {"canvasBackground": "#f0efec"}}},
            {"op": "setTool", "tool": "rectangle"},
        ]),
    );
    assert_eq!(switched["applied"], 2, "tool switch applies: {switched}");

    // Pointer press + inline session read.
    let pressed = apply(
        &mut engine,
        json!([
            {"op": "pointerDown", "x": 100.0, "y": 100.0, "button": "left",
             "modifiers": mods, "clickCount": 1},
            {"op": "sessionState"},
        ]),
    );
    assert_eq!(pressed["applied"], 2, "press applies: {pressed}");
    let press_session = last_ok_data(&pressed, "sessionState");
    assert_eq!(
        press_session["pointerPhase"]["kind"], "pressed",
        "press captures: {press_session}"
    );

    // Watcher poll racing between press and first move.
    let poll = apply(&mut engine, json!([{"op": "sessionState"}]));
    let poll_phase = last_ok_data(&poll, "sessionState")["pointerPhase"]["kind"].clone();
    assert_eq!(poll_phase, "pressed");

    // Drag moves, each its own batch (draw tools send no preview query).
    for (x, y) in [(150.0, 140.0), (200.0, 180.0), (250.0, 220.0)] {
        let moved = apply(
            &mut engine,
            json!([{"op": "pointerMove", "x": x, "y": y, "modifiers": mods}]),
        );
        assert_eq!(moved["applied"], 1, "move applies: {moved}");
    }
    let mid = apply(&mut engine, json!([{"op": "sessionState"}]));
    assert_eq!(
        last_ok_data(&mid, "sessionState")["pointerPhase"]["kind"],
        "drawing",
        "moves cross the drag threshold"
    );

    // Release + inline session read.
    let released = apply(
        &mut engine,
        json!([
            {"op": "pointerUp", "x": 250.0, "y": 220.0, "button": "left", "modifiers": mods},
            {"op": "sessionState"},
        ]),
    );
    assert_eq!(released["applied"], 2, "release applies: {released}");
    let up_data = last_ok_data(&released, "pointerUp");
    assert_eq!(
        up_data["kind"], "shapeCreated",
        "release commits: {up_data}"
    );
    let id = up_data["id"].as_str().expect("created id").to_string();
    assert_eq!(engine.element_count(), 1, "one element committed");

    // Post-commit frame query paints the new element.
    let frame = apply(
        &mut engine,
        json!([
            {"op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0},
            {"op": "sessionState"},
        ]),
    );
    let model = last_ok_data(&frame, "renderModel");
    let base = model["base"].as_array().expect("base");
    assert_eq!(base.len(), 1);
    assert_eq!(base[0]["id"], id);
}

#[test]
fn pointer_release_geometry_comes_from_release_not_last_move() {
    // The final box spans press origin to release point even when the last
    // move stopped elsewhere: the commit must never reuse a stale cursor.
    let mut engine = Engine::new();
    let released = apply(
        &mut engine,
        json!([
            {"op": "setTool", "tool": "rectangle"},
            {"op": "pointerDown", "x": 0.0, "y": 0.0, "button": "left",
             "modifiers": {}, "clickCount": 1},
            {"op": "pointerMove", "x": 10.0, "y": 10.0, "modifiers": {}},
            {"op": "pointerUp", "x": 100.0, "y": 100.0, "button": "left", "modifiers": {}},
        ]),
    );
    let results = released["results"].as_array().expect("results");
    assert_eq!(released["applied"], 4, "all ops apply: {released}");
    let up_data = &results[3];
    assert_eq!(up_data["data"]["kind"], "shapeCreated");
    let id = up_data["data"]["id"].as_str().expect("id").to_string();
    let found = exported_elements(&mut engine)
        .into_iter()
        .find(|el| el["id"] == id)
        .expect("shape present");
    assert_eq!(found["x"], 0.0);
    assert_eq!(found["y"], 0.0);
    assert_eq!(
        found["width"], 100.0,
        "release point wins, not the last move"
    );
    assert_eq!(found["height"], 100.0);
}

// ---------------------------------------------------------------------------
// Stateless release path (`commitDraw`): the desktop draw flow.
// ---------------------------------------------------------------------------

#[test]
fn draw_release_commits_without_any_gesture_state() {
    // Whatever the pointer-phase machine holds (here: a capture stuck in
    // Pressed because every move was lost), the release stores from the
    // host-kept corners and leaves no capture behind.
    let mut engine = Engine::new();
    let undo_before = undo_len(&engine);
    let stuck = apply(
        &mut engine,
        json!([
            {"op": "setTool", "tool": "rectangle"},
            {"op": "pointerDown", "x": 100.0, "y": 100.0, "button": "left",
             "modifiers": {}, "clickCount": 1},
        ]),
    );
    assert_eq!(stuck["applied"], 2, "stuck press applies: {stuck}");

    let released = apply(
        &mut engine,
        json!([
            {"op": "commitDraw", "requestId": "draw-1", "shape": "rectangle",
             "origin": {"x": 100.0, "y": 100.0},
             "current": {"x": 250.0, "y": 220.0}},
            {"op": "sessionState"},
        ]),
    );
    assert_eq!(released["applied"], 2, "release applies: {released}");
    let commit = last_ok_data(&released, "commitDraw");
    let id = commit["id"].as_str().expect("created id").to_string();
    assert_eq!(engine.element_count(), 1, "one element committed");
    let session = last_ok_data(&released, "sessionState");
    assert_eq!(
        session["selection"],
        json!([id]),
        "commit selects the shape"
    );
    assert_eq!(
        undo_len(&engine),
        undo_before + 1,
        "one history entry for the drag"
    );
    assert_eq!(
        session["pointerPhase"]["kind"], "idle",
        "no capture leaks past release"
    );

    let frame = apply(
        &mut engine,
        json!([{"op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0}]),
    );
    let model = last_ok_data(&frame, "renderModel");
    let entry = model["base"]
        .as_array()
        .expect("base")
        .iter()
        .find(|entry| entry["id"] == id)
        .expect("committed shape renders");
    assert_eq!(entry["kind"], "rectangle");

    // Below-minimum drags still decline silently (tap parity).
    let tap = draw_commit(&mut engine, "draw-2", "ellipse", (10.0, 10.0), (11.0, 10.5));
    assert!(last_ok_data(&tap, "commitDraw")["id"].is_null());
    assert_eq!(engine.element_count(), 1, "tap commits nothing");

    // Non-finite input is an explicit error: no element, no history entry,
    // no selection change. (NaN cannot cross JSON, so this goes through
    // the typed entry point.)
    let selection_before = session["selection"].clone();
    {
        use grafalith_bindings::protocol::{BatchOp, PointJson};
        let result = engine.apply_ops(vec![BatchOp::CommitDraw {
            request_id: Some("draw-3".to_string()),
            shape: "rectangle".to_string(),
            origin: PointJson { x: 0.0, y: 0.0 },
            current: PointJson {
                x: f64::NAN,
                y: 0.0,
            },
            trail: None,
        }]);
        assert_eq!(result.applied, 0);
        assert!(!result.results[0].ok);
        assert_eq!(result.results[0].code.as_deref(), Some("invalidInput"));
    }
    assert_eq!(engine.element_count(), 1);
    assert_eq!(undo_len(&engine), undo_before + 1, "no partial history");
    let after = apply(&mut engine, json!([{"op": "sessionState"}]));
    assert_eq!(
        last_ok_data(&after, "sessionState")["selection"],
        selection_before,
        "failed commit keeps the selection"
    );
}

#[test]
fn commit_without_request_id_still_commits_for_older_hosts() {
    // Forward compatibility across a partial upgrade: a host built before
    // the request id existed sends no id, and the commit must still store
    // (without duplicate suppression). Failing the whole batch here would
    // silently break drawing for any stale frontend.
    let mut engine = Engine::new();
    let undo_before = undo_len(&engine);
    let legacy = apply(
        &mut engine,
        json!([
            {"op": "commitDraw", "shape": "rectangle",
             "origin": {"x": 0.0, "y": 0.0}, "current": {"x": 50.0, "y": 40.0}},
            {"op": "sessionState"},
        ]),
    );
    assert_eq!(legacy["applied"], 2, "legacy op applies: {legacy}");
    let commit = last_ok_data(&legacy, "commitDraw");
    assert!(
        commit["id"].as_str().is_some(),
        "legacy commit stores: {commit}"
    );
    assert_eq!(engine.element_count(), 1);
    assert_eq!(undo_len(&engine), undo_before + 1);
}

#[test]
fn first_draw_on_a_document_with_imported_ids_commits() {
    // The exact field failure: the scene already holds `el-1` (template,
    // import, or cross-document paste) while the local counter still starts
    // at 1. The first draw must skip to `el-2` instead of failing the whole
    // release with an id collision — and a reboot (fresh counter, same
    // scene) must behave identically instead of needing failed attempts to
    // burn the counter forward.
    for attempt in 0..2 {
        let mut engine = Engine::new();
        let seeded = apply(
            &mut engine,
            json!([
                {"op": "create", "element": {
                    "id": "el-1", "type": "rectangle",
                    "x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0,
                    "rotation": 0, "strokeColor": "#000",
                    "backgroundColor": {"type": "solid", "color": "transparent"},
                    "strokeWidth": 2, "strokeStyle": "solid", "fillStyle": "solid",
                    "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
                    "isDeleted": false, "groupIds": [], "locked": false, "hidden": false,
                    "frameId": null,
                }},
                {"op": "setTool", "tool": "rectangle"},
            ]),
        );
        assert_eq!(seeded["applied"], 2, "seed applies: {seeded}");
        let undo_before = undo_len(&engine);

        let released = apply(
            &mut engine,
            json!([
                {"op": "commitDraw", "requestId": format!("draw-seeded-{attempt}"),
                 "shape": "rectangle",
                 "origin": {"x": 100.0, "y": 100.0},
                 "current": {"x": 250.0, "y": 220.0}},
                {"op": "sessionState"},
            ]),
        );
        assert_eq!(released["applied"], 2, "release applies: {released}");
        let commit = last_ok_data(&released, "commitDraw");
        let id = commit["id"].as_str().expect("created id").to_string();
        assert_ne!(id, "el-1", "minted id skips the occupied one");
        assert_eq!(engine.element_count(), 2, "first draw commits at once");
        assert_eq!(undo_len(&engine), undo_before + 1, "one history entry");
        assert_eq!(
            last_ok_data(&released, "sessionState")["selection"],
            json!([id])
        );
    }
}

#[test]
fn duplicate_release_commits_exactly_once() {
    // A transport retry or a duplicate release event reuses the press
    // request id: the second commit returns the stored id with no second
    // element and no second history entry.
    let mut engine = Engine::new();
    let undo_before = undo_len(&engine);
    let payload = json!({"op": "commitDraw", "requestId": "draw-dup", "shape": "rectangle",
         "origin": {"x": 0.0, "y": 0.0}, "current": {"x": 50.0, "y": 40.0}});
    let first = apply(&mut engine, json!([payload.clone()]));
    let second = apply(&mut engine, json!([payload]));
    let first_id = last_ok_data(&first, "commitDraw")["id"]
        .as_str()
        .expect("id")
        .to_string();
    assert_eq!(
        last_ok_data(&second, "commitDraw")["id"].as_str(),
        Some(first_id.as_str()),
        "duplicate returns the stored id"
    );
    assert_eq!(engine.element_count(), 1, "no duplicate object");
    assert_eq!(undo_len(&engine), undo_before + 1, "no duplicate history");

    // A new press mints a new id and always commits, even with the same box.
    let third = draw_commit(
        &mut engine,
        "draw-next",
        "rectangle",
        (0.0, 0.0),
        (50.0, 40.0),
    );
    let third_id = last_ok_data(&third, "commitDraw")["id"]
        .as_str()
        .expect("id")
        .to_string();
    assert_ne!(third_id, first_id);
    assert_eq!(engine.element_count(), 2);
}

#[test]
fn cancel_commits_nothing_and_never_kills_a_newer_gesture() {
    let mut engine = Engine::new();
    // Press, move, then a genuine cancellation: no object, idle phase.
    let cancelled = apply(
        &mut engine,
        json!([
            {"op": "setTool", "tool": "rectangle"},
            {"op": "pointerDown", "x": 10.0, "y": 10.0, "button": "left",
             "modifiers": {}, "clickCount": 1},
            {"op": "pointerMove", "x": 90.0, "y": 90.0, "modifiers": {}},
            {"op": "pointerCancel"},
            {"op": "sessionState"},
        ]),
    );
    assert_eq!(cancelled["applied"], 5, "cancel applies: {cancelled}");
    assert_eq!(engine.element_count(), 0, "cancel stores nothing");
    assert_eq!(
        last_ok_data(&cancelled, "sessionState")["pointerPhase"]["kind"],
        "idle"
    );

    // A stale duplicate cancel after a commit leaves the object alone.
    let id = last_ok_data(
        &draw_commit(
            &mut engine,
            "draw-after-cancel",
            "rectangle",
            (0.0, 0.0),
            (40.0, 30.0),
        ),
        "commitDraw",
    )["id"]
        .as_str()
        .expect("id")
        .to_string();
    assert_eq!(engine.element_count(), 1);
    let after = apply(
        &mut engine,
        json!([
            {"op": "pointerCancel"},
            {"op": "pointerMove", "x": 500.0, "y": 500.0, "modifiers": {}},
            {"op": "sessionState"},
        ]),
    );
    assert_eq!(
        engine.element_count(),
        1,
        "post-commit cancel/move is inert"
    );
    assert_eq!(
        last_ok_data(&after, "sessionState")["selection"],
        json!([id])
    );
    let found = exported_elements(&mut engine)
        .into_iter()
        .find(|el| el["id"] == id)
        .expect("object survives");
    assert_eq!(found["x"], 0.0);
    assert_eq!(found["width"], 40.0);
}

#[test]
fn mid_gesture_state_changes_do_not_break_the_commit() {
    // Selection, watcher polls, and even a tool switch land mid-gesture:
    // the explicit payload still commits exactly what was released.
    let mut engine = Engine::new();
    let flow = apply(
        &mut engine,
        json!([
            {"op": "setTool", "tool": "rectangle"},
            {"op": "pointerDown", "x": 5.0, "y": 5.0, "button": "left",
             "modifiers": {}, "clickCount": 1},
            {"op": "select", "ids": []},
            {"op": "sessionState"},
            {"op": "setTool", "tool": "select"},
            {"op": "commitDraw", "requestId": "draw-race", "shape": "rectangle",
             "origin": {"x": 5.0, "y": 5.0}, "current": {"x": 55.0, "y": 45.0}},
            {"op": "sessionState"},
        ]),
    );
    assert_eq!(flow["applied"], 7, "racing ops apply: {flow}");
    let commit = last_ok_data(&flow, "commitDraw");
    let id = commit["id"].as_str().expect("created id").to_string();
    assert_eq!(engine.element_count(), 1, "explicit payload wins the race");
    assert_eq!(
        last_ok_data(&flow, "sessionState")["selection"],
        json!([id]),
        "commit owns the selection"
    );
}

#[test]
fn all_box_tools_commit_release_geometry() {
    // Every box-derived tool stores the normalized release box; line and
    // arrow derive their two-point stroke from the same corners.
    let mut engine = Engine::new();
    for (i, shape) in ["rectangle", "ellipse", "line", "arrow", "frame", "image"]
        .iter()
        .enumerate()
    {
        let result = draw_commit(
            &mut engine,
            &format!("draw-tool-{i}"),
            shape,
            (20.0, 30.0),
            (60.0, 90.0),
        );
        let id = last_ok_data(&result, "commitDraw")["id"]
            .as_str()
            .expect("id")
            .to_string();
        let found = exported_elements(&mut engine)
            .into_iter()
            .find(|el| el["id"] == id)
            .expect("shape present");
        assert_eq!(found["type"], *shape, "stored kind follows the payload");
        assert_eq!(found["x"], 20.0);
        assert_eq!(found["y"], 30.0);
        assert_eq!(found["width"], 40.0);
        assert_eq!(found["height"], 60.0);
    }
    assert_eq!(engine.element_count(), 6);
    // Unknown shapes decline like the pointer path (no mutation, no error
    // storm for forward-compatible hosts).
    let unknown = draw_commit(
        &mut engine,
        "draw-unknown",
        "laser",
        (0.0, 0.0),
        (80.0, 80.0),
    );
    let data = last_ok_data(&unknown, "commitDraw");
    assert!(data["id"].is_null());
    assert_eq!(engine.element_count(), 6);
}

#[test]
fn freedraw_release_commits_the_host_trail() {
    let mut engine = Engine::new();
    let released = apply(
        &mut engine,
        json!([
            {"op": "commitDraw", "requestId": "draw-free-1", "shape": "freedraw",
             "origin": {"x": 10.0, "y": 10.0},
             "current": {"x": 50.0, "y": 10.0},
             "trail": [
                 {"x": 10.0, "y": 10.0},
                 {"x": 30.0, "y": 20.0},
                 {"x": 50.0, "y": 10.0},
             ]},
        ]),
    );
    let commit = last_ok_data(&released, "commitDraw");
    let id = commit["id"].as_str().expect("created id").to_string();
    let found = exported_elements(&mut engine)
        .into_iter()
        .find(|el| el["id"] == id)
        .expect("stroke present");
    assert_eq!(found["type"], "freedraw");
    assert_eq!(found["points"].as_array().expect("points").len(), 3);

    // A tap (single sample) commits nothing.
    let tap = apply(
        &mut engine,
        json!([
            {"op": "commitDraw", "requestId": "draw-free-2", "shape": "freedraw",
             "origin": {"x": 1.0, "y": 1.0},
             "current": {"x": 1.0, "y": 1.0},
             "trail": [{"x": 1.0, "y": 1.0}]},
        ]),
    );
    assert!(last_ok_data(&tap, "commitDraw")["id"].is_null());
    assert_eq!(engine.element_count(), 1);
}

#[test]
fn draw_commit_round_trips_through_undo_redo() {
    let mut engine = Engine::new();
    let id = last_ok_data(
        &draw_commit(
            &mut engine,
            "draw-undo",
            "rectangle",
            (0.0, 0.0),
            (30.0, 20.0),
        ),
        "commitDraw",
    )["id"]
        .as_str()
        .expect("id")
        .to_string();
    let undone = apply(&mut engine, json!([{"op": "undo"}]));
    assert_eq!(last_ok_data(&undone, "undo")["undone"], true);
    assert_eq!(engine.element_count(), 0, "undo removes the shape");
    let frame = apply(
        &mut engine,
        json!([{"op": "renderModel", "canvasWidth": 800.0, "canvasHeight": 600.0}]),
    );
    assert_eq!(
        last_ok_data(&frame, "renderModel")["base"]
            .as_array()
            .expect("base")
            .len(),
        0,
        "undone shape leaves the render model"
    );
    let redone = apply(&mut engine, json!([{"op": "redo"}]));
    assert_eq!(last_ok_data(&redone, "redo")["redone"], true);
    assert_eq!(engine.element_count(), 1, "redo restores the shape");
    assert!(
        exported_elements(&mut engine)
            .iter()
            .any(|el| el["id"] == id),
        "redo restores the same id"
    );
}
