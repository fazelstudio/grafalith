//! Element types: `BaseElement` + concrete variants + style unions.
//!
//! TS source: `packages/core/src/scene/types.ts` (+ factories in
//! `packages/core/src/scene/create-element.ts`).
//!
//! Target (Phase 02): field-for-field parity with the TS contract — `id`,
//! `type`, scene-space `x/y/width/height`, `rotation`, stroke/fill style,
//! `opacity`, `seed`, `version` + `versionNonce`, `isDeleted`, `groupIds`,
//! `locked`, and per-type extras (points, bindings, text, pressures,
//! crop, segments, component refs). **Freeze zone**: `AGENTS.md` forbids
//! changing `BaseElement` without explicit approval; the Rust model needs
//! the same discipline. See module 04.
