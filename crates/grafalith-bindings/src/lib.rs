//! `grafalith-bindings`: host boundary for the Grafalith Rust engine.
//!
//! This crate is the deliberate JS/WASM/npm surface over the engine. It
//! owns the versioned JSON-string protocol ([`protocol`]), the
//! instance-scoped [`Engine`] that executes it, and the
//! [`wasm_bindgen`](wasm) glue. `grafalith-core` stays dependency-free: only
//! this leaf crate carries `wasm-bindgen`.
//!
//! Hard boundaries: this crate depends on `grafalith-core` + `grafalith-io` (path)
//! plus `serde` / `serde_json` (same pure-Rust, WASM-compatible
//! justification as the io crate) and `wasm-bindgen 0.2` (MIT/Apache-2.0,
//! the binding mechanism itself — compiles on native targets too, so the
//! boundary is tested by `cargo test` without a WASM runner). It never
//! touches files, the OS clipboard, the DOM/Canvas, React, or Tauri — host
//! adapters own all of those; this crate hands them JSON strings and pure
//! descriptors. No Rust internals cross the boundary: no domain struct
//! serializes directly, no `panic!` escapes as an API (whole-crossing
//! failures are JSON envelopes, per-op failures are `ok: false` entries).
//!
//! ## Dependency justification
//!
//! `wasm-bindgen` 0.2 is the WASM/JS glue: required for the npm/browser
//! target, inert on native builds where the same methods run as plain Rust
//! (covered by `tests/bindings_model.rs`). `serde` 1 + `serde_json` 1 form
//! the JSON-string layer (same justification as the io crate: pure Rust,
//! `wasm32` compatible).
//!
//! No async runtime, no filesystem access, no `unsafe`.
//!
//! Native-embedding surface: [`BatchOp`] is the typed form of one batch
//! entry for [`Engine::apply_ops`] (WASM hosts use the JSON string form
//! through [`Engine::apply_batch`]). The `*Json` shapes are the typed
//! inputs embedded hosts construct when JSON cannot express a value
//! (notably non-finite floats, which JSON has no syntax for).

pub mod engine;
pub mod protocol;
pub mod render_dto;
pub mod tauri;
// The `wasm_bindgen` glue is test-only here: the npm distribution crate
// (`crates/grafalith`) owns the public `JsEngine` surface, so compiling this
// module into a wasm build would export `JsEngine` twice.
#[cfg(test)]
pub mod wasm;

pub use engine::Engine;
pub use engine::BINDINGS_VERSION;
pub use protocol::PROTOCOL_VERSION;
pub use protocol::{
    BatchOp, ModifiersJson, RenderQueryJson, SnapConfigJson, StylePatchJson, ThemeOverrideJson,
    ThemeSizesOverrideJson, ViewportJson,
};
