//! Plugin infrastructure: the public extension API.
//!
//! This module defines the [`Plugin`] trait, the [`PluginContext`]
//! registration surface, and the [`PluginRegistry`] that owns plugin
//! lifecycle. It is the *only* way extensions interact with core
//! internals — no mutable core state is exposed.
//!
//! Design rules: each [`PluginRegistry`] is owned by one engine instance
//! (no globals); lifecycle is explicit (register, activate, use,
//! deactivate, dispose) with predictable ordering; plugins interact through
//! documented capability interfaces ([`PluginContext`],
//! [`ShapeExtension`], [`CommandExtension`], [`SerializerExtension`]) and
//! never through mutable core internals; [`PluginMetadata`] carries a
//! compatibility range the registry checks before activation; all contracts
//! are serializable/handle-based so no Rust trait objects cross the WASM
//! boundary directly.

use crate::shape_extension::ShapeExtension;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/// Protocol version this plugin system targets.
pub const PLUGIN_PROTOCOL_VERSION: u32 = 1;

/// Plugin metadata: identity + compatibility contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginMetadata {
    /// Unique plugin identifier (e.g. `"com.example.star-shapes"`).
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Semantic version string.
    pub version: String,
    /// Minimum compatible [`PLUGIN_PROTOCOL_VERSION`] (inclusive).
    pub min_protocol_version: u32,
    /// Maximum compatible [`PLUGIN_PROTOCOL_VERSION`] (inclusive).
    pub max_protocol_version: u32,
}

impl PluginMetadata {
    /// Creates metadata with the given id/name/version and a compatibility
    /// range of exactly [`PLUGIN_PROTOCOL_VERSION`].
    pub fn new(id: impl Into<String>, name: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            version: version.into(),
            min_protocol_version: PLUGIN_PROTOCOL_VERSION,
            max_protocol_version: PLUGIN_PROTOCOL_VERSION,
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
// Plugin trait
// ---------------------------------------------------------------------------

/// The plugin contract: metadata, registration, and lifecycle.
///
/// Plugins are registered through [`Plugin::register`], which receives
/// a [`PluginContext`] for declaring capabilities. The lifecycle is:
///
/// ```text
/// register → activate → use → deactivate → dispose
/// ```
///
/// All lifecycle methods except [`Plugin::register`] have default
/// no-op implementations so plugins only override what they need.
pub trait Plugin: Send + Sync {
    /// Returns the plugin's metadata (id, name, version, compatibility).
    fn metadata(&self) -> &PluginMetadata;

    /// Registration phase: declare capabilities through `ctx`.
    ///
    /// This is the only phase where plugins can register tools, shapes,
    /// commands, serializers, and event handlers. After registration
    /// the plugin is activated.
    fn register(&mut self, ctx: &mut PluginContext);

    /// Activation phase: the plugin is now live and its capabilities
    /// are available to the engine.
    fn activate(&mut self) {}

    /// Deactivation phase: the plugin's capabilities are being removed.
    /// The plugin should release any resources it acquired during
    /// activation.
    fn deactivate(&mut self) {}

    /// Disposal phase: the plugin is being permanently removed. All
    /// resources must be released.
    fn dispose(&mut self) {}
}

// ---------------------------------------------------------------------------
// Plugin context (registration surface)
// ---------------------------------------------------------------------------

/// The registration surface handed to [`Plugin::register`].
///
/// This is the *only* way plugins declare capabilities. It provides
/// methods for registering tools, shapes, commands, serializers,
/// importers, exporters, and event handlers.
///
/// The context is borrowed mutably during registration and cannot
/// be retained by the plugin — after [`Plugin::register`] returns,
/// the context is no longer valid.
pub struct PluginContext<'a> {
    pub(crate) tools: &'a mut Vec<String>,
    pub(crate) shapes: &'a mut Vec<(String, Box<dyn ShapeExtension>)>,
    pub(crate) commands: &'a mut Vec<Box<dyn crate::command_extension::CommandExtension>>,
    pub(crate) serializers: &'a mut Vec<Box<dyn crate::serializer::SerializerExtension>>,
    pub(crate) importers: &'a mut Vec<Box<dyn crate::serializer::ImporterExtension>>,
    pub(crate) exporters: &'a mut Vec<Box<dyn crate::serializer::ExporterExtension>>,
}

impl<'a> PluginContext<'a> {
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
// Plugin registry (lifecycle management)
// ---------------------------------------------------------------------------

/// Manages plugin lifecycle for one engine instance.
///
/// The registry owns plugins and drives their explicit lifecycle
/// (register, activate, use, deactivate, dispose).
///
/// Plugins are stored as `Box<dyn Plugin>` so the registry is
/// type-agnostic. The registry is instance-scoped.
///
/// Capability storage: everything a plugin registers through
/// [`PluginContext`] is stored in the registry itself (not in the
/// short-lived context), so the capabilities survive registration and can
/// be queried by the engine and hosts: custom tool ids (host-owned
/// draw/behavior), custom shape extensions (render/hit/bounds), custom
/// command extensions (history-integrated), and format extensions
/// (serializers/importers/exporters).
#[derive(Default)]
pub struct PluginRegistry {
    plugins: Vec<Box<dyn Plugin>>,
    tools: Vec<String>,
    shapes: Vec<(String, Box<dyn ShapeExtension>)>,
    commands: Vec<Box<dyn crate::command_extension::CommandExtension>>,
    serializers: Vec<Box<dyn crate::serializer::SerializerExtension>>,
    importers: Vec<Box<dyn crate::serializer::ImporterExtension>>,
    exporters: Vec<Box<dyn crate::serializer::ExporterExtension>>,
}

impl PluginRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers and activates a plugin.
    ///
    /// The plugin's [`Plugin::register`] is called first with a
    /// [`PluginContext`] backed by this registry's capability storage,
    /// then [`Plugin::activate`]. If activation fails, the plugin is
    /// not retained.
    ///
    /// Returns `Err` when the plugin's metadata is incompatible with
    /// the current [`PLUGIN_PROTOCOL_VERSION`].
    pub fn register(&mut self, mut plugin: Box<dyn Plugin>) -> crate::EngineResult<()> {
        let metadata = plugin.metadata().clone();
        if !metadata.is_compatible_with(PLUGIN_PROTOCOL_VERSION) {
            return Err(crate::EngineError::InvalidInput(format!(
                "plugin '{}' (v{}) is incompatible with protocol version {} (supported: {}..{})",
                metadata.id,
                metadata.version,
                PLUGIN_PROTOCOL_VERSION,
                metadata.min_protocol_version,
                metadata.max_protocol_version,
            )));
        }
        plugin.register(&mut PluginContext {
            tools: &mut self.tools,
            shapes: &mut self.shapes,
            commands: &mut self.commands,
            serializers: &mut self.serializers,
            importers: &mut self.importers,
            exporters: &mut self.exporters,
        });
        plugin.activate();
        self.plugins.push(plugin);
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
    /// `executeCommand` protocol op and the plugin SDK).
    pub fn command_by_id(
        &self,
        command_id: &str,
    ) -> Option<&dyn crate::command_extension::CommandExtension> {
        self.commands
            .iter()
            .find(|command| command.command_id() == command_id)
            .map(Box::as_ref)
    }

    /// Deactivates and disposes all plugins in reverse registration
    /// order (LIFO teardown), then clears all capability storage.
    pub fn dispose_all(&mut self) {
        for plugin in self.plugins.iter_mut().rev() {
            plugin.deactivate();
            plugin.dispose();
        }
        self.plugins.clear();
        self.tools.clear();
        self.shapes.clear();
        self.commands.clear();
        self.serializers.clear();
        self.importers.clear();
        self.exporters.clear();
    }

    /// Returns the number of registered plugins.
    pub fn len(&self) -> usize {
        self.plugins.len()
    }

    /// Returns `true` when no plugins are registered.
    pub fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestPlugin {
        metadata: PluginMetadata,
        registered: bool,
        activated: bool,
        deactivated: bool,
        disposed: bool,
    }

    impl TestPlugin {
        fn new() -> Self {
            Self {
                metadata: PluginMetadata::new("test.plugin", "Test Plugin", "1.0.0"),
                registered: false,
                activated: false,
                deactivated: false,
                disposed: false,
            }
        }
    }

    impl Plugin for TestPlugin {
        fn metadata(&self) -> &PluginMetadata {
            &self.metadata
        }
        fn register(&mut self, _ctx: &mut PluginContext) {
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
    fn plugin_lifecycle_order() {
        let mut registry = PluginRegistry::new();
        let mut plugin = Box::new(TestPlugin::new());
        plugin.register(&mut PluginContext {
            tools: &mut Vec::new(),
            shapes: &mut Vec::new(),
            commands: &mut Vec::new(),
            serializers: &mut Vec::new(),
            importers: &mut Vec::new(),
            exporters: &mut Vec::new(),
        });
        assert!(plugin.registered);
        assert!(!plugin.activated);
        plugin.activate();
        assert!(plugin.activated);
        registry.plugins.push(plugin);
        registry.dispose_all();
        assert!(registry.is_empty());
    }

    #[test]
    fn incompatible_plugin_is_rejected() {
        let mut registry = PluginRegistry::new();
        let metadata = PluginMetadata {
            id: "old.plugin".to_string(),
            name: "Old Plugin".to_string(),
            version: "0.1.0".to_string(),
            min_protocol_version: 0,
            max_protocol_version: 0,
        };
        let plugin = Box::new(TestPlugin {
            metadata,
            registered: false,
            activated: false,
            deactivated: false,
            disposed: false,
        });
        let result = registry.register(plugin);
        assert!(result.is_err());
        assert!(registry.is_empty());
    }

    #[test]
    fn metadata_compatibility_check() {
        let meta = PluginMetadata::new("test", "Test", "1.0.0");
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

        struct CapabilityPlugin {
            metadata: PluginMetadata,
        }
        impl Plugin for CapabilityPlugin {
            fn metadata(&self) -> &PluginMetadata {
                &self.metadata
            }
            fn register(&mut self, ctx: &mut PluginContext) {
                ctx.register_tool("star");
                ctx.register_shape("star", Box::new(StarExtension));
                ctx.register_command(Box::new(BurstCommand));
            }
        }

        let mut registry = PluginRegistry::new();
        registry
            .register(Box::new(CapabilityPlugin {
                metadata: PluginMetadata::new("com.example.star", "Star", "1.0.0"),
            }))
            .expect("compatible plugin registers");

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
