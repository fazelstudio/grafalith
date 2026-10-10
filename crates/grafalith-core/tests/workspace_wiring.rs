//! Workspace wiring test: proves the dependency direction
//! (bindings → editor → domain → geometry) starts correctly:
//! `grafalith-core` depends on `grafalith-geometry`, never the reverse,
//! and both crates expose a stable identity.
//!
//! The full inter-crate DAG is asserted from the manifests
//! themselves (no `cargo tree` needed), so a layering violation fails the
//! suite. Only `[dependencies]` is checked - dev harnesses (criterion,
//! proptest) may use anything. Host crates (`apps/*`) are outside the
//! engine DAG by design.

use grafalith_core::{geometry, EngineError};
use std::collections::HashMap;
use std::path::PathBuf;

#[test]
fn core_and_geometry_identities_are_stable() {
    assert_eq!(grafalith_core::crate_name(), "grafalith-core");
    assert_eq!(geometry::crate_name(), "grafalith-geometry");
}

#[test]
fn core_error_type_is_usable_from_outside() {
    let err = EngineError::NotFound("missing-id".to_string());
    assert_eq!(err.to_string(), "not found: missing-id");
}

/// Allowed `path = "../…"` edges per crate directory under `crates/`.
fn allowed_edges() -> HashMap<&'static str, Vec<&'static str>> {
    HashMap::from([
        ("grafalith", vec!["grafalith-bindings"]),
        ("grafalith-python", vec!["grafalith-bindings"]),
        ("grafalith-bindings", vec!["grafalith-core", "grafalith-io"]),
        ("grafalith-io", vec!["grafalith-core"]),
        ("grafalith-core", vec!["grafalith-geometry"]),
        ("grafalith-geometry", vec![]),
        ("grafalith-sdk", vec!["grafalith-core"]),
        ("grafalith-text", vec!["grafalith-core"]),
    ])
}

/// Reads one manifest's `[dependencies]` path edges (`dir` per edge).
fn manifest_path_edges(crates_dir: &std::path::Path, dir: &str) -> Vec<String> {
    let text = std::fs::read_to_string(crates_dir.join(dir).join("Cargo.toml"))
        .expect("crate manifest reads");
    let mut edges = Vec::new();
    let mut in_dependencies = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_dependencies = line == "[dependencies]";
            continue;
        }
        if !in_dependencies || line.is_empty() || line.starts_with('#') {
            continue;
        }
        // `name = { version = "…", path = "../target" }` (path may come
        // before or after other keys on the same line).
        if let Some(path_start) = line.find("path = ") {
            let rest = &line[path_start + "path = ".len()..];
            let quote = rest.chars().next().expect("path value quoted");
            let end = rest[1..].find(quote).expect("path value closed") + 1;
            let path = &rest[1..end];
            let target = path.rsplit('/').next().expect("path has a leaf");
            edges.push(target.to_string());
        }
    }
    edges.sort();
    edges
}

#[test]
fn inter_crate_dependency_direction_matches_the_layered_design() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let crates_dir = manifest_dir
        .ancestors()
        .nth(2)
        .expect("workspace root above crates/<member>")
        .join("crates");
    for (dir, mut expected) in allowed_edges() {
        expected.sort();
        assert_eq!(
            manifest_path_edges(&crates_dir, dir),
            expected,
            "path-dependency edges of crates/{dir}"
        );
    }
}

/// External crates allowed per layer (host bindings stay out of the core).
fn allowed_external() -> HashMap<&'static str, Vec<&'static str>> {
    HashMap::from([
        ("grafalith", vec!["serde_json", "wasm-bindgen"]),
        ("grafalith-python", vec!["pyo3", "serde_json"]),
        (
            "grafalith-bindings",
            vec!["serde", "serde_json", "wasm-bindgen"],
        ),
        ("grafalith-io", vec!["serde", "serde_json", "usvg"]),
        ("grafalith-core", vec!["i_overlay"]),
        ("grafalith-geometry", vec![]),
        ("grafalith-sdk", vec![]),
        ("grafalith-text", vec!["parley"]),
    ])
}

/// Reads one manifest's `[dependencies]` non-path crate names.
fn manifest_external_deps(crates_dir: &std::path::Path, dir: &str) -> Vec<String> {
    let text = std::fs::read_to_string(crates_dir.join(dir).join("Cargo.toml"))
        .expect("crate manifest reads");
    let mut deps = Vec::new();
    let mut in_dependencies = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_dependencies = line == "[dependencies]";
            continue;
        }
        if !in_dependencies || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let name = line.split(['=', ' ']).next().expect("dep line has a name");
        if line.contains("path = ") {
            continue;
        }
        deps.push(name.to_string());
    }
    deps.sort();
    deps
}

#[test]
fn engine_layers_carry_no_host_or_render_dependencies() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let crates_dir = manifest_dir
        .ancestors()
        .nth(2)
        .expect("workspace root above crates/<member>")
        .join("crates");
    for (dir, mut expected) in allowed_external() {
        expected.sort();
        assert_eq!(
            manifest_external_deps(&crates_dir, dir),
            expected,
            "external [dependencies] of crates/{dir}"
        );
    }
}
