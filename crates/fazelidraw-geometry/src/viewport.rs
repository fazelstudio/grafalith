//! Scene `<->` screen coordinate math and zoom clamping.
//!
//! TS source: `packages/core/src/render/viewport.ts` (`sceneToScreen`,
//! `screenToScene`, `getViewportBounds`, `clampZoom` 0.1–10).
//!
//! Target (Phase 04): pure functions only. Every operation declares its
//! coordinate space (screen / viewport / world / local); values from
//! different spaces are never compared without explicit conversion
//! (module 06). Screen-pixel tolerances convert via `/ zoom`.
