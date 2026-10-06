//! `nary-io`: serialization and interchange for the Nary Rust
//! engine.
//!
//! This crate owns the versioned JSON schema, the staged import pipeline,
//! the clipboard payload codec, and PNG export descriptors. It depends on
//! `nary-core` for the domain and on `serde`/`serde_json` for the string
//! layer; `nary-core` itself stays dependency-free.
//!
//! Hard boundaries: this crate depends on `nary-core` only (plus
//! `serde`/`serde_json`), and never touches files, the OS clipboard, the
//! DOM/Canvas, React, or Tauri — host adapters own all of those; this crate
//! hands them strings and pure descriptors. Schema evolution lives here
//! (versioned DTOs in [`schema`](crate::schema) are not public API), so the
//! wire format can migrate without touching the domain.
//!
//! ## Dependency justification
//!
//! `serde` 1 (MIT/Apache-2.0, `derive` feature) is the schema DTO
//! mechanism — pure Rust, `wasm32-unknown-unknown` compatible, no OS
//! dependencies. `serde_json` 1 (MIT/Apache-2.0) is the JSON string layer
//! for import/export/clipboard payloads — pure Rust, WASM compatible.
//! `nary-core` (path) is the domain (document, elements, history, clipboard
//! buffer, geometry).
//!
//! No async runtime, no CLI, no filesystem access.

pub mod clipboard_codec;
pub mod pipeline;
/// Versioned JSON schema (DTOs, envelope rules, element dispatch).
/// Crate-internal: the wire shape is pinned by fixture tests, not by API.
pub(crate) mod schema;
/// SVG import through `usvg` (host-gated `svg` feature).
#[cfg(feature = "svg")]
mod svg;

pub use clipboard_codec::{decode_clipboard, encode_clipboard, ClipboardDecode};
pub use clipboard_codec::{publish_clipboard, subscribe_clipboard};
pub use pipeline::{
    export_str, import_str, import_str_tracked, parse_fill_style, plan_jpeg_export,
    plan_png_export, plan_webp_export, JpegExportOptions, JpegExportPlan, PngExportOptions,
    PngExportPlan, WebpExportOptions, WebpExportPlan, PNG_MAX_DIMENSION,
};
#[cfg(feature = "svg")]
pub use svg::{import_svg_str, import_svg_str_tracked, svg_to_elements};
