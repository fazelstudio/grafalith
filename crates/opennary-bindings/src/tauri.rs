//! Tauri IPC boundary.
//!
//! This module defines the Tauri-native integration surface. Tauri
//! consumes the Rust engine directly, so the IPC model is a thin wrapper
//! over the same [`Engine`] that WASM hosts use.
//!
//! Design rules: Tauri IPC and JS/WASM are separate host boundaries that
//! share domain semantics without sharing exact transport representation;
//! Tauri commands carry JSON strings (the same protocol as WASM) — no
//! enormous scene snapshots for pointer moves; this module is the only
//! place that knows about Tauri's command/event model, so the engine stays
//! host-agnostic; domain semantics are identical across native and WASM,
//! with differences only in rendering backend, filesystem, OS clipboard,
//! asset loading, threading, and host integration.

use crate::Engine;

/// Tauri command result: a JSON string (same protocol as WASM).
pub type TauriCommandResult = String;

/// Creates a Tauri-compatible engine handle.
///
/// The returned [`Engine`] is the same instance-scoped handle WASM
/// hosts use. Tauri commands wrap it with `tauri::command` macros
/// in the application layer (not in this crate — the application
/// layer owns the Tauri dependency).
pub fn create_engine() -> Engine {
    Engine::new()
}

/// Executes a batch op array through the engine (Tauri command body).
///
/// This is the same [`Engine::apply_batch`] that WASM hosts call,
/// wrapped so the Tauri application layer can expose it as a command:
///
/// ```ignore
/// #[tauri::command]
/// async fn apply_batch(engine: tauri::State<'_, Engine>, batch: String) -> String {
///     tauri_apply_batch(&engine, &batch)
/// }
/// ```
pub fn tauri_apply_batch(engine: &mut Engine, batch_json: &str) -> TauriCommandResult {
    engine.apply_batch(batch_json)
}

/// Returns the engine status JSON (Tauri command body).
pub fn tauri_status(engine: &Engine) -> TauriCommandResult {
    engine.status_json()
}

/// Exports the document to scene JSON (Tauri command body).
pub fn tauri_export_scene(engine: &Engine) -> TauriCommandResult {
    match engine.export_scene() {
        Ok(json) => json,
        Err(err) => crate::protocol::error_envelope(
            crate::protocol::engine_error_code(&err),
            &err.to_string(),
        ),
    }
}

/// Imports a scene from JSON (Tauri command body).
pub fn tauri_import_scene(
    engine: &mut Engine,
    scene_json: &str,
    tracked: bool,
) -> TauriCommandResult {
    match engine.import_scene(scene_json, tracked) {
        Ok(summary) => serde_json::json!({
            "imported": summary.imported,
            "skipped": summary.skipped,
        })
        .to_string(),
        Err(err) => crate::protocol::error_envelope(
            crate::protocol::engine_error_code(&err),
            &err.to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tauri_engine_creation() {
        let engine = create_engine();
        let status: serde_json::Value = serde_json::from_str(&tauri_status(&engine)).unwrap();
        assert_eq!(status["tool"], "select");
        assert_eq!(status["elementCount"], 0);
    }

    #[test]
    fn tauri_batch_roundtrip() {
        let mut engine = create_engine();
        let batch = r##"[{"op":"create","element":{"type":"rectangle","id":"r1","x":0,"y":0,"width":100,"height":100,"rotation":0,"strokeColor":"#000","backgroundColor":{"type":"solid","color":"transparent"},"strokeWidth":2,"strokeStyle":"solid","fillStyle":"solid","opacity":100,"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"groupIds":[],"locked":false,"hidden":false}}]"##;
        let result = tauri_apply_batch(&mut engine, batch);
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["applied"], 1);
        assert_eq!(parsed["results"][0]["ok"], true);
    }

    #[test]
    fn tauri_export_import_roundtrip() {
        let mut engine = create_engine();
        let batch = r##"[{"op":"create","element":{"type":"rectangle","id":"r1","x":0,"y":0,"width":100,"height":100,"rotation":0,"strokeColor":"#000","backgroundColor":{"type":"solid","color":"transparent"},"strokeWidth":2,"strokeStyle":"solid","fillStyle":"solid","opacity":100,"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"groupIds":[],"locked":false,"hidden":false}}]"##;
        tauri_apply_batch(&mut engine, batch);
        let exported = tauri_export_scene(&engine);
        assert!(exported.contains("rectangle"));
        let mut engine2 = create_engine();
        let import_result = tauri_import_scene(&mut engine2, &exported, false);
        let parsed: serde_json::Value = serde_json::from_str(&import_result).unwrap();
        assert_eq!(parsed["imported"], 1);
    }
}
