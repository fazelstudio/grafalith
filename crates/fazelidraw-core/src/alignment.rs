//! Align (6 ops) + distribute (2 ops, outer-fixed equal-gap).
//!
//! TS source: `packages/core/src/interaction/alignment.ts` (distribute
//! keeps outer elements fixed and equalizes gaps; `< 3` elements is a
//! no-op — pinned by `alignment.test.ts`).
//!
//! Target (Phase 05): pure command builders over explicit bounds.
