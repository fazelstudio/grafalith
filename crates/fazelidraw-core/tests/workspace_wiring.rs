//! Phase 01 workspace wiring test: proves the module-02 dependency
//! direction (bindings → editor → domain → geometry) starts correctly:
//! `fazelidraw-core` depends on `fazelidraw-geometry`, never the reverse,
//! and both crates expose a stable identity.

use fazelidraw_core::{geometry, EngineError};

#[test]
fn core_and_geometry_identities_are_stable() {
    assert_eq!(fazelidraw_core::crate_name(), "fazelidraw-core");
    assert_eq!(geometry::crate_name(), "fazelidraw-geometry");
}

#[test]
fn core_error_type_is_usable_from_outside() {
    let err = EngineError::NotFound("missing-id".to_string());
    assert_eq!(err.to_string(), "not found: missing-id");
}
