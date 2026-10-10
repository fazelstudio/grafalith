//! Extension discovery: listing installed `.grlt` packages on disk.
//!
//! The TypeScript extension host owns activation; this module answers the
//! prior question — which packages exist — by scanning the user extension
//! directory for `.grlt` files (sorted, so installs converge deterministically).

use std::path::{Path, PathBuf};

/// File suffix for packaged Grafalith extensions.
pub const GRLT_SUFFIX: &str = ".grlt";

/// List installed `.grlt` package filenames in a directory (sorted).
#[must_use]
pub fn list_installed(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return names;
    };
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.ends_with(GRLT_SUFFIX) {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    names
}

/// Join a package filename onto the extension directory.
#[must_use]
pub fn package_path(dir: &Path, file_name: &str) -> PathBuf {
    dir.join(file_name)
}
