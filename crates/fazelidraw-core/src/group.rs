//! Group / ungroup and member queries.
//!
//! TS source: `packages/core/src/scene/group-actions.ts` (group/ungroup,
//! member queries, outermost-group; group-click member expansion lives in
//! the editor session, the pure part lives here).
//!
//! Target (Phase 02): acyclic group membership over stable ids; no index
//! used as identity (module 01 §D).
