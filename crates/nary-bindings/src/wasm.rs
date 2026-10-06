//! `#[wasm_bindgen]` glue over [`Engine`](crate::Engine).
//!
//! The glue is deliberately string-only: every method takes and returns
//! JSON strings (plus a few `bool`/`u32` scalars), so no Rust struct
//! layout ever becomes part of the npm API. Native (non-WASM) builds
//! compile this module too — `wasm-bindgen` expands to plain methods
//! there, which keeps `cargo test` honest without a WASM runner.

use wasm_bindgen::prelude::*;

use crate::Engine;

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
        into_wire(self.inner.export_scene())
    }

    /// Replaces document content from a scene-JSON string. `tracked`
    /// records the replacement as one undo entry. Returns
    /// `{"imported","skipped"}` or an error envelope string.
    pub fn import_scene(&mut self, scene_json: &str, tracked: bool) -> String {
        match self.inner.import_scene(scene_json, tracked) {
            Ok(summary) => summary_json(summary.imported, summary.skipped),
            Err(err) => crate::protocol::error_envelope(
                crate::protocol::engine_error_code(&err),
                &err.to_string(),
            ),
        }
    }

    /// Executes a JSON array of ops in one crossing and returns the
    /// batch-result JSON string (never throws for domain failures —
    /// per-op problems are `ok: false` entries).
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
        into_wire(self.inner.encode_clipboard())
    }

    /// Decodes a clipboard payload string to
    /// `{"count","skipped","ids"}` without touching engine state (or an
    /// error envelope string).
    pub fn decode_clipboard(payload: &str) -> String {
        into_wire_value(Engine::decode_clipboard(payload))
    }

    /// Plans PNG export from JSON options, returning the plan JSON string
    /// (or an error envelope string). Pure math — the host allocates the
    /// canvas and rasterizes.
    pub fn plan_png_export(&self, options_json: &str) -> String {
        into_wire_value(self.inner.plan_png_export(options_json))
    }
}

/// Returns the protocol version for JS-side skew checks before the
/// first real call (mirrors the protocol version constant).
#[wasm_bindgen]
pub fn bindings_protocol_version() -> u32 {
    crate::protocol::PROTOCOL_VERSION
}

/// Maps `Ok(string)` through and converts engine errors to envelope
/// strings, so domain failures never surface as JS exceptions.
fn into_wire(result: Result<String, nary_core::EngineError>) -> String {
    match result {
        Ok(payload) => payload,
        Err(err) => crate::protocol::error_envelope(
            crate::protocol::engine_error_code(&err),
            &err.to_string(),
        ),
    }
}

/// Maps `Ok(json)` through and converts engine errors to envelope
/// strings.
fn into_wire_value(result: Result<serde_json::Value, nary_core::EngineError>) -> String {
    match result {
        Ok(value) => value.to_string(),
        Err(err) => crate::protocol::error_envelope(
            crate::protocol::engine_error_code(&err),
            &err.to_string(),
        ),
    }
}

/// Builds the import-summary payload shared by the native and WASM paths.
fn summary_json(imported: usize, skipped: usize) -> String {
    serde_json::json!({ "imported": imported, "skipped": skipped }).to_string()
}
