# Grafalith Design Notes

> Verified against the current repository. Every claim below was checked
> against source, manifests, tests, or generated bindings; file:line
> pointers name the authority. Where this file summarizes a rule owned
> elsewhere, it links to the canonical document instead of restating it.

## 1. Purpose and status

- **Purpose:** Describe the implementation design that matters for
  understanding, extending, and debugging Grafalith: module boundaries,
  document lifecycle, command/history flow, render flow, host protocol,
  failure handling, and the reasons behind durable decisions.
- **Status:** Verified (against the working tree; the tree carries
  uncommitted changes on top of the commit below, so re-verify after the
  next commit)
- **Last verified against commit:** `7e2a367d7be86a1ae699db22f99fba0601332a26` (HEAD; working tree dirty — see report)
- **Maintainer:** Not recorded in the repository (see repository owners).
- **Scope:** Rust engine workspace (`crates/*`), Tauri+React reference
  host (`apps/desktop`), TypeScript SDK (`packages/grafalith-sdk`),
  command generator (`scripts/gen_command_bindings.py`) and its generated
  targets. Examples (`examples/*`) are out of the workspace on purpose.

This file complements, rather than replaces:

- `AGENTS.md` — instructions for AI coding agents.
- `README.md` — project introduction and entry points.
- `docs/PRD.md` — product requirements and scope (intent, not status).
- `docs/ARCHITECTURE.md` — cross-crate invariants and technical contracts.
- `DEVELOPMENT.md` — local development and verification.
- `crates/README.md` — crate map, dependency direction, core invariants.
- `docs/guides/commands.md` — per-command wire reference (source of truth
  for command shapes is `crates/grafalith-bindings/src/protocol.rs` plus
  `scripts/gen_command_bindings.py`).

## 2. Product and use-case context

Only the Design workflow has a full document/session implementation in
the engine. Slides exists as interchange scope plus a stage-1 exporter;
Whiteboard reuses the infinite-canvas design document, with no dedicated
domain types.

| Workflow | Document model | Main interactions | Mode-specific responsibilities |
|---|---|---|---|
| Design | Core `Document`: 11 element variants, groups, frames, z-order, `CanvasMode::{Infinite, Bounded}` (`crates/grafalith-core/src/element.rs:880-903`, `canvas_mode.rs:16-28`) | Select, draw, transform, align/distribute, boolean ops, text/pen/crop/path sessions, clipboard, undo/redo | Everything the engine implements today. |
| Slides | No presentation/slide domain types in core (verified: no `Slide`/`Presentation` domain struct outside `grafalith-pptx` packaging) | Blank-deck `.pptx` export via `SlideDeck`/`SlideSize`/`SlideSpec` (`crates/grafalith-pptx/src/presentation.rs:28-82`) | `grafalith-pptx` owns OPC/ZIP framing and slide XML; element→shape mapping is an explicit next stage (`docs/guides/slides.md:3-7`). |
| Whiteboard | Same core `Document` on `CanvasMode::Infinite` (default, `canvas_mode.rs:30-34`) | Free placement, arrows with bindings (`BINDING_THRESHOLD = 20.0`, `arrow_binding.rs:23`), pan/zoom over large scenes | No whiteboard-specific model; connectors are arrow elements with bindings, not a separate relationship domain. |

Shared by the engine: geometry, document storage, commands/history,
selection, lock/group/hierarchy rules, render-model construction, import
pipeline, host protocol. Mode-specific: slide packaging (pptx crate),
canvas bounds painting (render model + host veil), host chrome.

## 3. Repository and module map

Built from `Cargo.toml` (`members = ["crates/*", "apps/desktop/src-tauri"]`,
`exclude = ["examples/*"]`) and the per-crate manifests. Dependency
direction is bindings → io → core → geometry; wrappers depend only on
bindings (verified in each `Cargo.toml`; `crates/README.md` owns the
diagram).

| Module/crate/package | Responsibility | Public boundary | Important dependencies |
|---|---|---|---|
| `crates/grafalith-geometry` | Pure 2D math: points, bounds, segments, transforms, path math, hit testing, box booleans, `SpatialGrid`, snapping, viewport (`src/lib.rs:1-47`) | Internal pure functions; no document/session/host types | None (dev-only `proptest`) |
| `crates/grafalith-core` | Document domain, editor session, elements, selection, gestures, commands/history, hierarchy/groups/lock/z-order, render-model construction, assets/clipboard domain logic | Rust API consumed via bindings; never exposes host types | `grafalith-geometry`, `i_overlay` (WASM-safe, default-features off) |
| `crates/grafalith-io` | Versioned scene interchange (`export_str`/`import_str`/`import_str_tracked`), clipboard codec, raster export descriptors, optional SVG import (`src/pipeline.rs`, `clipboard_codec.rs`, `svg.rs` behind `svg` feature) | Strings + pure descriptors in/out; mutations go through core | `grafalith-core`, `serde/serde_json`, optional `usvg 0.48` |
| `crates/grafalith-bindings` | Host-facing `Engine` facade, JSON-string protocol (`BatchOp`, DTOs), command dispatch, `PROTOCOL_VERSION` | The public protocol boundary (`src/protocol.rs:1-17`) | `grafalith-core`, `grafalith-io`, `serde/serde_json`, `wasm-bindgen`; `svg = ["grafalith-io/svg"]` |
| `crates/grafalith` | WASM/npm distribution (`@fazelstudio/grafalith`), `cdylib`, `publish = false` | `wasm-bindgen` exports mirroring the bindings glue | `grafalith-bindings` only (no direct core dep) |
| `crates/grafalith-python` | Python/PyO3 distribution (`grafalith` on PyPI; Cargo package name `grafalith-py`), manual `py<->json` conversion, non-finite floats rejected | `PyEngine` + `PROTOCOL_VERSION` in `_grafalith` module | `grafalith-bindings`, `pyo3 0.29`, `serde_json` |
| `crates/grafalith-sdk` | Rust extension facade (re-exports core extension seams; `EXTENSION_PROTOCOL_VERSION = 1`) | Stable extension-facing API only | `grafalith-core` only (enforced by test) |
| `crates/grafalith-text` | Experimental `parley`-based measurement behind the core `TextMeasurer` seam; core default stays `FallbackMeasurer` | Opt-in measurer | `grafalith-core`, `parley 0.11` |
| `crates/grafalith-pptx` | Stage-1 `.pptx` export: hand-written ZIP/CRC32/base64/XML + `flate2`/`quick-xml`; blank slides only | `build_package(deck) -> Vec<u8>`, `PptxExporter` (base64 string over the exporter contract) | `grafalith-core`, `flate2` (rust backend), `quick-xml` (no default features) |
| `apps/desktop` (`@fazelstudio/desktop`) | Tauri+React reference host: input translation, Canvas2D painting, chrome, projects, `.grlt` extension hosting | Tauri commands (JSON strings) + React UI | `grafalith-bindings` through `src-tauri` only |
| `packages/grafalith-sdk` (`@fazelstudio/grafalith-sdk`, private) | TypeScript consumer SDK: `EngineClient`, typed `SdkBatchOp`, extension registries, `grafalith.*` facade | `EnginePort{apply_batch, element_count}` | Generated `protocol.generated.ts` (no engine dep) |

Dependency direction and the "thin wrapper" rule are enforced by
construction (wrappers delegate to `Engine::apply_batch` JSON strings)
and documented in `crates/README.md` and `docs/ARCHITECTURE.md`
(sections 3 and 8). Exact edges: read the individual `Cargo.toml` files.

## 4. High-level architecture

Runtime components and where they execute:

```text
React UI (renderer process)          Tauri native host            Rust engine
─────────────────────────          ──────────────────          ─────────────
Canvas.tsx: pointer/key/wheel  ──► Tauri commands (JSON String) ──► Engine::apply_batch
  textarea overlay (IME)       ◄── JSON String results ──────────  Editor + HistoryManager
drawModel.ts: Canvas2D paint   ◄── renderModel/sessionState ─────  Document + RenderModel
projects/extensions/i18n             AppState{Mutex<Engine>}        SpatialGrid (derived)
                                     projects.rs / extensions.rs   Clipboard / AssetStore seam
```

One `Engine` per application instance behind Tauri managed state; the
lock is never held across `.await`
(`apps/desktop/src-tauri/src/lib.rs:20-27`). The Python and WASM
wrappers each own their `Engine`/`JsEngine` the same way
(`crates/grafalith-python/src/lib.rs:28-36`).

### 4.1 Ownership boundaries

- Persistent document state: `Document` in
  `crates/grafalith-core/src/document.rs:164-189` — `elements` map
  (including tombstones), `order` (back-to-front z-order), `groups`,
  `labels`, `scene_nonce`, owned `SpatialGrid`, `order_version` plus a
  lazily built `order_ranks` cache. Single mutation authority is
  `Document::upsert` (`document.rs:692-728`).
- Transient interaction/gesture state: `Editor` (`editor.rs:189-218`)
  owns pointer phase, pending group-collapse, drill-in, text/pen/crop/
  path sessions, snap guides, and the drainable event queue. None of it
  serializes; snapshots cannot observe selection or sessions
  (`grafalith-io/src/pipeline.rs:25-28`).
- Selection and active tool state: `SelectionState`
  (`selection.rs:20`, ordered, deduped, never serialized) and
  `EditorState` (`editor_state.rs:30`: selection, active tool defaulting
  to `select`, enabled-tools allow-list, canvas mode, viewport). Tool
  activation is allow-list gated (`editor_state.rs:74-83`).
- Render model/cache state: `RenderModel::build(doc, viewport, config,
  is_image_ready)` is a pure function of its inputs
  (`render_model.rs:542-566`); `asset_generation` is the explicit
  invalidation root for async assets (`render_model.rs:487-505`);
  `RenderCache` in bindings holds one frame-poll entry
  (`render_dto.rs:1199-1336`). Hosts own all pixel caches.
- Host/UI state: DOM input translation, `screen = (scene + scroll) *
  zoom` conversion (`apps/desktop/src/render/coords.ts:18-32`), Canvas2D
  rasterization, cursors, ghost previews, textarea overlay, chrome,
  projects, persistence/autosave, i18n/theme. Hosts must paint element
  bodies from `frame + rotation` and use `bounds` only for
  culling/fit/hit extents (`apps/desktop/src/render/drawModel.ts`,
  `docs/guides/desktop.md:3-4`).

### 4.2 Data and event flow

Representative operation — dragging selected elements (deferred-commit
gesture, one history entry):

1. **Input entry:** `Canvas.tsx handlePointerDown (1057-1189)` maps CSS
   px → scene and sends `pointerDown{screen x,y,button,modifiers,
   clickCount} + sessionState` in one batch. Moves go through
   `handlePointerMove (1191-1338)`; live feedback uses read-only
   `previewMove` queries (same math as commit) plus host-painted ghosts.
2. **Validation and command boundary:** `pointerUp` dispatches through
   `Engine::apply_one` (`engine.rs:381-1063`); the gesture commits via a
   `MoveElements` command. Below-threshold movement commits nothing
   (`DRAG_THRESHOLD_PX = 4.0`, `gesture.rs:34`).
3. **Document mutation and history:** the command runs against
   `CommandContext`, which accumulates earliest-`before`/latest-`after`
   deltas; `HistoryManager::execute/transaction` pushes one atomic entry
   (`command.rs:277-406`, `history.rs:133-286`). Failed validation rolls
   back to `before` — never partial.
4. **Event notification and invalidation:** the commit bumps
   `scene_nonce` (`document.rs:861-863`), syncs the spatial grid
   (`document.rs:1144-1153`), and queues `EditorEvent`s drained via
   `drainEvents` (`editor.rs:479-481`). Events never gate the commit.
5. **Render update and host presentation:** the desktop watcher loop
   polls lightweight `sessionState` (carries `sceneNonce`) and refetches
   `renderModel + sessionState` only when the status key changes, then
   repaints one Canvas2D frame on `requestAnimationFrame`
   (`Canvas.tsx:502-899`). Idle canvases cost zero crossings.

Guarantees: one logical action → one atomic history entry; undo/redo
restores exact state via `restore_exact` (versions/nonces preserved, so
redo never drifts: `document.rs:833-858`, `command.rs:151-215`);
`commitDraw{requestId}` is exactly-once per press — repeats return the
stored id (`protocol.rs:275-295`); batches are **not** transactions —
each op is atomic, later ops (including queries) observe earlier ones,
and an unknown `op` fails the whole batch parse loudly instead of
dropping work (`protocol.rs:19-23, 977-980`).

## 5. Document model and invariants

Important invariants (not a struct copy — source is authoritative):

- Stable identity: `ElementId(String)` wrapper (`element.rs:47-88`);
  never index by position or name. Group ids share the type but never
  collide with element ids. Uniqueness is per-`IdGenerator` instance;
  merges must remap (clipboard/import rule). Default/test generator
  mints `el-N` / `group-N` from 1 (`element.rs:112-187`); production
  UUIDs are supplied at the binding layer.
- Coordinates and transforms: stored geometry is scene/document units
  (`element.rs:573-579`). Line/arrow/freedraw/path points are relative
  to the element origin (`geometry/src/point.rs:14-17`); absolute
  positions resolve at render/hit time. Screen↔scene conversion happens
  only at the host boundary (input events, viewport, render cull).
  Rotation is radians about the element center; `MIN_SIZE = 1.0`
  (`geometry/src/transform.rs:29`).
- Hierarchy/order: the `order: Vec<ElementId>` vector is the z-order
  truth (index 0 renders first / hits last). Groups are pure
  organizational containers — no transform, clip, or paint — so
  grouping never rewrites geometry (`document.rs:84-106`). Path↔parent
  consistency, no cycles, no self-parenting are validated
  (`document.rs:540-640`). Frames own children via `frame_id`; frame
  rotation is ignored by bounds (preserved quirk, `hit_test.rs:108-117`).
- Mutation/versioning: all persistent mutations pass through
  `Document::upsert` (validate-before-touch; existing ids get
  `version = prev + 1` with a fresh nonce; `scene_nonce` bumps on every
  stored change; `order_version` bumps only on order-shape change).
  Ghost writes to already-deleted ids move nothing.
- Deletion and restoration: soft-delete via `is_deleted`
  (`element.rs:619-620`); the map and `order` retain tombstones while
  grid/export/hit-test/snapshot exclude them. `hard_delete` exists only
  as a history primitive. Snapshots export visible elements with the
  full order (tombstones included for stable restore).
- Serialization compatibility: envelope
  `{schemaVersion, version, elements, elementOrder, groups, labels}`
  with `SCHEMA_VERSION = 1` owned by core (`document.rs:37-41`).
  Import is lenient-version / strict-data: version aliases resolve,
  unsupported versions reject, per-element failures skip-and-count, and
  zero valid elements rejects (`pipeline.rs:10-28, 231-291`).
  Referential repair (dangling `frame_id`/bindings → `None`,
  unknown groups, stale labels) is counted, never silent corruption
  (`document.rs:949-1103`).
- Lock/selection semantics: effective lock = local flag OR any locked
  ancestor (`document.rs:368-423`, 1024-step cycle guard). Locking a
  group never rewrites child flags; unlocking restores each
  descendant's own flag. Direct canvas transforms require an effectively
  unlocked target, except moving an unlocked group carries locally
  locked descendants as inherited motion. Canvas hit-testing skips
  effectively locked nodes; the Layers panel may still select them for
  explicit unlock (`docs/guides/commands.md:81-108`).
- Undo/redo: `HistoryManager` with `DEFAULT_MAX_STACK_SIZE = 100`
  (`history.rs:27`); explicit recording (not an observer);
  `begin/commit/cancel_transaction` merge multi-command gestures into
  one entry; redo clears on new non-empty push; empty commands preserve
  redo; `undo` auto-commits an open transaction while `redo` refuses
  mid-transaction; `destroy` detaches without recording.

User-visible requirements live in `docs/PRD.md`; cross-crate contracts
in `docs/ARCHITECTURE.md` — this file does not restate them.

## 6. Rendering and performance model

- Render output contract: deterministic `RenderModel{base, frames,
  viewport, asset_generation}` of `DrawEntry` values
  (`render_model.rs:45-61, 235-256, 531`). `DrawEntry::for_element`
  never panics and sanitizes non-finite input. Paint stays serializable
  (`PaintDesc`, never a canvas object). Instances render as boxes unless
  resolved through `build_with_registry`.
- Host rasterization and scheduling: hosts draw. The reference host uses
  a **single live Canvas2D + demand-driven `rAF` watcher** — explicitly
  not dual-canvas, not polled (`Canvas.tsx:502-899`, `427-437`):
  `sessionState` (cheap, carries `sceneNonce`) gates a full
  `renderModel + sessionState` fetch; a paint key skips caret/draft/
  panel-only repaints. PNG export uses a separate offscreen canvas
  (`exportPng.ts:58-76`); fixed (bounded) export uses the exact page,
  infinite export uses one-shot `planPngExport` bounds without touching
  the session.
- Viewport culling and spatial indexes: culling uses `viewport_bounds`
  over `Document::query_spatial` candidates filtered in document order
  (identical to a linear scan, z-order preserved). The `SpatialGrid`
  (`DEFAULT_CELL_SIZE = 200.0`, `spatial.rs:17-28`) is a derived cache
  owned by `Document`, synced on every mutation, with a `rebuild_spatial`
  recovery tail after imports. Candidate contract: false positives
  allowed, never false negatives.
- Cache keys/invalidation: `scene_nonce` (document changes),
  `order_version` (order shape), `asset_generation` (async assets),
  viewport + `RenderConfig` (canvas size, grid hint, ready images).
  No parallel invalidation state may drift from the document
  (`docs/ARCHITECTURE.md` section 6).
- High-frequency interactions: pointer moves use transient gesture state
  plus read-only `previewMove/previewResize/previewRotate` queries and
  host ghosts; exactly one commit per gesture. Wheel events coalesce to
  one op per frame (`Canvas.tsx:548-583`). Zoom clamps to `0.1–10`
  (`viewport.rs:16-19`).
- Performance-sensitive operations: indexed hit-test, filtered render
  builds, batched moves, undo/redo over 1k elements, and import/export
  are covered by `crates/grafalith-core/benches/scale.rs` (1k/10k/100k/
  1M), `crates/grafalith-io/benches/scale.rs`,
  `crates/grafalith-bindings/benches/poll.rs` (cached-hit vs
  uncached-miss, validating the watcher strategy), and
  `crates/grafalith-core/tests/benchmark_model.rs` (phase-10 timing).
- Benchmarks: run via `cargo bench` / `cargo test`; see
  `DEVELOPMENT.md`. The PRD targets (5,000+ elements at 60 FPS,
  <16 ms frame prep, <5 ms hit-test, <150 KB gzipped core, <500 ms
  cold start — `docs/PRD.md` section 7.1) have harnesses but **no
  recorded baseline, hardware, or acceptance thresholds in the repo**;
  this document claims none of them as met (open item R-006).

## 7. Public API, protocol, and generated code

- Public Editor/API facade: `Engine` in
  `crates/grafalith-bindings/src/engine.rs:78-85`
  (`{editor, clipboard, asset_generation, render_cache}`), instance-
  scoped, no globals. Single-op dispatch `apply_one` plus batch
  `apply_batch`/`apply_ops`. Read-only queries (`sessionState`,
  `renderModel`, `preview*`, `exportScene`, `planPngExport`,
  `contextMenu`, `drainEvents`) never touch history.
- Host protocol: `grafalith-bindings` owns the JSON-string protocol;
  `PROTOCOL_VERSION = 1` (`protocol.rs:17`), echoed in `BatchResult`,
  `ErrorEnvelope`, and `EngineStatus` for skew detection. Wire `op`
  strings are frozen (protocol v1, additive growth only). **88 wire ops
  with the `svg` feature (87 base + `importSvg`); 87 without it**
  (`BatchOp`, `protocol.rs:26-669`; `op_name`, `protocol.rs:1129-1221`).
  Per-op results are `{op, ok, code?, message?, data?}` with stable codes
  `invalidInput | notFound | invariantViolation | unsupported` mapped
  from `EngineError` (`protocol.rs:1071-1079`), plus transport codes
  `parseError | serializeError` (`protocol.rs:991-1005`); unknown Rust
  errors fall back to `engineError`. No core domain struct serializes
  directly across the boundary (`render_dto.rs:1-11`).
- Code generation: `scripts/gen_command_bindings.py` is the single
  source of truth for command signatures (`COMMANDS`, 88 entries,
  `EXPECTED_COUNT = 88`). It generates `generated/grafalith-commands.d.ts`
  (`BatchOp` union + `JsEngine`), `generated/grafalith.pyi` (`Engine`
  stub + `COMMAND_IDS`), and
  `packages/grafalith-sdk/src/protocol.generated.ts` (`SdkBatchOp`).
  `bun run verify:bindings` (`--check`, CI) fails on drift against
  `protocol.rs::op_name`; `bun run verify:docs` checks documentation
  consistency.
- Extension/customization boundaries: native Rust extensions via
  `ShapeExtension` / `CommandExtension` / `Serializer` /
  `ExporterExtension` seams plus `ExtensionRegistry`
  (`extension.rs`, `shape_extension.rs`, `command_extension.rs`,
  `serializer.rs`); dynamic dispatch over the protocol via
  `executeCommand` (`extension.execute`); desktop `.grlt` packages with
  manifest validation (`apps/desktop/src-tauri/src/extensions.rs`,
  `packages/grafalith-sdk/src/manifest.ts`). Registrations are
  instance-scoped and return `Disposable`s. The TS SDK (`EngineClient`
  over `EnginePort`, registries, `grafalith.*` facade) is the primary
  consumer SDK; the Rust `grafalith-sdk` crate is the native facade.
- Compatibility policy: additive changes preferred; wire names frozen;
  `PROTOCOL_VERSION` bumps only with an explicit breaking-change note;
  public changes ship protocol source + generator + generated files +
  tests + command guide together (`docs/ARCHITECTURE.md` section 8).

## 8. Failure handling and lifecycle

- Invalid input and failed mutations: typed `EngineError`s
  (`error.rs:14-32`, `#[non_exhaustive]`) surface as per-op
  `{ok:false, code, message}` without partial state (validate-then-
  store + rollback). Malformed scene/SVG payloads reject without panics
  or partial corruption; hostile inputs are counted as skips or rejected
  (`pipeline.rs`, `svg.rs:228-230`).
- Cancellation, stale events, duplicates, ordering: `pointerCancel`
  (including outside-canvas release), `Escape`, tool-switch, and blur
  cancel gestures idempotently with no mutation; below-threshold drags
  commit nothing; `commitDraw{requestId}` dedupes transport retries;
  `apply_batch` never fails as a whole — parse failure returns an
  `ErrorEnvelope` string. Stale host polls are discarded by generation
  guards and a serialized input queue preserves DOM order
  (`Canvas.tsx:255-267, 619-630`).
- Listener/subscription cleanup: engine events drain from a queue
  (`mem::take`, `editor.rs:479-481`); every `grafalith.*` registration
  returns a `Disposable` auto-disposed on extension deactivate
  (`packages/grafalith-sdk/src/disposable.ts`,
  `extensionHost.ts` deactivation path). Tauri `Mutex<Engine>` is never
  held across `.await`.
- Undo/redo and document disposal: undo/redo restore exact snapshots
  (hierarchy, order, references, lock flags); extension storage lives
  under `<app_data>/extension-storage/<id>.json`; project writes are
  atomic temp-file + fsync + rename with backup retention, and newer
  envelopes are rejected, never overwritten (`projects.rs:47-123`).
- Import/export failure and malformed documents: staged pipeline
  (parse → version → validate → repair → candidate → commit) leaves the
  document untouched until commit; export of empty scenes reports
  `No elements to export`; non-finite bounds report explicitly.
- Resource cleanup and bounded caches: history capped at 100 entries;
  one-entry render cache; spatial grid evicts tombstones; raster export
  clamps to `PNG_MAX_DIMENSION = 4096`; Canvas effect teardown cancels
  `rAF`/listeners/timers and invalidates in-flight previews
  (`Canvas.tsx:880-898`); extension activation/deactivation timeouts are
  5000/3000 ms with per-extension toast + output channel and partial
  dispose on failed activation.

Reference-host budgets that are verified in code (not engine
contracts): single `RETRY_POLL_MS = 250` frame retry, error surfacing
after 300 consecutive failures (last good pixels stay), autosave debounce
default 2000 ms (tunable 250–30000), text caret grace 250 ms.

## 9. Design decisions

| ID | Decision | Status | Reason/constraints | Alternatives considered | Evidence/tests |
|---|---|---|---|---|---|
| D-001 | JSON-string protocol owned by `grafalith-bindings`; wrappers stay thin adapters | Accepted | Deterministic host boundary; no Rust internals leak; single skew-detection version | Shared structs / direct FFI types | `protocol.rs:1-17`; `verify:bindings`; `command_coverage.rs` |
| D-002 | Validate-then-store; one logical action = one atomic history entry | Accepted | Undoable, corruption-free editing; redo never drifts | Observer/event-sourced history | `command.rs:277-420`; `history.rs:133-286`; `document.rs:833-858` |
| D-003 | Soft-delete tombstones retained in map + order | Accepted | Stable undo/restore and snapshot round-trips; grid/export/hit exclude them | Immediate removal + index rebuild | `document.rs:228-250, 730-771`; snapshot tests |
| D-004 | Groups are geometry-neutral containers; <2-child groups dissolve bottom-up in the triggering transaction | Accepted | Predictable Layers behavior; grouping never moves pixels | Transform-bearing groups | `group.rs:19-90`; `document.rs:84-106`; group tests |
| D-005 | Effective lock = local flag OR locked ancestor; child flags never rewritten | Accepted | Unlock restores prior state; group motion can carry locked children | Recursive flag writes | `document.rs:368-423`; `lock.rs`; `hierarchy.rs:62-80` |
| D-006 | Engine returns deterministic `RenderModel`; hosts rasterize; paint from `frame + rotation` | Accepted | Framework-agnostic core; identical bytes for identical inputs | Core-owned canvas / dual-canvas contract in core | `render_model.rs:542-566`; `bindings/benches/poll.rs`; `drawModel.ts` |
| D-007 | `SpatialGrid` is a derived cache owned by `Document`, never a second truth | Accepted | Correct culling/hit-test without drift | Parallel index maintained by callers | `spatial.rs:6-11`; `document.rs:1144-1194`; `scale.rs` benches |
| D-008 | Instance-scoped state; injectable `IdGenerator`; no mutable globals | Accepted | Multi-document hosts (Tauri, Python, tests) must not share state | Global counter / singleton engine | `element.rs:90-110`; `AppState{Mutex<Engine>}`; `PyEngine{inner}` |
| D-009 | Protocol v1 wire names frozen; additive growth; version bump only with breaking-change note | Accepted | Hosts detect skew instead of silently dropping work | Free-form evolving schema | `PROTOCOL_VERSION`; `op_name`; generator + `--check` |
| D-010 | `svg` (and text-shaping) behind Cargo features; default builds stay lean | Accepted | Base WASM pays no usvg/parley cost | Always-on import stack | `grafalith-io/Cargo.toml:13-31`; `svg.rs:1-19` |

## 10. Risks and open questions

| Item | Impact | Evidence available | Next verification needed |
|---|---|---|---|
| R-001 (fixed here) — `command_coverage::all_ops` omitted `planPngExport`, so the test pinned 86/87 unique names while the protocol has 87/88 | Correctness (coverage gap, not a runtime bug) | `command_coverage.rs:44-153` (pre-fix); `engine.rs:947-957` dispatch existed | Fixed in this change: op added, counts 99/100 occurrences and 87/88 unique; run `cargo test -p grafalith-bindings --test command_coverage` |
| R-002 (fixed here) — stale "87" counts in `commands.md` header, generator docstring/templates; `svg.rs` doc claimed `svg-1…` ids while code mints `el-1…` | Compatibility/docs drift | `protocol.rs::op_name` (88 arms incl. svg); `CounterIdGenerator::new` (`element.rs:132-142`) | Fixed in source comments/guide; regenerate bindings (`gen_command_bindings.py`, needs Python — unavailable in this env, see R-006) |
| R-003 (fixed here) — `svg` feature did not compile: `svg.rs` built `DocumentSnapshot` without the `labels` field added by the hierarchy/labels work | Build breakage in a non-default feature | `svg.rs:75,107` (pre-fix); `pipeline.rs:292-302` shows the complete literal | Fixed in this change (`labels: vec![]`, matching the content-replacing import semantics); verified with `cargo test -p grafalith-io --features svg` (28 + 3 passed) and `cargo clippy --features svg` |
| R-004 — No slide/presentation domain (ordering, navigation, per-slide content rules); Slides = blank-deck export stage 1 only | Product scope vs implementation status | No `Slide`/`Presentation` domain types in core; `docs/guides/slides.md:3-7`; PRD 6.2 vs status disclaimer (PRD 10) | Do not build a slide model without an approved design; keep PRD scope vs status separated |
| R-005 — Whiteboard connectors/relationships (PRD 6.3) exist only as arrow bindings (`BINDING_THRESHOLD = 20.0`); no dedicated relationship domain | Product scope | `arrow_binding.rs`; PRD 6.3 | Same as R-003: needs approved design before extending the model |
| R-006 — PRD performance targets (7.1) have harnesses but no recorded baseline/hardware/thresholds | Performance claims unverifiable | `benches/scale.rs`, `benches/poll.rs`, `tests/benchmark_model.rs`; no baseline file | Record bench environment + baseline + regression thresholds before claiming any target met |
| R-007 — Python-based checks (`verify:bindings`, `verify:docs`, binding regeneration) could not run here: no Python interpreter in this environment | Verification gap for this change | `package.json:26-28`; generator templates edited, outputs not regenerated | Re-run `bun run verify:bindings`, `bun run verify:docs`, and regenerate `generated/*` + `protocol.generated.ts` where Python exists |
| R-008 — Preserved quirks that future work must know: frame rotation ignored by bounds; freedraw hit-tests raw chords vs smoothed render; instance-as-box without registry; edge-touching boxes don't intersect (rejected downstream by `MIN_SIZE`) | Correctness of future geometry/render changes | `hit_test.rs:17-28, 108-117`; `boolean.rs:23-42` | Keep covered by tests; call out explicitly in any render/hit-test redesign |

## 11. How to maintain this document

When a coding agent updates this file:

1. Read `AGENTS.md` and the task-relevant references first
   (`docs/ARCHITECTURE.md`, `docs/PRD.md`, `crates/README.md`,
   `docs/guides/commands.md`, `DEVELOPMENT.md`).
2. Explore the workspace manifests, source, protocol generator, generated
   outputs, and tests before writing architectural claims — trace at
   least one representative operation end-to-end.
3. Compare every claim with current source, tests, and generated
   bindings; cite `path:line` for load-bearing facts.
4. Resolve contradictions explicitly (e.g. count drifts like R-001/R-002);
   never silently change product requirements or established contracts —
   per `AGENTS.md` section 7, consequential changes need maintainer
   approval with a recorded trade-off.
5. Keep details in their canonical file and link from here; do not
   duplicate long rules or restate every struct.
6. Remove placeholders that do not apply; never present speculation as fact
   (open items belong in section 10 with evidence and next steps).
7. Run the checks relevant to the change (`cargo test`, `cargo clippy`,
   `cargo fmt --check`, plus `verify:bindings` / `verify:docs` /
   `i18n:verify` when those surfaces change) and report exactly what ran
   and what could not run.
