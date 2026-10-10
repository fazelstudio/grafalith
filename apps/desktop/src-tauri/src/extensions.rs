//! Extension discovery and storage for the Tauri host.
//!
//! The TypeScript extension host owns activation; this module owns the
//! native side only: where `.grlt` packages live on disk, manifest rule
//! checks (via `grafalith-sdk`, which stays dependency-free), and where
//! per-extension persistent storage lives. No engine logic here.

use std::path::PathBuf;

/// Resolve the user extension directory (`<app_data>/extensions`).
pub fn extensions_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("extensions"))
        .map_err(|e| e.to_string())
}

/// Resolve the storage file for one extension (`<app_data>/extension-storage/<id>.json`).
fn storage_path(app: &tauri::AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| {
            dir.join("extension-storage")
                .join(format!("{extension_id}.json"))
        })
        .map_err(|e| e.to_string())
}

/// List installed `.grlt` package filenames (discovery input for the TS host).
pub fn list_installed(base: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let Ok(entries) = std::fs::read_dir(base) else {
        return names;
    };
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(".grlt") {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    names
}

/// Read one storage key for an extension (missing file/key yields null JSON).
pub fn storage_get(base: &std::path::Path, key: &str) -> String {
    let Ok(raw) = std::fs::read_to_string(base) else {
        return "null".to_string();
    };
    let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&raw) else {
        return "null".to_string();
    };
    map.get(key)
        .map(|v| v.to_string())
        .unwrap_or_else(|| "null".to_string())
}

/// Write one storage key for an extension (creates parents as needed).
pub fn storage_set(base: &std::path::Path, key: &str, value_json: &str) -> Result<(), String> {
    if let Some(parent) = base.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut map: serde_json::Map<String, serde_json::Value> = std::fs::read_to_string(base)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(value_json).map_err(|e| e.to_string())?;
    map.insert(key.to_string(), value);
    std::fs::write(base, serde_json::Value::Object(map).to_string()).map_err(|e| e.to_string())
}

pub fn storage_path_for(app: &tauri::AppHandle, extension_id: &str) -> Result<PathBuf, String> {
    storage_path(app, extension_id)
}

/// Validate one `grafalith.extension.json` payload against the SDK rules.
///
/// The host parses here (it carries a JSON stack); the rules live in
/// `grafalith-sdk` so native and TypeScript validation stay in lockstep.
/// Returns the problem list (empty means the manifest is installable).
pub fn validate_manifest_json(raw: &str) -> Vec<String> {
    use grafalith_sdk::manifest::{validate_manifest, ManifestInput, GRLT_FORMAT_VERSION};

    let parsed: serde_json::Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => return vec!["manifest must be a JSON object".to_string()],
    };
    let get_str = |key: &str| {
        parsed
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
    };
    let engines_grafalith = parsed
        .get("engines")
        .and_then(|engines| engines.get("grafalith"))
        .and_then(serde_json::Value::as_str);
    let collect_strs = |key: &str| -> Vec<&str> {
        parsed
            .get(key)
            .and_then(serde_json::Value::as_array)
            .map(|items| items.iter().filter_map(serde_json::Value::as_str).collect())
            .unwrap_or_default()
    };
    let activation_events = collect_strs("activationEvents");
    let permissions = collect_strs("permissions");
    let format_version = parsed
        .get("formatVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(u64::from(GRLT_FORMAT_VERSION + 1)) as u32;
    validate_manifest(&ManifestInput {
        format_version,
        id: get_str("id"),
        publisher: get_str("publisher"),
        name: get_str("name"),
        version: get_str("version"),
        engines_grafalith,
        activation_events: &activation_events,
        permissions: &permissions,
    })
}
