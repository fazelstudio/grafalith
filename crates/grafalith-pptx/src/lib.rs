//! `grafalith-pptx`: PowerPoint (`.pptx`) slide export foundation.
//!
//! A presentation is an OPC package — plain ZIP entries addressed by
//! `[Content_Types].xml` and `_rels` parts — so most of this crate is
//! deliberately hand-written: [`zip`] framing, [`crc32`], [`base64`], and
//! the [`xml`] builders are owned here and covered by fixed vectors, which
//! keeps the format auditable without a large dependency tree. Two tiny
//! pure-Rust crates fill the gaps that are genuinely hard to own: `flate2`
//! (DEFLATE codec, Rust backend, no C) for compressed entries and package
//! reading, and `quick-xml` for parsing package parts on the verification
//! and future import path. Everything is `no_std`-free but classroom-safe:
//! no DOM/Canvas/React/Tauri, no globals, no I/O — callers pass bytes in
//! and get bytes out, so WASM and native hosts share the same code.
//!
//! Subset profile (stage 1, this crate): blank slides at an explicit
//! [`SlideSize`], optional solid slide backgrounds, one master, one blank
//! layout, minimal theme, deflated entries. Element-to-shape mapping
//! (text, autoshapes, images) is the next stage and changes no interface
//! here; arbitrary producer import, charts, SmartArt, OLE, and encrypted
//! packages are explicitly out of scope.
//!
//! Extension support: [`PptxExtension`] registers [`PptxExporter`] under the
//! unique [`PPTX_MIME`] format id, so hosts and third-party extensions
//! discover slides support through the capability registry — the same
//! pattern as shape and command extensions. All fallible operations return
//! [`EngineResult`]; `panic!` never crosses a boundary.
//!
//! [`EngineResult`]: grafalith_core::EngineResult

pub mod base64;
pub mod crc32;
pub mod extension;
pub mod presentation;
pub mod xml;
pub mod zip;

pub use extension::{PptxExporter, PptxExtension, PPTX_EXTENSION_ID, PPTX_MIME};
pub use presentation::{build_package, content_types, SlideDeck, SlideSize, SlideSpec};
pub use zip::{zip_read, zip_write, ZipEntry, ZipFile, ZipMethod};
