//! `fazelidraw-geometry`: pure 2D math for the Fazelidraw Rust engine.
//!
//! This crate owns **all reusable geometry** (module 06): vectors, points,
//! rectangles/bounds, transforms, rotation, viewport math, spatial hashing,
//! and snapping math. It has **zero dependencies** on the document model,
//! the editor, hosts (DOM/Canvas/React/Tauri), or serialization.
//!
//! Dependency direction (module 02): `fazelidraw-core` depends on this crate,
//! never the reverse.
//!
//! Phase 01 status: module boundaries only. Real math lands in Phase 04.
//! Each module's doc comment records its TypeScript source mapping.

/// Crate name, exposed so workspace wiring can be asserted in tests.
pub const CRATE_NAME: &str = "fazelidraw-geometry";

/// Returns the crate name. See [`CRATE_NAME`].
pub fn crate_name() -> &'static str {
    CRATE_NAME
}

pub mod point;
pub mod rect;
pub mod snap;
pub mod spatial;
pub mod transform;
pub mod viewport;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_identity_is_stable() {
        assert_eq!(crate_name(), "fazelidraw-geometry");
    }
}
