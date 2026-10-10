//! `grafalith-core`: document domain for the Grafalith Rust engine.
//!
//! This crate owns the persistent domain: elements, the document store
//! (id map + explicit z-order + version/nonce authority), history, layer /
//! group / lock / frame / style operations, alignment + distribution,
//! arrow binding, frame constraints, auto-layout, the instance-scoped shape
//! and component registries (including instance resolve + actions + cache),
//! clipboard payload semantics, asset storage, theme tokens, and the
//! canvas-mode config — plus the shared [`EngineError`] type.
//!
//! Hard boundaries: this crate depends only on `grafalith-geometry`
//! (re-exported as [`geometry`]), and never on an editor session,
//! renderer, DOM/Canvas, React, or Tauri — host adapters live outside this
//! crate. All fallible operations return [`EngineResult`]; `panic!` is
//! reserved for must-never-fail invariants and never crosses an FFI
//! boundary.
//!
//! Module map (flat files, grouped by responsibility): `element` and
//! `document` form the domain; `command` and `history` the history layer;
//! `editor`, `editor_state`, `selection`, `gesture`, `text_session`, and
//! `interaction` the session; group, lock, z-order, style, frame,
//! alignment, arrow binding, constraints, auto-layout, clipboard,
//! components, assets, path editing, and boolean ops the operations;
//! hit-testing, the render model, canvas mode, and theme the view; the
//! shape/extension/serializer modules the extension points.
//!
//! Design notes: read-only planning is pure (borrow `Document`, return
//! pending next states) while mutation goes through [`command::Command`] so
//! every intent is one undoable, atomic step (validate-then-store).
//! `Document` owns its query accelerator: a `SpatialGrid` synced on every
//! mutation (tombstones evicted), backing viewport culling (`RenderModel`)
//! and host hit-testing (`query_spatial`) with results identical to the
//! linear scan and z-order preserved. [`assets::AssetStore`] is synchronous
//! and owned: async/blob fetching is a host concern; core stores
//! bytes-or-URL atoms and bumps an explicit asset generation so render
//! models stay deterministic.
//!
//! TypeScript parity: `packages/core/src/*` is the behavior oracle. Each
//! module's docs name its TS source; intentional idiom deviations (single
//! `AlignMode` dispatch instead of six functions, `HashMap`-keyed instance
//! overrides with presence checks instead of falsy checks, sync asset atoms
//! instead of async Blobs) are documented where they occur.

/// Document-domain geometry, re-exported so consumers use one path.
///
/// Dependency direction: core → geometry, never the reverse.
pub use grafalith_geometry as geometry;

/// Crate name, exposed so workspace wiring can be asserted in tests.
pub const CRATE_NAME: &str = "grafalith-core";

/// Returns the crate name. See [`CRATE_NAME`].
pub fn crate_name() -> &'static str {
    CRATE_NAME
}

pub mod alignment;
pub mod arrow_binding;
pub mod assets;
pub mod auto_layout;
pub mod boolean;
pub mod canvas_mode;
pub mod clipboard;
pub mod command;
pub mod command_extension;
pub mod components;
pub mod constraints;
pub mod document;
pub mod editor;
pub mod editor_state;
pub mod element;
pub mod error;
pub mod extension;
pub mod frame;
pub mod gesture;
pub mod group;
pub mod history;
pub mod hit_test;
pub mod interaction;
pub mod lock;
pub mod path_boolean;
pub mod path_edit;
pub mod render_model;
pub mod selection;
pub mod serializer;
pub mod shape_extension;
pub mod shape_registry;
pub mod style;
pub mod text_session;
pub mod theme;
pub mod zorder;

/// Shared result alias. See [`error::EngineError`].
pub use error::{EngineError, EngineResult};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_identity_is_stable() {
        assert_eq!(crate_name(), "grafalith-core");
    }

    #[test]
    fn geometry_dependency_is_wired() {
        // Proves the module-02 dependency direction: core → geometry.
        assert_eq!(geometry::crate_name(), "grafalith-geometry");
    }
}
