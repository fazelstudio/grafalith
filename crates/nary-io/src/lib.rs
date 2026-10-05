//! `nary-io`: serialization and interchange for the Nary Rust
//! engine.
//!
//! This crate owns the versioned JSON schema, the staged import pipeline,
//! the clipboard payload codec, and PNG export descriptors — the Phase 06
//! scope (`docs/modules/08-io-serialization-and-clipboard.md`). It depends
//! on `nary-core` for the domain and on `serde`/`serde_json` for the
//! string layer; `nary-core` itself stays dependency-free (ADR-0005).
//!
//! Hard boundaries (modules 01, 02, 08):
//!
//! - Depends on `nary-core` only (plus `serde`/`serde_json`).
//! - Never touches files, the OS clipboard, the DOM/Canvas, React, or
//!   Tauri. Host adapters own all of those; this crate hands them strings
//!   and pure descriptors.
//! - Schema evolution lives here (versioned DTOs in [`schema`](crate::schema)
//!   are not public API), so the wire format can migrate without touching
//!   the domain.
//!
//! ## Dependency justification (ADR-0005)
//!
//! - `serde` 1 (MIT/Apache-2.0, `derive` feature): the schema DTO mechanism;
//!   pure Rust, `wasm32-unknown-unknown` compatible, no OS dependencies.
//! - `serde_json` 1 (MIT/Apache-2.0): the JSON string layer for
//!   import/export/clipboard payloads; pure Rust, WASM compatible.
//! - `nary-core` (path): the domain (document, elements, history,
//!   clipboard buffer, geometry).
//!
//! No async runtime, no CLI, no filesystem access.

pub mod clipboard_codec;
pub mod pipeline;
/// Versioned JSON schema (v1 DTOs, envelope rules, element dispatch).
/// Crate-internal: the wire shape is pinned by fixture tests, not by API.
pub(crate) mod schema;

pub use clipboard_codec::{decode_clipboard, encode_clipboard, ClipboardDecode};
pub use clipboard_codec::{publish_clipboard, subscribe_clipboard};
pub use pipeline::{
    export_str, import_str, import_str_tracked, parse_fill_style, plan_jpeg_export,
    plan_png_export, plan_webp_export, JpegExportOptions, JpegExportPlan, PngExportOptions,
    PngExportPlan, WebpExportOptions, WebpExportPlan, PNG_MAX_DIMENSION,
};
