//! Extension registration: the slides module as a discoverable capability.
//!
//! [`PptxExtension`] plugs the exporter into any [`ExtensionRegistry`]
//! under a unique extension id, and [`PptxExporter`] carries the globally
//! unique format id (the `.pptx` MIME type). Hosts and third-party
//! extensions discover slides support through these ids — never through
//! engine internals — following the same capability pattern as shape and
//! command extensions.
//!
//! [`ExtensionRegistry`]: grafalith_core::ExtensionRegistry

use grafalith_core::document::Document;
use grafalith_core::extension::{Extension, ExtensionContext, ExtensionMetadata};
use grafalith_core::serializer::ExporterExtension;
use grafalith_core::EngineResult;

use crate::base64::encode;
use crate::presentation::{build_package, SlideDeck, SlideSize};

/// MIME type identifying the PowerPoint slide package format.
pub const PPTX_MIME: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/// Unique id of the slides extension in capability registries.
pub const PPTX_EXTENSION_ID: &str = "studio.grafalith.pptx";

/// Exporter turning a document into a base64 `.pptx` package.
///
/// The exporter contract is string-only, so the binary package crosses it
/// base64-encoded. Stage 1 exports a blank 16:9 deck (the package framing
/// this crate exists to prove); element-to-shape mapping is the next stage
/// and changes no interface here.
pub struct PptxExporter;

impl ExporterExtension for PptxExporter {
    fn format_id(&self) -> &str {
        PPTX_MIME
    }

    fn export(&self, _document: &Document) -> EngineResult<String> {
        let deck = SlideDeck {
            size: SlideSize::default_16x9(),
            slides: vec![crate::presentation::SlideSpec { background: None }],
        };
        Ok(encode(&build_package(&deck)?))
    }
}

/// Extension unit registering the slides exporter capability.
pub struct PptxExtension {
    metadata: ExtensionMetadata,
}

impl PptxExtension {
    /// Creates the extension with its fixed identity and compatibility range.
    pub fn new() -> Self {
        Self {
            metadata: ExtensionMetadata::new(
                PPTX_EXTENSION_ID,
                "PowerPoint Slides (PPTX)",
                "0.1.0",
            ),
        }
    }
}

impl Default for PptxExtension {
    fn default() -> Self {
        Self::new()
    }
}

impl Extension for PptxExtension {
    fn metadata(&self) -> &ExtensionMetadata {
        &self.metadata
    }

    fn register(&mut self, ctx: &mut ExtensionContext) {
        ctx.register_exporter(Box::new(PptxExporter));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use grafalith_core::document::Document;
    use grafalith_core::extension::ExtensionRegistry;

    #[test]
    fn exporter_registers_under_its_unique_ids() {
        let mut registry = ExtensionRegistry::new();
        registry
            .register(Box::new(PptxExtension::new()))
            .expect("compatible extension registers");
        assert_eq!(registry.exporters().len(), 1);
        assert_eq!(registry.exporters()[0].format_id(), PPTX_MIME);
    }

    #[test]
    fn export_returns_base64_package_bytes() {
        let exporter = PptxExporter;
        let document = Document::new();
        let encoded = exporter.export(&document).expect("stage-1 export succeeds");
        let bytes = crate::base64::decode(&encoded).expect("exporter output is valid base64");
        assert_eq!(&bytes[0..2], b"PK");
        let files = crate::zip::zip_read(&bytes).expect("exported package reads back");
        assert!(files.iter().any(|file| file.name == "ppt/presentation.xml"));
    }
}
