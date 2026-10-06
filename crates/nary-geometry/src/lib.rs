//! `nary-geometry`: pure 2D math for the Nary Rust engine.
//!
//! This crate owns **all reusable geometry**: vectors, points,
//! rectangles/bounds, segment distances, rotation, transforms, resize,
//! handles, path flattening, hit-test primitives, viewport math, spatial
//! hashing, and snapping math. It has **zero dependencies** on the document
//! model, the editor, hosts (DOM/Canvas/React/Tauri), or serialization.
//!
//! Dependency direction: `nary-core` depends on this crate, never the
//! reverse.
//!
//! ## Coordinate spaces
//!
//! Every operation declares its space where ambiguity is possible:
//!
//! ```text
//! screen space          pixels, canvas origin (input events, handle radii)
//! world/document space  scene units (elements, bounds, snap guides)
//! local element space   unrotated element frame (hit tests, resize)
//! ```
//!
//! Values from different spaces are never compared without explicit
//! conversion ([`transform::screen_to_world_tolerance`],
//! [`viewport::screen_to_scene`], [`rotation::to_local_space`]).

/// Crate name, exposed so workspace wiring can be asserted in tests.
pub const CRATE_NAME: &str = "nary-geometry";

/// Returns the crate name. See [`CRATE_NAME`].
pub fn crate_name() -> &'static str {
    CRATE_NAME
}

pub mod boolean;
pub mod hit;
pub mod path;
pub mod point;
pub mod rect;
pub mod rotation;
pub mod segment;
pub mod snap;
pub mod spatial;
pub mod transform;
pub mod viewport;

/// Document-domain point primitives, re-exported at the crate root.
pub use point::{approx_eq, point_is_finite, points_are_finite, Point};
/// Document-domain bounds primitives, re-exported at the crate root.
pub use rect::{rotated_bounds, Bounds};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_identity_is_stable() {
        assert_eq!(crate_name(), "nary-geometry");
    }
}
