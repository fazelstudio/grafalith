# Architecture Contract — Grafalith

This document records cross-crate invariants and public architectural boundaries. Exact Rust types, function signatures, and generated protocol schemas must be verified against the source of truth and the crate/API documentation; do not copy historical TypeScript examples into Rust implementation.

If an implementation task requires changing an established contract in this document, explain the trade-off and obtain maintainer approval before changing the architecture.

## 1. System overview

Grafalith consists of a Rust graphics/document engine and host integrations. The engine owns document semantics and produces deterministic render data. Hosts own platform-specific input, presentation, rasterization, and UI.

The shared engine is intended to support Design, Slides, and Whiteboard workflows where their requirements overlap. Mode-specific models and rules must remain explicit; shared primitives do not imply that every mode has the same document structure.

## 2. Architectural principles

1. **Data-oriented domain:** document elements are serializable data. Rendering, hit testing, geometry operations, and input policy live in separate functions/services rather than being embedded as host-specific behavior on element data.
2. **Framework-agnostic core:** engine crates must not depend on React, Vue, Tauri, DOM APIs, or host rendering APIs.
3. **Single source of truth:** document state has one authoritative owner. UI/host state may hold transient interaction state, but must not become a competing persistent document model.
4. **Explicit transitions:** document mutation, command execution, event notification, cache invalidation, and rendering invalidation need explicit contracts.
5. **Instance-scoped state:** multiple editors/documents must not unintentionally share mutable state.
6. **Deterministic host boundary:** host integrations consume a documented protocol and render model rather than internal Rust domain structs.
7. **Measured performance:** optimize based on workload and measurement, preserving correctness and clear invariants.

## 3. Workspace responsibilities

Use the workspace manifests and `crates/README.md` as the authoritative, current crate inventory. The expected responsibilities are:

| Crate/area | Responsibility boundary |
|---|---|
| `grafalith-geometry` | Pure geometry, transforms, bounds, hit testing, spatial queries, snapping, viewport math, and related algorithms |
| `grafalith-core` | Document domain, editor/session state, operations, commands, and history |
| `grafalith-io` | Versioned document interchange, import pipeline, clipboard codecs, and export descriptors |
| `grafalith-bindings` | Host-facing engine facade, protocol serialization, and DTOs |
| `grafalith` | npm/WASM wrapper and distribution target |
| `grafalith-python` | Python/PyO3 wrapper and distribution target; Cargo package name comes from its manifest |
| `grafalith-sdk` | Rust consumer/extension-facing SDK |
| `grafalith-text` | Text measurement and shaping support |
| `grafalith-pptx` | PPTX-specific presentation interchange, if present in the current workspace |
| `apps/desktop` | Tauri host/reference application; host input, UI, and rasterization integration |
| `packages/grafalith-sdk` | TypeScript consumer SDK and related host-side helpers |

Do not assume a dependency edge from this table. Read Cargo manifests and the workspace dependency tests before changing crate dependencies. Preserve the documented dependency direction and update `crates/README.md` when responsibilities change.

## 4. Domain state and mutation

- Document elements remain plain data; their rendering and behavioral operations are implemented separately.
- Persistent geometry is expressed in scene/document coordinates. Screen-to-scene and scene-to-screen conversion belongs at the input/render boundary.
- All persistent element/document mutations must pass through `Document`, which owns the established version/nonce and invalidation rules.
- User-visible mutations are represented by the established `Command` mechanism and executed through `HistoryManager`.
- Each user operation must be atomic and produce one undoable history entry when it changes persistent state.
- Mutation follows the established validate-then-store flow. An invalid operation must not leave partial changes.
- Deletion uses the established soft-delete model (`isDeleted`) unless a separately approved contract change supersedes it.
- Document identity, element identity, parent/child relationships, z-order, and reference remapping must be based on stable IDs, not names or UI row indexes.

The Rust types and serialized field schema in the source are authoritative. Do not create a second hand-maintained TypeScript schema here. Public serialization and host representations belong in the relevant IO/protocol documentation and generated artifacts.

## 5. Groups, hierarchy, and lock semantics

The current documented behavior for organizational groups is:

- Groups are organizational containers without their own transform, clipping, effects, or paint unless the product model is explicitly changed.
- Grouping, ungrouping, and reparenting preserve scene-space geometry.
- A group must have at least two direct children. Empty or singleton groups dissolve within the triggering transaction, bottom-up, and survivors are promoted into the dissolved group's position.
- Lock is local plus inherited: a node is effectively locked if it is locally locked or has a locked ancestor. Locking a group does not overwrite child local-lock flags.
- Unlocking a group restores descendants to their own local-lock states.
- Direct canvas transforms require an effectively unlocked target. Translating an unlocked group may carry locally locked descendants as part of the group's inherited motion.
- Structural operations on a locally locked leaf may be allowed when explicitly supported, but a node must not escape a locked ancestor. The command/API is the authority for validation.
- Hit testing and direct manipulation must respect effective lock, while a Layers UI may still select a locked node for explicit unlock.

Any change to these semantics must update engine tests, host behavior, this contract, and relevant guides together.

## 6. Rendering and spatial queries

- The engine returns a deterministic `RenderModel` or the equivalent documented render data for hosts to rasterize.
- The core must not directly access the DOM, Canvas2D, or Tauri rendering surfaces.
- Hosts own the actual rasterization, scheduling, pointer event capture, and UI-specific overlays.
- Rendering order must be deterministic and consistent with the document's z-order contract.
- Viewport culling and spatial queries should use the established geometry/spatial-index infrastructure where appropriate.
- Cache invalidation must be driven by authoritative document/viewport changes; avoid separate invalidation state that can drift from the document.
- Batch high-frequency input updates and host painting where appropriate. Do not add polling or repeated full-document work as a substitute for a correct event/state contract.

Host-specific choices such as a dual-canvas implementation or requestAnimationFrame scheduling belong in the host/desktop design documentation, not as assumptions about the Rust core.

## 7. Commands, history, and events

- User intent is represented through the established command path rather than direct edits from host UI.
- One logical action maps to one atomic document mutation/history entry.
- Undo/redo must restore the exact relevant state, including hierarchy, ordering, references, and local lock flags.
- Events/subscriptions notify consumers of committed state changes according to the public Editor API contract.
- Event notification must not become a second mutation mechanism or a prerequisite that accidentally determines whether a command commits.
- Transient gesture/preview state must be distinguished from committed document state.
- Repeated or stale host events must not create duplicate mutations or undo entries.

Refer to the command guide and current API for exact command names, event payloads, and sequencing guarantees.

## 8. Host protocol and packages

- `grafalith-bindings` is the owner of the JSON-string host protocol.
- Wrapper crates such as the WASM and Python targets remain thin adapters around the bindings contract.
- Host adapters (Tauri commands, browser integrations, and Python integration) remain outside `grafalith-core`.
- Public contract changes require synchronized updates to the protocol source, code generator, TypeScript/Python generated files, tests, and command documentation.
- Do not pass internal Rust domain types directly across host boundaries; use the established DTO/protocol layer.

## 9. Persistence, imports, and compatibility

- Serialized documents must follow the versioned format and import pipeline already established by `grafalith-io`.
- Schema changes require an explicit compatibility/migration decision and tests for older supported documents.
- Clipboard and duplicate operations must remap IDs and internal references as required by their domain contract.
- Import validation must reject malformed or hostile inputs without panics or partial document corruption.
- Generated format descriptors or export plans must remain consistent with the actual host/export implementation.

## 10. Extensibility and customization

- Public extension points must be explicitly defined and documented; do not rely on consumers reaching into private modules.
- Custom behavior should compose through supported registration/configuration mechanisms rather than global mutable state or source forks.
- A consumer that does not use an extension must not pay avoidable per-frame or per-operation costs for it.
- Keep UI component overrides and layout decisions in the host/UI layer. The Rust core remains UI-framework agnostic.

## 11. Performance and safety constraints

- Avoid cloning the full document for a small local mutation unless the transaction/history design requires it and its cost is understood.
- Avoid repeated whole-scene scans in high-frequency pointer/render paths where indexes or targeted traversal can provide correct results.
- Optimize only with evidence and preserve deterministic results and cache invalidation correctness.
- Handle stale IDs, invalid indexes, non-finite geometry, malformed protocol payloads, and repeated host commands without panics.
- Document non-obvious safety, concurrency, cache, and complexity invariants close to the code when needed.
- Run workspace checks and workload-relevant tests/benchmarks for changes to hot paths.

## 12. Changing this contract

Before changing an established boundary:

1. Inspect the current implementation and tests.
2. State the problem with the current contract and the alternatives considered.
3. Explain compatibility, correctness, performance, and migration impacts.
4. Obtain maintainer approval where required by `AGENTS.md`.
5. Update code, tests, bindings, documentation, and examples in the same change.

If an older paragraph contradicts the current Rust source or generated protocol, do not silently choose whichever is easier. Record the discrepancy and reconcile the contract deliberately.
