# Product Requirements — Grafalith

> This document defines product intent, requirements, boundaries, and acceptance expectations. It is not the source of truth for whether a feature is currently implemented. Verify implementation status against the code, tests, API/command reference, and release notes.

## 1. Product summary

Grafalith is a lightweight, framework-agnostic 2D graphics engine written in Rust. It is designed to be embedded into applications and to provide shared graphics/document capabilities without requiring consumers to use a particular UI framework.

The surrounding product includes three principal workflows:

- **Design** — visual design on an infinite canvas or a bounded/artboard-style canvas.
- **Slides** — presentation documents composed of ordered slides and slide-level visual content, including PPTX interoperability where supported.
- **Whiteboard** — open-ended spatial work for sketching, diagrams, and arranging connected ideas.

These workflows may reuse graphics primitives and editing infrastructure, but they do not have to share every document rule. Presentation navigation, whiteboard connections, and design-artboard behavior belong to their appropriate domain.

## 2. Goals

1. Provide a reusable 2D graphics foundation that can be embedded in different hosts.
2. Keep the core independent of React, Tauri, the DOM, and host-specific rendering APIs.
3. Support deterministic document operations, rendering data, and reproducible tests.
4. Preserve responsive interactions and bounded memory/resource use as document size grows.
5. Expose a documented, stable public API to Rust, JavaScript/WASM, Python, and other supported integrations.
6. Provide a practical path from basic canvas drawing to professional vector-editing capabilities without making every consumer pay for unused features.
7. Keep the Design, Slides, and Whiteboard workflows coherent while allowing mode-specific behavior where required.

## 3. Target users

- Developers embedding Grafalith into their own applications or building custom hosts.
- Users creating designs, visual documents, presentations, diagrams, and whiteboard content in applications powered by Grafalith.
- Contributors extending the engine, its file interoperability, or its host integrations.

## 4. Product principles

- **Lightweight:** avoid unnecessary runtime dependencies and work on hot paths.
- **Framework-agnostic core:** UI framework choices remain in hosts or optional integration packages.
- **Explicit state transitions:** document mutations, commands, event publication, and cache invalidation must have clear contracts.
- **One source of truth:** do not maintain competing document or hierarchy state in multiple layers.
- **Headless-capable:** all domain capabilities needed by a custom UI must be exposed through a documented engine API or protocol; UI components must not be the only place where core logic exists.
- **Composable customization:** allow supported customization through explicit configuration or extension points without global mutable state.
- **Undoable operations:** user-visible mutations should be atomic and undoable under the established history contract.
- **Behavioral consistency:** interactions should follow established graphics-tool conventions where applicable. When a convention is ambiguous, document the chosen behavior rather than claiming universal parity with another product.
- **Measured performance:** performance requirements must be verified with repeatable benchmarks, not assumptions.

## 5. Shared engine capability areas

The engine capability scope includes the following areas. Listing an area here defines product scope, not implementation status.

### 5.1 Document and element model

- Stable element identities and serializable element data.
- Shape and path primitives, text, image, line/arrow, and container-like elements as supported by the domain.
- Scene/document coordinate space, transforms, bounds, and geometry queries.
- Validation, versioning/invalidation, document lifecycle, and schema compatibility.

### 5.2 Editing and organization

- Single and multi-selection, hit testing, transforms, and selection-aware commands.
- Layers/z-order, group and ungroup, reparent/reorder, lock/unlock, frames/containers where supported.
- Clipboard operations such as copy, cut, paste, and duplicate, including remapping of identities and references.
- Atomic undo/redo with deterministic command semantics.
- Alignment, distribution, snapping, and precision controls.

### 5.3 Graphics and vector editing

- Fill, stroke, opacity, gradients, line styles, and other supported visual properties.
- Path construction and editing, anchor nodes and curve handles.
- Boolean/path operations such as union, subtraction, intersection, exclusion, division, and path splitting where supported.
- Masks, clipping, and effects only where the document model and renderer can define their behavior consistently.

### 5.4 Text, images, and rendering

- Text editing, measurement/shaping, alignment, and font-related behavior supported by the host contract.
- Image placement, crop, transform, and serialization/interchange behavior.
- Deterministic render data, viewport culling, spatial queries, cache invalidation, and host rendering integration.

### 5.5 Extensions and reuse

- Public APIs for supported custom shapes, tools, commands, serializers, or other extension points.
- Reusable components/instances and overrides if they are part of the accepted product design.
- Constraints and auto-layout for the document/container types that explicitly support them.

## 6. Workflow-specific requirements

### 6.1 Design

- Support free spatial placement on an infinite canvas and bounded/artboard-style documents where configured.
- Provide object-level selection, transform, hierarchy, and styling operations.
- Keep stacking order, grouping, locking, and export behavior deterministic.

### 6.2 Slides

- Represent a presentation and its ordered slides separately from the objects on each slide.
- Support slide insertion, deletion, duplication, reordering, and navigation in the presentation domain.
- Keep slide dimensions and object coordinates well-defined.
- Treat PPTX import/export as format interoperability, not as a substitute for the internal presentation model. Unsupported PPTX features must be preserved where practical or reported explicitly rather than silently discarded.

### 6.3 Whiteboard

- Support free spatial placement and navigation over a large or infinite canvas.
- Support diagram-like objects and relationships/connectors where required.
- Keep interactions responsive when the visible portion of a large document changes.

## 7. Non-functional requirements

### 7.1 Performance targets

The current target values are:

| Metric | Target |
|---|---:|
| Scene size for common pan/zoom interactions before sustained 60 FPS degradation | 5,000+ elements |
| Render preparation/render frame budget for the agreed benchmark | under 16 ms |
| Hit-test latency on a 5,000-element test scene | under 5 ms |
| Core engine bundle size without host UI | under 150 KB gzipped |
| Cold-start-to-interactive time | under 500 ms |

These targets are not self-verifying. The repository should define benchmark hardware/runtime, scene distribution, measurement method, warm-up, and regression thresholds in a dedicated performance guide or benchmark suite. Heavy explicit operations such as Boolean geometry may have separate latency budgets, provided they do not burden ordinary interaction/render paths.

### 7.2 Reliability and compatibility

- Invalid operations must fail predictably without partially corrupting document state.
- Generated bindings and protocol definitions must remain synchronized with their source of truth.
- Persistent formats must be versioned and migrated deliberately.
- Error results must be explicit at public host boundaries; do not leak internal Rust types through the protocol.
- Instances must not share mutable editor/document state unintentionally.

## 8. Out of scope unless separately approved

- Full 3D modeling/rendering pipeline.
- Native mobile applications as a separate platform deliverable.
- Real-time multiplayer/CRDT synchronization unless its domain, data model, and consistency requirements are separately approved.
- Any broad media-editing pipeline that requires a separate rendering architecture, unless added through a separately scoped product requirement.

## 9. Acceptance expectations

A feature is ready when:

1. User-visible behavior and edge cases are defined.
2. The domain implementation has one clear source of truth and follows established crate boundaries.
3. Success and failure cases are tested, including invalid input and interactions with history/state synchronization.
4. Performance-sensitive paths have complexity/resource implications considered; material claims are measured.
5. Public API/protocol changes, generated bindings, and relevant guides are updated together.
6. Host behavior is verified when the feature affects host input, rendering, or UI integration.

## 10. Implementation status and roadmap

Do not infer completion from this PRD. Keep implementation status, milestones, and work ordering in a separate roadmap or tracking artifact that is reconciled with the current source and tests. Update this PRD only when product requirements, priorities, or scope boundaries change.
