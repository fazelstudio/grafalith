//! `#[wasm_bindgen]` glue over [`opennary_bindings::Engine`].
//!
//! The glue is deliberately string-only: every method takes and returns
//! JSON strings (plus a few `bool`/`u32` scalars), so no Rust struct
//! layout ever becomes part of the npm API. Native (non-WASM) builds
//! compile this module too — `wasm-bindgen` expands to plain methods
//! there, which keeps `cargo test` honest without a WASM runner.
//!
//! Layout ops (`align`, `distribute`, `applyAutoLayout`) are supported
//! through the generic [`JsEngine::apply_batch`] path — there is no
//! dedicated crossing for them by design. Send e.g.
//! `{"op":"align","ids":[...],"mode":"left"}` inside the batch array;
//! per-op problems surface as `ok: false` entries, never as throws.
//!
//! This module is a full move of the `opennary-bindings` WASM glue: every
//! method, helper, and envelope semantic is preserved 1:1 so the npm
//! surface cannot drift from the tested boundary.

use wasm_bindgen::prelude::*;

use opennary_bindings::Engine;

/// Opaque engine handle for JavaScript.
///
/// Instances are independent (no shared globals): create one per
/// document view. All methods are synchronous; batch mutations through
/// [`apply_batch`](JsEngine::apply_batch) instead of looping single-op
/// crossings (one crossing per batch).
#[wasm_bindgen]
pub struct JsEngine {
    inner: Engine,
}

impl Default for JsEngine {
    /// Creates an empty engine (see [`JsEngine::new`]).
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl JsEngine {
    /// Creates an empty engine.
    #[wasm_bindgen(constructor)]
    pub fn new() -> JsEngine {
        JsEngine {
            inner: Engine::new(),
        }
    }

    /// Returns the bindings crate version string.
    pub fn version(&self) -> String {
        Engine::version().to_string()
    }

    /// Returns the engine status JSON string (render-loop dirty checks,
    /// toolbar undo/redo state).
    pub fn status(&self) -> String {
        self.inner.status_json()
    }

    /// Exports the document to its scene-JSON string, or an error
    /// envelope string on failure.
    pub fn export_scene(&self) -> String {
        into_wire(
            self.inner.export_scene(),
            opennary_bindings::protocol::engine_error_code,
        )
    }

    /// Replaces document content from a scene-JSON string. `tracked`
    /// records the replacement as one undo entry. Returns
    /// `{"imported","skipped"}` or an error envelope string.
    pub fn import_scene(&mut self, scene_json: &str, tracked: bool) -> String {
        match self.inner.import_scene(scene_json, tracked) {
            Ok(summary) => summary_json(summary.imported, summary.skipped),
            Err(err) => opennary_bindings::protocol::error_envelope(
                opennary_bindings::protocol::engine_error_code(&err),
                &err.to_string(),
            ),
        }
    }

    /// Replaces document content from an SVG string (`svg` feature).
    /// Returns `{"imported","skipped"}` or an error envelope string.
    #[cfg(feature = "svg")]
    pub fn import_svg(&mut self, svg: &str, tracked: bool) -> String {
        match self.inner.import_svg(svg, tracked) {
            Ok(summary) => summary_json(summary.imported, summary.skipped),
            Err(err) => opennary_bindings::protocol::error_envelope(
                opennary_bindings::protocol::engine_error_code(&err),
                &err.to_string(),
            ),
        }
    }

    /// Executes a JSON array of ops in one crossing and returns the
    /// batch-result JSON string (never throws for domain failures —
    /// per-op problems are `ok: false` entries).
    ///
    /// Covers the full protocol, including `align`, `distribute`, and
    /// `applyAutoLayout` (e.g. `{"op":"align","ids":["a","b"],
    /// "mode":"left"}`, `{"op":"distribute","ids":[...],
    /// "axis":"horizontal"}`, `{"op":"applyAutoLayout",
    /// "frameId":"f1"}`). Unknown `op` strings fail the whole batch
    /// parse as an error envelope so hosts notice version skew.
    pub fn apply_batch(&mut self, batch_json: &str) -> String {
        self.inner.apply_batch(batch_json)
    }

    /// Undoes one history entry (`true` = something was undone).
    pub fn undo(&mut self) -> bool {
        self.inner.undo().unwrap_or(false)
    }

    /// Redoes one history entry (`true` = something was redone).
    pub fn redo(&mut self) -> bool {
        self.inner.redo().unwrap_or(false)
    }

    /// Whether `undo` would do anything.
    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }

    /// Whether `redo` would do anything.
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }

    /// Live (non-deleted) element count.
    pub fn element_count(&self) -> u32 {
        self.inner.element_count().min(u32::MAX as usize) as u32
    }

    /// Encodes the clipboard buffer to the versioned payload string for
    /// host system-clipboard writes (or an error envelope string).
    pub fn encode_clipboard(&self) -> String {
        into_wire(
            self.inner.encode_clipboard(),
            opennary_bindings::protocol::engine_error_code,
        )
    }

    /// Decodes a clipboard payload string to
    /// `{"count","skipped","ids"}` without touching engine state (or an
    /// error envelope string).
    pub fn decode_clipboard(payload: &str) -> String {
        into_wire_value(
            Engine::decode_clipboard(payload),
            opennary_bindings::protocol::engine_error_code,
        )
    }

    /// Plans PNG export from JSON options, returning the plan JSON string
    /// (or an error envelope string). Pure math — the host allocates the
    /// canvas and rasterizes.
    pub fn plan_png_export(&self, options_json: &str) -> String {
        into_wire_value(
            self.inner.plan_png_export(options_json),
            opennary_bindings::protocol::engine_error_code,
        )
    }

    /// Plans JPEG export from JSON options, returning the plan JSON string
    /// (or an error envelope string). No alpha channel: `"transparent"`
    /// resolves to white in the plan.
    pub fn plan_jpeg_export(&self, options_json: &str) -> String {
        into_wire_value(
            self.inner.plan_jpeg_export(options_json),
            opennary_bindings::protocol::engine_error_code,
        )
    }

    /// Plans WebP export from JSON options, returning the plan JSON string
    /// (or an error envelope string). Pure math — the host encodes.
    pub fn plan_webp_export(&self, options_json: &str) -> String {
        into_wire_value(
            self.inner.plan_webp_export(options_json),
            opennary_bindings::protocol::engine_error_code,
        )
    }
}

/// Returns the protocol version for JS-side skew checks before the
/// first real call (mirrors the protocol version constant).
#[wasm_bindgen]
pub fn bindings_protocol_version() -> u32 {
    opennary_bindings::protocol::PROTOCOL_VERSION
}

/// Maps `Ok(string)` through and converts engine errors to envelope
/// strings, so domain failures never surface as JS exceptions.
///
/// Generic over the error type so this crate does not need a direct
/// `opennary-core` dependency: the caller passes
/// `opennary_bindings::protocol::engine_error_code` as the code mapper and
/// type inference supplies the concrete engine error.
fn into_wire<E>(result: Result<String, E>, code_of: fn(&E) -> &'static str) -> String
where
    E: std::fmt::Display,
{
    match result {
        Ok(payload) => payload,
        Err(err) => opennary_bindings::protocol::error_envelope(code_of(&err), &err.to_string()),
    }
}

/// Maps `Ok(json)` through and converts engine errors to envelope
/// strings.
///
/// See [`into_wire`] for why the error type stays generic.
fn into_wire_value<E>(
    result: Result<serde_json::Value, E>,
    code_of: fn(&E) -> &'static str,
) -> String
where
    E: std::fmt::Display,
{
    match result {
        Ok(value) => value.to_string(),
        Err(err) => opennary_bindings::protocol::error_envelope(code_of(&err), &err.to_string()),
    }
}

/// Builds the import-summary payload shared by the native and WASM paths.
fn summary_json(imported: usize, skipped: usize) -> String {
    serde_json::json!({ "imported": imported, "skipped": skipped }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn new_engine_starts_empty() {
        let engine = JsEngine::new();
        assert_eq!(engine.element_count(), 0);
        assert!(!engine.can_undo());
        assert!(!engine.can_redo());
        let status: Value = serde_json::from_str(&engine.status()).expect("status is JSON");
        assert_eq!(status["elementCount"], 0);
        assert_eq!(status["tool"], "select");
        assert_eq!(bindings_protocol_version(), 1);
    }

    #[test]
    fn apply_batch_create_reports_status_count() {
        let mut engine = JsEngine::new();
        let batch = json!([{"op": "create", "element": rect("a", 10.0, 20.0)}]).to_string();
        let out = engine.apply_batch(&batch);
        let result: Value = serde_json::from_str(&out).expect("batch result is JSON");
        assert_eq!(result["applied"], 1);
        assert_eq!(result["results"][0]["ok"], true);
        assert_eq!(engine.element_count(), 1);

        let status: Value = serde_json::from_str(&engine.status()).expect("status is JSON");
        assert_eq!(status["elementCount"], 1);

        // Undo through the string-only glue restores the empty document.
        assert!(engine.undo());
        assert_eq!(engine.element_count(), 0);
        assert!(engine.can_redo());
        assert!(engine.redo());
        assert_eq!(engine.element_count(), 1);
    }

    #[test]
    fn align_op_flows_through_generic_batch() {
        let mut engine = JsEngine::new();
        let seed = json!([
            {"op": "create", "element": rect("a", 0.0, 0.0)},
            {"op": "create", "element": rect("b", 250.0, 30.0)},
        ])
        .to_string();
        let seeded: Value = serde_json::from_str(&engine.apply_batch(&seed)).expect("seed result");
        assert_eq!(seeded["applied"], 2);

        let aligned = json!([
            {"op": "align", "ids": ["a", "b"], "mode": "left"},
        ])
        .to_string();
        let out: Value = serde_json::from_str(&engine.apply_batch(&aligned)).expect("align result");
        assert_eq!(out["results"][0]["ok"], true, "align: {out}");
        assert_eq!(engine.element_count(), 2);
    }

    #[test]
    fn version_and_envelopes_stay_string_only() {
        let engine = JsEngine::new();
        assert_eq!(engine.version(), "0.1.0");
        let bad = engine.plan_png_export("not json");
        let envelope: Value = serde_json::from_str(&bad).expect("envelope is JSON");
        assert_eq!(envelope["ok"], false);
        let decoded = JsEngine::decode_clipboard("definitely not a payload");
        let decoded_value: Value = serde_json::from_str(&decoded).expect("decode envelope is JSON");
        assert_eq!(decoded_value["ok"], false);
    }
}
