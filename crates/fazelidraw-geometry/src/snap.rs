//! Grid + object snapping math.
//!
//! TS source: `packages/core/src/interaction/snap.ts`
//! (`defaultSnapConfig.snapThreshold = 5` screen px, zoom-normalized via
//! `/ zoom`; grid values and edge/center guides pinned by `snap.test.ts`).
//!
//! Target (Phase 04): pure snap functions over explicit candidate sets.
//! Snap providers as an extension point arrive later (Phase 09); the math
//! itself stays host-independent.
