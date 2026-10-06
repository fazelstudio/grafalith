//! Shape registry (instance-scoped).
//!
//! TS source: `packages/core/src/shapes/registry.ts` (`ShapeDefinition` +
//! `ShapeRegistry` + `defaultShapeRegistry` singleton + `registerShape`;
//! built-ins self-register on import in `builtin-shapes.ts`).
//!
//! The registry owns both the *known type names* and the
//! [`ShapeExtension`] trait objects for plugin-registered custom shapes.
//! Built-ins plus reserved custom names register through the explicit
//! [`ShapeRegistry::register_builtin_shapes`] call; custom shapes register
//! through [`ShapeRegistry::register_extension`].
//!
//! Two deliberate breaks from TS, both required by instance scoping: no
//! process-global singleton (each instance owns its registry) and no import
//! side-effects (built-ins register through the explicit
//! [`ShapeRegistry::register_builtin_shapes`] call).

use std::collections::HashSet;

use crate::shape_extension::ShapeExtension;

/// Built-in element type names, in TS registration order
/// (`builtin-shapes.ts` plus the `image` shape definition).
///
/// `instance` is included even though TS never registers it (its absence
/// makes TS import reject instance elements — an upstream bug this port
/// does not preserve).
pub const BUILTIN_SHAPE_TYPES: &[&str] = &[
    "rectangle",
    "ellipse",
    "line",
    "arrow",
    "freedraw",
    "text",
    "frame",
    "image",
    "path",
    "instance",
];

/// Instance-scoped registry of known shape type names + custom extensions.
#[derive(Default)]
pub struct ShapeRegistry {
    /// Registered type names.
    known: HashSet<String>,
    /// Custom shape extensions by type name.
    extensions: std::collections::HashMap<String, Box<dyn ShapeExtension>>,
}

impl ShapeRegistry {
    /// Creates an empty registry. Call
    /// [`ShapeRegistry::register_builtin_shapes`] to enable the built-ins.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers the built-in shape types (explicit replacement for the TS
    /// import side-effect).
    pub fn register_builtin_shapes(&mut self) {
        for name in BUILTIN_SHAPE_TYPES {
            self.known.insert((*name).to_string());
        }
    }

    /// Registers a shape type name without an extension (name reservation
    /// only — render/hit-test/bounds fall back to raw box).
    pub fn register(&mut self, type_name: impl Into<String>) {
        self.known.insert(type_name.into());
    }

    /// Registers a custom shape extension. The extension's
    /// [`ShapeExtension::type_name`] must match `type_name`.
    ///
    /// Panics on mismatch — a plugin registering an extension under the
    /// wrong type name is a programming error, not a runtime condition.
    pub fn register_extension(
        &mut self,
        type_name: impl Into<String>,
        extension: Box<dyn ShapeExtension>,
    ) {
        let name = type_name.into();
        assert_eq!(
            extension.type_name(),
            name,
            "extension type_name must match the registration key"
        );
        self.known.insert(name.clone());
        self.extensions.insert(name, extension);
    }

    /// Returns `true` when the type name is registered.
    pub fn has(&self, type_name: &str) -> bool {
        self.known.contains(type_name)
    }

    /// Returns the extension registered for `type_name`, if any.
    pub fn extension(&self, type_name: &str) -> Option<&dyn ShapeExtension> {
        self.extensions.get(type_name).map(|b| b.as_ref())
    }

    /// Returns all registered type names.
    pub fn registered_types(&self) -> Vec<String> {
        self.known.iter().cloned().collect()
    }

    /// Number of registered types.
    pub fn len(&self) -> usize {
        self.known.len()
    }

    /// Returns `true` when no type is registered.
    pub fn is_empty(&self) -> bool {
        self.known.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape_extension::ShapeExtension;

    struct StubExt;

    impl ShapeExtension for StubExt {
        fn type_name(&self) -> &str {
            "stub"
        }
        fn render_desc(
            &self,
            _element: &crate::element::CustomElement,
        ) -> Option<crate::render_model::DrawEntry> {
            None
        }
        fn hit_test(
            &self,
            _element: &crate::element::CustomElement,
            _px: f64,
            _py: f64,
        ) -> Option<bool> {
            Some(true)
        }
        fn bounds(
            &self,
            _element: &crate::element::CustomElement,
        ) -> Option<crate::geometry::rect::Bounds> {
            None
        }
    }

    #[test]
    fn builtin_registration_is_explicit() {
        let mut registry = ShapeRegistry::new();
        assert!(registry.is_empty(), "no import side-effects");
        registry.register_builtin_shapes();
        for name in BUILTIN_SHAPE_TYPES {
            assert!(registry.has(name), "builtin '{name}' registered");
        }
        assert_eq!(registry.len(), BUILTIN_SHAPE_TYPES.len());
    }

    #[test]
    fn custom_names_reserve_without_globals() {
        let mut first = ShapeRegistry::new();
        first.register_builtin_shapes();
        let mut second = ShapeRegistry::new();
        second.register_builtin_shapes();
        first.register("star");
        assert!(first.has("star"));
        assert!(!second.has("star"), "registries are instance-scoped");
        second.register("star");
        second.register("star");
        assert!(second.has("star"));
    }

    #[test]
    fn extension_registration_and_dispatch() {
        let mut registry = ShapeRegistry::new();
        registry.register_builtin_shapes();
        assert!(!registry.has("stub"));
        registry.register_extension("stub", Box::new(StubExt));
        assert!(registry.has("stub"));
        let ext = registry.extension("stub").expect("extension registered");
        assert_eq!(ext.type_name(), "stub");
        assert!(registry.extension("star").is_none());
    }

    #[test]
    #[should_panic(expected = "extension type_name must match")]
    fn extension_type_mismatch_panics() {
        let mut registry = ShapeRegistry::new();
        registry.register_extension("wrong-name", Box::new(StubExt));
    }
}
