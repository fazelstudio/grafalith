//! Per-extension persistent storage paths (mirrors the Tauri `extension-storage` dir).
//!
//! Storage is one JSON object per extension (`<id>.json`); the Tauri host
//! owns JSON parsing (it already carries a JSON stack) while this module
//! owns the layout — path plus key rules — so the SDK stays dependency-free
//! by contract (see the `workspace_wiring` test).

use std::path::{Path, PathBuf};

/// Storage filename for one extension (`<base>/<extension_id>.json`).
#[must_use]
pub fn storage_path(base: &Path, extension_id: &str) -> PathBuf {
    base.join(format!("{extension_id}.json"))
}

/// Whether a storage key is usable (non-empty, no path separators).
#[must_use]
pub fn valid_storage_key(key: &str) -> bool {
    !key.is_empty() && !key.contains(['/', '\\', '\0'])
}
