//! `grafalith-sdk`: public extension SDK facade for native (Rust) extensions.
//!
//! Third-party crates depend on this facade — never on engine internals —
//! to add node types, tools, commands, and format handlers. It re-exports
//! the extension traits, the instance-scoped [`ExtensionRegistry`], and the
//! protocol-version contract behind one stable path.
//!
//! Role split: this Rust facade serves **in-process native** extensions (new
//! node types, history-integrated commands, format handlers — all of which
//! must be Rust because `Custom` data and `CommandExtension` cross no FFI
//! boundary). The **primary extension ecosystem** (custom UI, tools
//! buttons, panels, canvas renderers, automation) lives in the TypeScript
//! SDK (`packages/grafalith-sdk`), which drives the same engine through the
//! JSON-string protocol — the VSCode model (JS extensions over a stable API
//! boundary).
//!
//! Rules for extension authors (enforced by the types, not just docs):
//! instance scope — registries are owned per engine, never global; one user
//! intent is one undoable history entry — mutate only through
//! [`CommandContext`](command::CommandContext) (upsert/soft-delete plus the
//! fresh-id minting there); fallible operations return [`EngineResult`] —
//! panics never cross FFI; capability namespaces are yours — prefix ids with
//! your domain (`acme.sticker.create`, never bare `create`).

/// Extension lifecycle + registration surface.
pub mod extension {
    pub use grafalith_core::extension::{
        Extension, ExtensionContext, ExtensionMetadata, ExtensionRegistry,
        EXTENSION_PROTOCOL_VERSION,
    };
}

/// `.grlt` manifest validation (identity, semver, engines gate, events, permissions).
pub mod manifest;

/// Extension discovery: listing installed `.grlt` packages on disk.
pub mod discovery;

/// Extension lifecycle statuses (mirrors the desktop status machine).
pub mod status;

/// Dependency graph resolution (order dependents after dependencies).
pub mod dependency;

/// Per-extension persistent storage (JSON object per extension id).
pub mod storage;

/// Notification routing DTOs (Rust → TypeScript toast provider).
pub mod notification;

/// Custom shape behavior (render/hit/bounds for new node types).
pub mod shape {
    pub use grafalith_core::shape_extension::{
        dispatch_bounds, dispatch_hit_test, dispatch_render, ShapeExtension,
    };
}

/// History-integrated custom commands.
pub mod command {
    pub use grafalith_core::command::CommandContext;
    pub use grafalith_core::command_extension::CommandExtension;
}

/// Custom serializers, importers, and exporters.
pub mod format {
    pub use grafalith_core::serializer::{
        ExporterExtension, ImporterExtension, SerializerExtension,
    };
}

/// Element model (plain data) for reading inputs and building outputs.
pub mod element {
    pub use grafalith_core::element::{
        BaseElement, CornerRadii, CustomElement, Element, ElementFillStyle, ElementId, FillStyle,
        GradientStop, GradientType, IdGenerator, PatchValue, StrokeAlign, StrokeCap, StrokeJoin,
        StrokeStyle,
    };
}

/// Geometry primitives for hit-test and bounds math.
pub mod geometry {
    pub use grafalith_core::geometry;
}

/// Shared error and result types.
pub use grafalith_core::{EngineError, EngineResult};

/// SDK crate version (follows the engine crates).
pub const SDK_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Protocol version extensions must target (re-exported so authors compare
/// against one symbol, not a magic number).
pub use grafalith_core::extension::EXTENSION_PROTOCOL_VERSION as PROTOCOL_VERSION;
