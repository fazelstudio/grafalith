//! Extension infrastructure: the public extension API.
//!
//! This module defines the [`Extension`] trait, the [`ExtensionContext`]
//! registration surface, and the [`ExtensionRegistry`] that owns extension
//! lifecycle. It is the *only* way extensions interact with core
//! internals — no mutable core state is exposed.
//!
//! Design rules: each [`ExtensionRegistry`] is owned by one engine instance
//! (no globals); lifecycle is explicit (register, activate, use,
//! deactivate, dispose) with predictable ordering; extensions interact through
//! documented capability interfaces ([`ExtensionContext`],
//! [`ShapeExtension`], [`CommandExtension`], [`SerializerExtension`]) and
//! never through mutable core internals; [`ExtensionMetadata`] carries a
//! compatibility range the registry checks before activation; all contracts
//! are serializable/handle-based so no Rust trait objects cross the WASM
//! boundary directly.

use crate::shape_extension::ShapeExtension;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/// Protocol version this extension system targets.
pub const EXTENSION_PROTOCOL_VERSION: u32 = 1;

/// Extension metadata: identity + compatibility contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtensionMetadata {
    /// Unique extension identifier (e.g. `"com.example.star-shapes"`).
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Semantic version string.
    pub version: String,
    /// Minimum compatible [`EXTENSION_PROTOCOL_VERSION`] (inclusive).
    pub min_protocol_version: u32,
    /// Maximum compatible [`EXTENSION_PROTOCOL_VERSION`] (inclusive).
    pub max_protocol_version: u32,
}

impl ExtensionMetadata {
    /// Creates metadata with the given id/name/version and a compatibility
    /// range of exactly [`EXTENSION_PROTOCOL_VERSION`].
    pub fn new(id: impl Into<String>, name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            version: version.into(),
            min_protocol_version: EXTENSION_PROTOCOL_VERSION,
            max_protocol_version: EXTENSION_PROTOCOL_VERSION,
        }
    }

    /// Returns `true` when this metadata is compatible with the given
    /// protocol version.
    pub fn is_compatible_with(&self, protocol_version: u32) -> bool {
        protocol_version >= self.min_protocol_version
            && protocol_version <= self.max_protocol_version
    }
}

// ---------------------------------------------------------------------------
// Extension trait
// ---------------------------------------------------------------------------

/// The extension contract: metadata, registration, and lifecycle.
///
/// Extensions are registered through [`Extension::register`], which receives
/// a [`ExtensionContext`] for declaring capabilities. The lifecycle is:
///
/// ```text
/// register → activate → use → deactivate → dispose
/// ```
///
/// All lifecycle methods except [`Extension::register`] have default
/// no-op implementations so extensions only override what they need.
pub trait Extension: Send + Sync {
    /// Returns the extension's metadata (id, name, version, compatibility).
    fn metadata(&self) -> &ExtensionMetadata;

    /// Registration phase: declare capabilities through `ctx`.
    ///
    /// This is the only phase where extensions can register tools, shapes,
    /// commands, serializers, and event handlers. After registration
    /// the extension is activated.
    fn register(&mut self, ctx: &mut ExtensionContext);

    /// Activation phase: the extension is now live and its capabilities
    /// are available to the engine.
    fn activate(&mut self) {}

    /// Deactivation phase: the extension's capabilities are being removed.
    /// The extension should release any resources it acquired during
    /// activation.
    fn deactivate(&mut self) {}

    /// Disposal phase: the extension is being permanently removed. All
    /// resources must be released.
    fn dispose(&mut self) {}
}

// ---------------------------------------------------------------------------
// Extension context (registration surface)
// ---------------------------------------------------------------------------

/// The registration surface handed to [`Extension::register`].
///
/// This is the *only* way extensions declare capabilities. It provides
/// methods for registering tools, shapes, commands, serializers,
/// importers, exporters, and event handlers.
///
/// The context is borrowed mutably during registration and cannot
/// be retained by the extension — after [`Extension::register`] returns,
/// the context is no longer valid.
pub struct ExtensionContext<'a> {
    pub(crate) tools: &'a mut Vec<String>,
    pub(crate) shapes: &'a mut Vec<(String, Box<dyn ShapeExtension>)>,
    pub(crate) commands: &'a mut Vec<Box<dyn crate::command_extension::CommandExtension>>,
    pub(crate) serializers: &'a mut Vec<Box<dyn crate::serializer::SerializerExtension>>,
    pub(crate) importers: &'a mut Vec<Box<dyn crate::serializer::ImporterExtension>>,
    pub(crate) exporters: &'a mut Vec<Box<dyn crate::serializer::ExporterExtension>>,
}

impl<'a> ExtensionContext<'a> {
    /// Registers a custom tool by id.
    ///
    /// The tool id is added to the instance-scoped tool registry.
    /// Custom tools are host-owned: the core captures pointer presses
    /// for them but does not drive draw/behavior.
    pub fn register_tool(&mut self, tool_id: impl Into<String>) {
        self.tools.push(tool_id.into());
    }

    /// Registers a custom shape extension.
    ///
    /// The extension provides render/hit-test/bounds behavior for
    /// the given type name. The type name must not collide with a
    /// built-in shape type.
    pub fn register_shape(
        &mut self,
        type_name: impl Into<String>,
        extension: Box<dyn ShapeExtension>,
    ) {
        self.shapes.push((type_name.into(), extension));
    }

    /// Registers a custom command extension.
    ///
    /// The command can be executed through the engine's history
    /// machinery like any built-in command.
    pub fn register_command(
        &mut self,
        command: Box<dyn crate::command_extension::CommandExtension>,
    ) {
        self.commands.push(command);
    }

    /// Registers a custom serializer.
    ///
    /// The serializer can convert elements to/from a custom
    /// format (e.g. SVG, PDF).
    pub fn register_serializer(
        &mut self,
        serializer: Box<dyn crate::serializer::SerializerExtension>,
    ) {
        self.serializers.push(serializer);
    }

    /// Registers a custom importer.
    ///
    /// The importer can parse external formats into scene elements.
    pub fn register_importer(&mut self, importer: Box<dyn crate::serializer::ImporterExtension>) {
        self.importers.push(importer);
    }

    /// Registers a custom exporter.
    ///
    /// The exporter can convert scene elements to an external format.
    pub fn register_exporter(&mut self, exporter: Box<dyn crate::serializer::ExporterExtension>) {
        self.exporters.push(exporter);
    }
}

// ---------------------------------------------------------------------------
// Extension registry (lifecycle management)
// ---------------------------------------------------------------------------

/// Manages extension lifecycle for one engine instance.
///
/// The registry owns extensions and drives their explicit lifecycle
/// (register, activate, use, deactivate, dispose).
///
/// Extensions are stored as `Box<dyn Extension>` so the registry is
/// type-agnostic. The registry is instance-scoped.
///
/// Capability storage: everything a extension registers through
/// [`ExtensionContext`] is stored in the registry itself (not in the
/// short-lived context), so the capabilities survive registration and can
/// be queried by the engine and hosts: custom tool ids (host-owned
/// draw/behavior), custom shape extensions (render/hit/bounds), custom
/// command extensions (history-integrated), and format extensions
/// (serializers/importers/exporters).
#[derive(Default)]
pub struct ExtensionRegistry {
    extensions: Vec<Box<dyn Extension>>,
    tools: Vec<String>,
    shapes: Vec<(String, Box<dyn ShapeExtension>)>,
    commands: Vec<Box<dyn crate::command_extension::CommandExtension>>,
    serializers: Vec<Box<dyn crate::serializer::SerializerExtension>>,
    importers: Vec<Box<dyn crate::serializer::ImporterExtension>>,
    exporters: Vec<Box<dyn crate::serializer::ExporterExtension>>,
}

impl ExtensionRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers and activates a extension.
    ///
    /// The extension's [`Extension::register`] is called first with a
    /// [`ExtensionContext`] backed by this registry's capability storage,
    /// then [`Extension::activate`]. If activation fails, the extension is
    /// not retained.
    ///
    /// Returns `Err` when the extension's metadata is incompatible with
    /// the current [`EXTENSION_PROTOCOL_VERSION`].
    pub fn register(&mut self, mut extension: Box<dyn Extension>) -> crate::EngineResult<()> {
        let metadata = extension.metadata().clone();
        if !metadata.is_compatible_with(EXTENSION_PROTOCOL_VERSION) {
            return Err(crate::EngineError::InvalidInput(format!(
                "extension '{}' (v{}) is incompatible with protocol version {} (supported: {}..{})",
                metadata.id,
                metadata.version,
                EXTENSION_PROTOCOL_VERSION,
                metadata.min_protocol_version,
                metadata.max_protocol_version,
            )));
        }
        extension.register(&mut ExtensionContext {
            tools: &mut self.tools,
            shapes: &mut self.shapes,
            commands: &mut self.commands,
            serializers: &mut self.serializers,
            importers: &mut self.importers,
            exporters: &mut self.exporters,
        });
        extension.activate();
        self.extensions.push(extension);
        Ok(())
    }

    /// Borrows the registered custom tool ids.
    pub fn tools(&self) -> &[String] {
        &self.tools
    }

    /// Borrows the registered shape extensions as `(type_name, extension)`.
    pub fn shapes(&self) -> &[(String, Box<dyn ShapeExtension>)] {
        &self.shapes
    }

    /// Borrows the registered command extensions.
    pub fn commands(&self) -> &[Box<dyn crate::command_extension::CommandExtension>] {
        &self.commands
    }

    /// Borrows the registered serializer extensions.
    pub fn serializers(&self) -> &[Box<dyn crate::serializer::SerializerExtension>] {
        &self.serializers
    }

    /// Borrows the registered importer extensions.
    pub fn importers(&self) -> &[Box<dyn crate::serializer::ImporterExtension>] {
        &self.importers
    }

    /// Borrows the registered exporter extensions.
    pub fn exporters(&self) -> &[Box<dyn crate::serializer::ExporterExtension>] {
        &self.exporters
    }

    /// Finds a command extension by id (the dispatch seam for the future
    /// `executeCommand` protocol op and the extension SDK).
    pub fn command_by_id(
        &self,
        command_id: &str,
    ) -> Option<&dyn crate::command_extension::CommandExtension> {
        self.commands
            .iter()
            .find(|command| command.command_id() == command_id)
            .map(Box::as_ref)
    }

    /// Deactivates and disposes all extensions in reverse registration
    /// order (LIFO teardown), then clears all capability storage.
    pub fn dispose_all(&mut self) {
        for extension in self.extensions.iter_mut().rev() {
            extension.deactivate();
            extension.dispose();
        }
        self.extensions.clear();
        self.tools.clear();
        self.shapes.clear();
        self.commands.clear();
        self.serializers.clear();
        self.importers.clear();
        self.exporters.clear();
    }

    /// Returns the number of registered extensions.
    pub fn len(&self) -> usize {
        self.extensions.len()
    }

    /// Returns `true` when no extensions are registered.
    pub fn is_empty(&self) -> bool {
        self.extensions.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestExtension {
        metadata: ExtensionMetadata,
        registered: bool,
        activated: bool,
        deactivated: bool,
        disposed: bool,
    }

    impl TestExtension {
        fn new() -> Self {
            Self {
                metadata: ExtensionMetadata::new("test.extension", "Test Extension", "1.0.0"),
                registered: false,
                activated: false,
                deactivated: false,
                disposed: false,
            }
        }
    }

    impl Extension for TestExtension {
        fn metadata(&self) -> &ExtensionMetadata {
            &self.metadata
        }
        fn register(&mut self, _ctx: &mut ExtensionContext) {
            self.registered = true;
        }
        fn activate(&mut self) {
            self.activated = true;
        }
        fn deactivate(&mut self) {
            self.deactivated = true;
        }
        fn dispose(&mut self) {
            self.disposed = true;
        }
    }

    #[test]
    fn extension_lifecycle_order() {
        let mut registry = ExtensionRegistry::new();
        let mut extension = Box::new(TestExtension::new());
        extension.register(&mut ExtensionContext {
            tools: &mut Vec::new(),
            shapes: &mut Vec::new(),
            commands: &mut Vec::new(),
            serializers: &mut Vec::new(),
            importers: &mut Vec::new(),
            exporters: &mut Vec::new(),
        });
        assert!(extension.registered);
        assert!(!extension.activated);
        extension.activate();
        assert!(extension.activated);
        registry.extensions.push(extension);
        registry.dispose_all();
        assert!(registry.is_empty());
    }

    #[test]
    fn incompatible_extension_is_rejected() {
        let mut registry = ExtensionRegistry::new();
        let metadata = ExtensionMetadata {
            id: "old.extension".to_string(),
            name: "Old Extension".to_string(),
            version: "0.1.0".to_string(),
            min_protocol_version: 0,
            max_protocol_version: 0,
        };
        let extension = Box::new(TestExtension {
            metadata,
            registered: false,
            activated: false,
            deactivated: false,
            disposed: false,
        });
        let result = registry.register(extension);
        assert!(result.is_err());
        assert!(registry.is_empty());
    }

    #[test]
    fn metadata_compatibility_check() {
        let meta = ExtensionMetadata::new("test", "Test", "1.0.0");
        assert!(meta.is_compatible_with(1));
        assert!(!meta.is_compatible_with(0));
        assert!(!meta.is_compatible_with(2));
    }

    #[test]
    fn registered_capabilities_persist_in_registry_storage() {
        use crate::command_extension::CommandExtension;
        use crate::shape_extension::ShapeExtension;

        struct StarExtension;
        impl ShapeExtension for StarExtension {
            fn type_name(&self) -> &str {
                "star"
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

        struct BurstCommand;
        impl CommandExtension for BurstCommand {
            fn command_id(&self) -> &str {
                "star-burst"
            }
            fn execute(
                &self,
                _ctx: &mut crate::command::CommandContext,
            ) -> crate::EngineResult<()> {
                Ok(())
            }
        }

        struct CapabilityExtension {
            metadata: ExtensionMetadata,
        }
        impl Extension for CapabilityExtension {
            fn metadata(&self) -> &ExtensionMetadata {
                &self.metadata
            }
            fn register(&mut self, ctx: &mut ExtensionContext) {
                ctx.register_tool("star");
                ctx.register_shape("star", Box::new(StarExtension));
                ctx.register_command(Box::new(BurstCommand));
            }
        }

        let mut registry = ExtensionRegistry::new();
        registry
            .register(Box::new(CapabilityExtension {
                metadata: ExtensionMetadata::new("com.example.star", "Star", "1.0.0"),
            }))
            .expect("compatible extension registers");

        // Capabilities survive the registration phase — the context is
        // gone, the registry storage is what the engine/SDK queries.
        assert_eq!(registry.tools(), &["star".to_string()]);
        assert_eq!(registry.shapes().len(), 1);
        assert_eq!(registry.shapes()[0].0, "star");
        assert_eq!(registry.commands().len(), 1);
        assert_eq!(
            registry.command_by_id("star-burst").map(|c| c.command_id()),
            Some("star-burst")
        );
        assert!(registry.command_by_id("missing").is_none());

        registry.dispose_all();
        assert!(registry.tools().is_empty());
        assert!(registry.shapes().is_empty());
        assert!(registry.commands().is_empty());
    }
}
