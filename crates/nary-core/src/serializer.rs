//! Serializer, importer, and exporter extension points.
//!
//! These traits define the boundary for plugin-registered format handlers:
//! serializing elements to a custom format (e.g. SVG, PDF), importing
//! external formats into scene elements, and exporting scene elements to an
//! external format.
//!
//! Design rules: all traits are object-safe for `Box<dyn ...>` storage and
//! `Send + Sync` for Tauri host compatibility; they use serializable data
//! (`str`, `String`, element references) so no Rust types cross the WASM
//! boundary; importers/exporters operate on the document through validated
//! APIs, never through mutable internals.

use crate::document::Document;
use crate::element::Element;
use crate::EngineResult;

/// A plugin-registered serializer for a custom format.
///
/// Serializers convert elements to a string representation in a
/// plugin-defined format. The format is identified by a string
/// (e.g. `"image/svg+xml"`).
pub trait SerializerExtension: Send + Sync {
    /// The MIME type or format identifier this serializer handles.
    fn format_id(&self) -> &str;

    /// Serializes a single element to the custom format.
    ///
    /// Returns the serialized string on success.
    fn serialize_element(&self, element: &Element) -> EngineResult<String>;
}

/// A plugin-registered importer for an external format.
///
/// Importers parse external content into scene elements. The format
/// is identified by a string (e.g. `"image/svg+xml"`).
pub trait ImporterExtension: Send + Sync {
    /// The MIME type or format identifier this importer handles.
    fn format_id(&self) -> &str;

    /// Parses `content` and returns the elements it produced.
    ///
    /// The importer should validate its output through the same
    /// rules as the built-in import pipeline (finite numbers, valid
    /// references). Invalid content is returned as an `Err`.
    fn import(&self, content: &str) -> EngineResult<Vec<Element>>;
}

/// A plugin-registered exporter for an external format.
///
/// Exporters convert the full document to a string representation
/// in a plugin-defined format.
pub trait ExporterExtension: Send + Sync {
    /// The MIME type or format identifier this exporter handles.
    fn format_id(&self) -> &str;

    /// Exports the full document to the custom format.
    ///
    /// Returns the exported string on success.
    fn export(&self, document: &Document) -> EngineResult<String>;
}
