//! `fazelidraw-core`: document domain for the Fazelidraw Rust engine.
//!
//! This crate owns the persistent domain: elements, the document store
//! (id map + explicit z-order + version/nonce authority), history, layer /
//! group / lock / frame / style operations, the instance-scoped shape and
//! component registries, clipboard payload semantics, theme tokens, and the
//! canvas-mode config — plus the shared [`EngineError`] type.
//!
//! Hard boundaries (modules 01, 02):
//!
//! - Depends only on `fazelidraw-geometry` (re-exported as [`geometry`]).
//! - Never depends on an editor session, renderer, DOM/Canvas, React, or
//!   Tauri. Host adapters live outside this crate.
//! - All fallible operations return [`EngineResult`]; `panic!` is reserved
//!   for must-never-fail invariants and never crosses an FFI boundary
//!   (see `docs/architecture/ADR-0004-error-handling.md`).
//!
//! Phase 01 status: boundaries + error type only. Domain logic lands in
//! Phases 02–06. Each module's doc comment records its TypeScript source
//! mapping; the full inventory is the discovery report
//! (`docs/reports/29-09-2026/RUST-REWRITE-DISCOVERY.md`, §B).

/// Document-domain geometry, re-exported so consumers use one path.
///
/// Dependency direction (module 02): core → geometry, never the reverse.
pub use fazelidraw_geometry as geometry;

/// Crate name, exposed so workspace wiring can be asserted in tests.
pub const CRATE_NAME: &str = "fazelidraw-core";

/// Returns the crate name. See [`CRATE_NAME`].
pub fn crate_name() -> &'static str {
    CRATE_NAME
}

pub mod alignment;
pub mod arrow_binding;
pub mod auto_layout;
pub mod canvas_mode;
pub mod clipboard;
pub mod components;
pub mod constraints;
pub mod document;
pub mod element;
pub mod error;
pub mod frame;
pub mod group;
pub mod history;
pub mod lock;
pub mod shape_registry;
pub mod style;
pub mod theme;
pub mod zorder;

/// Shared result alias. See [`error::EngineError`].
pub use error::{EngineError, EngineResult};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_identity_is_stable() {
        assert_eq!(crate_name(), "fazelidraw-core");
    }

    #[test]
    fn geometry_dependency_is_wired() {
        // Proves the module-02 dependency direction: core → geometry.
        assert_eq!(geometry::crate_name(), "fazelidraw-geometry");
    }
}
