# PRD — OpenNary

**Product Requirements Document**
Status: v4 (Professional-Grade) · Owner: (fill in your name) · Last updated: 2026-10-01

---

## 1. Summary

OpenNary is a **professional-grade 2D canvas engine for design & prototyping** (Figma/TLDraw/Excalidraw class), built as a headless library that can be embedded into other applications. The product goal has evolved over time — brief history:

- **v1-v2**: Lightweight canvas engine like Excalidraw/TLDraw with basic drawing + full customization (theme, UI overrides, custom shapes).
- **v3**: Headless architecture — the engine can be used fully without any built-in UI, through a public `Editor` API + event system.
- **v4 (current)**: Step up to a **professional engine** — every feature's behavior must match established tools (Figma/TLDraw) exactly, plus professional-class features (vector path editing, boolean operations, component/instance system, constraints & auto-layout), plus support for infinite OR bounded canvas.

Core principles remain the same across all versions:

1. **Lightweight** — small bundle size, no heavy framework dependency for the core engine.
2. **Efficient** — handles thousands of elements without frame drops, low memory footprint.
3. **Feature-rich on par with professional tools** — no longer "enough for basic drawing" (v1), but approaching Figma/Illustrator capability for design & prototyping needs (see §4 and §12).
4. **Behavior conformance** — every interaction must feel familiar to users already used to professional design tools, not just "functional".

## 2. Problem Being Solved

Tools like Excalidraw/TLDraw are good, but:
- Hard to embed lightly into other applications without carrying many dependencies.
- Their data structures & rendering are optimized for their general use case, not our specific needs.
- We want an engine we **fully understand** — easy to extend, easy to debug, not a black box.

## 3. Target Users

- **Primary**: Developers (including the makers of this product) who want to embed canvas drawing into their own applications.
- **Secondary**: End users who use the resulting embedded application to create simple diagrams/sketches/wireframes.

## 4. Feature Scope (v1)

> **Status: v1 is complete.** The scope below is the baseline that has been implemented. For v2 features (element organization, precision tools, image/media, and the **Customization API**), see §4.5.

### 4.1 Must Have — v1, DONE
- [x] Basic shapes: rectangle, ellipse/circle, line, arrow, freehand draw (pen)
- [x] Text element (with in-place editing)
- [x] Single & multi select (rubber-band selection)
- [x] Move, resize, rotate elements
- [x] Copy, paste, duplicate, cut, delete
- [x] Style: solid colors, gradient colors (linear), border (width, style: solid/dashed), fill opacity
- [x] Undo/redo
- [x] Pan & zoom (infinite canvas)
- [x] Grouping/ungroup elements
- [x] Layering (bring to front/back, send forward/backward)
- [x] Export to PNG and JSON (scene serialization)
- [x] Import from JSON

### 4.2 Should Have
- [x] Crop for image element
- [x] Arrow binding (arrow sticks to & follows connected elements)
- [x] Snap-to-grid / snap-to-object while dragging
- [x] Standard keyboard shortcuts (Ctrl+C/V/D/Z/Y, Delete, Arrow keys for nudge)
- [x] Alignment tools (align left/center/right, distribute)

### 4.3 Nice to Have (v2+, not v1 priority)
- [ ] Real-time collaboration (multiplayer)
- [x] Image upload & embed
- [x] Custom shape extension API
- [x] Component library/templates

### 4.4 Explicitly Out of Scope
- Real-time collaboration (CRDT/sync complexity is separate from core rendering — do not mix before the foundation is solid)
- 3D rendering / full WebGL pipeline
- Mobile native app (web-first; touch-friendly but not native)

### 4.5 v2 Scope — Professional Features & Customization API

Added after v1 evaluation: the engine was functional but did not "feel professional" compared to TLDraw/Excalidraw/Figma, and could not be customized by consumers (developers embedding this engine). v2 closes both gaps:

**A. Full Customization** (highest priority — see §10)
Developers embedding OpenNary must be able to change theme, icon set, color picker, font, UI size/position, and add/replace shapes themselves — **without forking the engine source code**. This is not an ordinary feature, it is an architecture layer that affects how all other features are built.

**B. Element organization**: grouping/ungroup, layer management, lock elements, frame/container.

**C. Precision tools**: alignment (left/center/right/distribute), snap-to-grid, snap-to-object, smart guides, numeric input for position/size/rotation.

**D. Image & media**: upload/paste/drag-drop images, crop, resize with aspect-ratio lock.

**E. Scalability & robustness**: schema versioning for old files, large-paste handling.

## 5. Performance Targets (Non-Negotiable)

This is not aspiration — it is a **pass/fail criterion** that must be verified with real profiling, not assumptions:

| Metric | Target |
|---|---|
| Elements in scene before FPS drops below 60fps during pan/zoom | ≥ 5,000 elements |
| Render time for 1 frame (viewport culled) | < 16ms |
| Hit-test (click to select) on a 5,000-element scene | < 5ms |
| Core engine bundle size (without UI wrappers) | < 150KB gzipped |
| Time from cold start to interactive canvas | < 500ms |

## 6. Architecture Principles (Summary — details in ARCHITECTURE.md)

1. **Core engine framework-agnostic.** Canvas logic (scene, rendering, hit-test) is written in Rust, independent of React/Vue. UI toolbar can use any framework in a separate layer.
2. **Render as data** — the engine produces a deterministic `RenderModel` (culled, z-ordered draw entries); hosts rasterize (Canvas2D, Skia, etc.).
3. **Data-oriented, not over-object-oriented.** Elements are plain serializable data, not classes with embedded behavior.
4. **Command pattern history** — every mutation is one undoable, atomic step; inversion uses exact snapshots (no version drift).
5. **Instance-scoped state** — no global singletons; many engines coexist in one process (multi-canvas, multi-document).
6. **JSON-string host boundary** — Rust domain types never cross the host boundary; everything is typed in one versioned protocol.

## 7. Product Success Metrics

- Engine can be embedded into an example application (demo app) in < 30 minutes of setup by a new developer.
- All §4.1 features pass manual QA checklist.
- No performance regression below §5 targets after each completed phase.

## 8. Milestones & Work Order

1. Foundation — data types & project setup
2. Render model, viewport, camera
3. Shape primitives & hit-testing
4. Selection & transform (move/resize/rotate)
5. Style system (colors, gradient, border)
6. Text & arrow (+ binding)
7. Clipboard & history (undo/redo)
8. Spatial index, performance optimization, export/import
9. Customization API: Theme & Design Tokens
10. Customization API: UI Overrides (icons, components, layout)
11. Customization API: Custom Shape Registry
12. Element organization (grouping, layer, lock, frame)
13. Precision tools (alignment, snapping, smart guides, numeric input)
14. Image & media (upload, crop, resize)
15. Robustness (schema versioning, large-paste handling)
16. Public Editor API (stable contract for all engine operations)
17. Event/Subscription System (reactivity for external UI)
18. Headless Mode Audit & Independent Custom UI Example
19. Behavior Conformance Audit (MANDATORY first in v4)
20. Canvas Mode: Infinite vs Bounded
21. Path Editing & Boolean Operations
22. Component/Instance System
23. Constraints & Auto-layout

## 9. Research References

Architecture decisions in this document are based on study of:
- Excalidraw (dual-canvas architecture, sceneNonce cache invalidation, viewport culling) — https://github.com/excalidraw/excalidraw
- TLDraw (extensibility patterns — per-shape behavior + configure() for customization without subclassing, UI overrides separate from core, theme system) — used as the main reference for the v2 Customization API architecture.
- Spatial indexing research (grid hashing vs quadtree vs R-tree) for large-scale hit-testing.
- TLDraw's `Editor` API pattern (one public object as a stable contract for all operations, separate from React UI components that are merely "consumers" of the Editor) — used as the reference for headless architecture.

## 10. Full Customization Principles (v2 — Non-Negotiable)

This product requirement is **as important as the §5 performance targets**, not a complementary feature:

> Developers embedding OpenNary must have full control over the engine's default look and behavior — theme/colors, icons, fonts, color picker, UI element size & position, and shapes — **without forking or modifying the engine source code**.

Derived principles:
1. **No hardcoded values** for anything a developer might want to replace (colors, font, icon sizes, UI components) — everything must go through overridable tokens/config.
2. **Override through composition, not modification.** Developers pass config/props objects to the engine (`theme={...}`, `components={...}`, `shapeUtils={...}`), NOT by editing files in `node_modules` or forking the repo.
3. **Defaults must remain complete and good.** The Customization API must not force developers to fill in every configuration just to use the engine — all overrides are optional with sensible defaults.
4. **No performance burden for non-customizers.** Developers who do no customization must still get full §5 performance — the indirection layer for customization must not become permanent overhead.

## 11. Headless / Full Control Principles (v3 — Non-Negotiable)

**This is not an extension of §10, it is a deeper level of control.** §10 (v2) assumes developers still use the built-in UI and only replace parts of it. §11 (v3) assumes developers **may not use the built-in UI at all** — they build their own UI from scratch (React, Vue, vanilla JS, even native mobile via WebView) and only call engine logic.

> The engine must be 100% usable WITHOUT any built-in UI. Every capability a UI needs to function fully — creating elements, selecting tools, setting styles, undo/redo, knowing when something changed — must be available through one **documented, stable public Editor API**, not through internal functions that happen to be accessible.

Derived principles:
1. **The built-in UI is a CONSUMER of the Editor API, not the place where logic lives.** If there is logic only accessible through UI components (not through the `Editor` object), that is an architecture error that must be fixed.
2. **Full UI control means granular, not just component replacement.** Developers must be able: to enable/disable individual tools (not just replace the whole Toolbar), to place UI elements in free positions (not just choose from preset layouts), to style granularly per UI element, and to call engine operations from any custom UI trigger (custom buttons, custom gestures, custom shortcuts).
3. **Event system is mandatory** — headless architecture is useless if external UIs don't know when to re-render. The `Editor` must expose subscriptions for all relevant state changes (scene changed, selection changed, active tool changed, etc.).
4. **Proven with a real example, not claims.** The Definition of Done for the headless phase requires an example UI truly built from scratch WITHOUT the built-in UI, purely calling the engine.

## 12. Professional-Grade & Behavior Conformance Principles (v4 — Non-Negotiable)

This is a level shift, not just new features:

> OpenNary must no longer be enough to "work like a simple draw tool" — every interaction must feel EXACTLY THE SAME as conventions already established in professional design tools (Figma, TLDraw, Illustrator). New features (path editing, boolean ops, component/instance, constraints/auto-layout) must match the capability of those class tools, not simplified/limited versions.

Derived principles:
1. **Behavior conformance is NOT optional.** Before any new feature is added in v4, OLD features must be audited and fixed first so their behavior matches professional conventions — a shaky foundation makes new features on top feel foreign/unnatural.
2. **Behavior references are established tools, not new assumptions.** For every ambiguous interaction design decision, check how Figma/TLDraw/Illustrator handle it before deciding on your own — consistency with experienced users' expectations matters more than originality.
3. **Canvas mode flexible for derivative product needs.** Because OpenNary will be used to build web applications (not just used directly), the engine must support both infinite mode (whiteboard) AND bounded/artboard mode (fixed size, for needs like thumbnail editors, social media templates, etc.) — chosen by the developer at initialization.
4. **New features must not sacrifice §5 performance targets** — all features in §12 (especially boolean ops and component/instance which are computationally heavy) must keep large scenes (5,000+ elements) from dropping below 60fps for normal operations (heavy features like boolean ops may have their own reasonable latency for explicit operations, but must not burden the render loop/general interaction).

### New v4 Features

- **Path Editing & Boolean Operations**: vector pen tool (anchor + Bezier handle), union/subtract/intersect/exclude between any shapes.
- **Component/Instance System**: reusable components with instances auto-synced from the master, granular per-property overrides without locking other properties.
- **Constraints & Auto-layout**: constraints (pin/stretch/scale) for elements in normal frames when resized; auto-layout (flexbox-like) for frames that automatically arrange their children.
- **Canvas Mode**: choice of infinite (unbounded whiteboard) or bounded (fixed width×height, still freely zoomable/pannable) — determined at initialization.
