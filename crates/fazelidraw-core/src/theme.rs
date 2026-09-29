//! Chrome design tokens (not element colors).
//!
//! TS sources: `packages/core/src/theme/types.ts`,
//! `default-theme.ts`, `theme-provider.ts` (one-time deep-merge
//! `resolveTheme` with copy-not-reference semantics, pinned by
//! `theme-provider.test.ts`).
//!
//! Target (Phase 02): pure token types + pure merge. Element colors stay on
//! elements (`element.rs`); theme covers selection chrome, handles, fonts.
//! Customization passes config explicitly (no global mutation), so multiple
//! instances can carry different themes (ARCHITECTURE §9.2).
