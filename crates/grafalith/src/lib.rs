//! `grafalith`: npm/WASM distribution of the Grafalith Rust engine.
//!
//! This crate is the `wasm-pack` entry point that ships to npm as
//! `@fazelstudio/grafalith`. It re-exports the string-only
//! [`JsEngine`](wasm::JsEngine) facade over
//! [`grafalith_bindings::Engine`], plus
//! [`bindings_protocol_version`](wasm::bindings_protocol_version) for
//! host-side skew checks.
//!
//! Boundary rules (same as `grafalith-bindings`): every crossing is a JSON
//! string (plus a few `bool`/`u32` scalars) so no Rust struct layout becomes
//! part of the npm API; domain failures never surface as JS exceptions —
//! whole-crossing failures are error-envelope strings, per-op failures are
//! `ok: false` entries inside the batch result; layout ops (`align`,
//! `distribute`, `applyAutoLayout`) are covered by the generic
//! [`apply_batch`](wasm::JsEngine::apply_batch) path with no dedicated
//! crossing by design (one batching rule).
//!
//! Native builds compile this crate too: `wasm-bindgen` expands to plain
//! methods there, so `cargo test -p grafalith` exercises the same strings
//! JS will receive without a WASM runner.

mod wasm;

pub use wasm::bindings_protocol_version;
pub use wasm::JsEngine;
