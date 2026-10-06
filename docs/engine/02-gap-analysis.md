# 02 — Gap Analysis (Phase 3)

Question: **is the current `crates/*` structure really that of a modern graphics
engine, and is it enough for the §0 targets (complete, CodeMirror-modular,
every capability behind a unique command, 60fps at 10k–100k nodes)?**

Verdict: **option 2 — EXPAND**. The structure is fundamentally right and must
**not** be reconstructed. Gaps are additive and close behind the existing seams
without breaking the acyclic DAG, the headless rule, or protocol v1.

Reasons (proven, not taste):

1. The layered diagram in the master brief (§4.1) already exists in the repo:
   bindings (JSON-string, codegen-ready DTOs) → engine facade (`Engine` +
   `Editor`) → tools/commands/history/selection/interaction → state/document
   (transactions, patches, change events) → geometry/path/spatial + layout/text
   → render abstraction (`RenderModel` trait-like DTO, backend-agnostic) → io
   (import/export, serialization, assets). `cargo tree` confirms the DAG;
   `cargo test` (500+) and `clippy -D warnings` are green.
2. Core never depends on renderer/binding/UI (single `nary-geometry` dep;
   `serde`/`wasm-bindgen`/`pyo3` only in `io`/`bindings`/wrappers — enforced by
   construction, though `workspace_wiring` should assert the whole DAG).
3. The CodeMirror-style pieces already exist in working form: `Plugin` trait +
   lifecycle + version check, `ShapeExtension`/`CommandExtension`/
   `SerializerExtension`, instance-scoped registries, `Custom` element variant,
   star shape+tool plugin example passing without touching core, command-based
   core where every intent is one atomic history entry, JSON-string protocol
   carrying the command list. What is missing is *completion*, not *redesign*
   (§3).
4. Performance foundations exist (owned `SpatialGrid` synced per mutation,
   viewport culling, rotation-aware bounds, dirty-check via `scene_nonce` +
   `asset_generation`, batch-per-crossing, read-only previews sharing commit
   math) with a measured 6.32× hit-test win at 5k. No evidence of a structural
   bottleneck that a rewrite would fix; the risks are scale-coverage (no
   10k/100k series, linear hit-test path, full-model rebuild per frame) and are
   addressable incrementally.

What option 2 means concretely: keep all six crates and their direction; add
capability **behind existing seams** (new `nary-core` modules or narrow new
crates only where the seam demands it, e.g. a future `nary-sdk` facade);
complete the command/extension registries; close the test/benchmark gaps. No
big-bang rewrite, no fallback branch needed — every step keeps build + tests
green because nothing structural moves.

Breaking changes required by this verdict: **none**. The dead `nary-core` dep on
`nary-python`, doc fixes, and registry completions are all non-breaking.
`PROTOCOL_VERSION`, `SCHEMA_VERSION`, and element interfaces stay frozen; any
future protocol growth is additive.

## 1. Capability checklist (per master §4.2)

Legend: ✅ present + tested · 🟡 partial · ❌ absent. Crate = where it lives or
should live.

**Document & scene**

| Capability | Status | Location / note |
|---|---|---|
| Hierarchical scene graph | 🟡 | Flat Map + `frameId`/`groupIds` parenting; no pages tree |
| Stable generational IDs | 🟡 | `String` ids + version/nonce, `IdGenerator` injectable; not slotmap-generational |
| Pages/canvases | ❌ | Only `Frame` + `canvas_mode` (infinite/bounded config) |
| Frame | ✅ | `frame.rs`, clip partition in render |
| Group | ✅ | `group.rs`, innermost-first, nested-safe ungroup, drill-in |
| Component/instance/variant | 🟡 | `components.rs`: define/resolve/overrides/cache/actions; no nesting beyond frame expansion, no variant system |
| Boolean group | ✅ | Exact rectangle ops (M2) + closed-path ops via flatten + `i_overlay` (M8, ADR-0020); holed results explicit `unsupported` |
| Mask/clipping | 🟡 | Frame `clip_content` partition only; no mask stack |
| Layers order (z-index/fractional) | 🟡 | Explicit `order` vector (not fractional index); reorder ops ✅ |
| Lock/hide | ✅ | `lock.rs`, `hidden` flag, filtered in cull/hit |
| Metadata/plugin data | 🟡 | `Custom{type_name, data}` opaque bag + `SerializerExtension`; no first-class metadata map |
| Serialization + schema versioning + migration | 🟡 | `nary-io` v1 envelope + repair; single version, no migration path exercised |

**Node/shape**

| Capability | Status | Note |
|---|---|---|
| Rectangle (per-corner radius) | ✅ | Per-corner `CornerRadii` + legacy single `roundness` (M8) |
| Ellipse/circle/arc/ring | 🟡 | Ellipse ✅; arc/ring ❌ |
| Line | ✅ | Relative points, stroke hit |
| Arrow (arrowhead) | ✅ | Both ends, binding follow |
| Polygon | ❌ | Via `Custom` only |
| Star | ❌ | Via `Custom` (test example) only |
| Path/vector network | 🟡 | `Path` open/closed bezier + pen/edit sessions; no vector networks |
| Pencil/freehand (pressure) | ✅ | `Freedraw` + pressures, uniform-0.5 commit path |
| Text | 🟡 | Plain single-style; host measures |
| Image | 🟡 | Reference + crop rect; host fetches/decodes/draws |
| Video/embed | ❌ | — |
| SVG nested | ✅ | `io.importSvg` via `usvg` in `nary-io` (`svg` feature; Python facade defers) |

**Style**

| Capability | Status | Note |
|---|---|---|
| Fill solid | ✅ | — |
| Gradient linear/radial/angular/diamond | 🟡 | Linear/radial/angular stored; diamond ❌; host rebuilds endpoints; `setStyle` accepts gradient objects (M8) |
| Image/pattern fill | ❌ | — |
| Stroke width/cap/join/dash/align/per-side | 🟡 | Width + solid/dashed/dotted + cap/join/align ✅ (M8); per-side ❌ |
| Multiple fills/strokes | ❌ | Single each |
| Effects (shadow/blur/bg-blur) | ❌ | `opacity` only |
| Blend modes | ❌ | — |
| Opacity | ✅ | 0–100, clamped |
| Color spaces (sRGB/P3) | ❌ | Opaque strings |
| Variables/design tokens | 🟡 | Chrome `Theme` tokens only, not element variables |

**Text**: shaping 🟡 (host) · bidi ❌ · ligature ❌ · font fallback ❌ (host) ·
variable fonts ❌ · rich spans ❌ · paragraph style ❌ · text-on-path ❌ ·
auto-resize 🟡 (grow-only) · IME & caret/selection 🟡 (state machine + host
window) · kerning/OpenType ❌. Future: `parley` (preferred) — `01-research.md §2`.

**Layout**: constraints ✅ (pure + wired) · auto-layout 🟡 (manual trigger, no
live re-layout) · grid ❌ · min/max ❌ (except `MIN_SIZE=1`) · align/distribute
✅ · responsive resize 🟡 (selection block-scale + constraints).

**Interaction & tools**: select (click/marquee/shift-ctrl/deep) 🟡 (box-rubber,
single-level drill, no lasso) · move/resize/rotate ✅ · skew ❌ · multi-
selection transform 🟡 (move + block-resize, single-rotate) · pen/path-edit ✅ ·
shape tools ✅ (8 draw + text) · hand/pan ✅ · zoom ✅ (0.1–10, anchored) ·
eraser/eyedropper ❌ · snapping (object/grid/guide/spacing/smart) 🟡 (object +
grid + guides; no spacing-distribution or Geometry-guides UI) · rulers/guides ❌
(engine math ✅, host painting 🟡) · grid & pixel grid 🟡 (config plumbed, host
paints nothing) · nudging ✅ · alt-drag duplicate ❌ (explicit `duplicate` op
only) · align/distribute ✅ · tool = extensible state machine 🟡 (phase machine
✅, registry names-only — behavior hooks missing).

**Operations**: boolean ops ✅ (exact rectangle ops M2; closed-path ops via
`i_overlay` M8, ADR-0020) · outline
stroke ❌ · flatten ❌ · offset ❌ · simplify ❌ · convert-to-path ❌ ·
group/ungroup ✅ · z-order ✅ · copy/paste ✅ (internal + versioned/bare-array
codec; OS bytes host-side) · transform matrix API 🟡 (`resize/rotate/move`
covered; no raw matrix op).

**History & collaboration**: transaction/patch undo-redo ✅ · coalescing ✅ (one
entry per gesture) · branching ❌ (linear, max 100) · change events ✅
(drainable queue) · CRDT-ready structure 🟡 (atomic ops, stable ids,
parent-on-child, soft-delete — but `String` ids, no LWW/fractional-index/
journal; `yrs`/`loro` deferred to design-only).

**Camera & viewport**: pan/zoom ✅ · fit/fill ❌ (no op) · screen↔world ✅ ·
multi-viewport ❌ · minimap-ready 🟡 (cull + bounds queries suffice, no
dedicated op) · culling ✅.

**I/O**: SVG ✅ (`io.importSvg`, `svg` feature) · PNG/JPEG/WebP 🟡 (pure-math PNG plan; raster host-side; no
JPEG/WebP) · PDF ❌ · JSON native ✅ · clipboard ✅ · asset manager 🟡 (sync
store; fetch/decode/GC/dedup/quota host-side) · lazy/streaming ❌.

**Observability**: events/subscriptions ✅ · introspection (query node/bounds/
hit-test) ✅ · logging/tracing ❌ · profiling hooks ❌.

## 2. Expansion plan (no reconstruction)

E1. Registry completion (no new crates): `Editor` gains a `PluginRegistry` inlet
   (shapes/tools/commands/serializers flow into the live session),
   `executeCommand(id, payload)` protocol op over `command_by_id`, per-corner
   radius / arc primitives only if a host demands them — all additive.
E2. Interchange growth inside `nary-io`: `usvg`-based SVG import (host-gated
   feature), JPEG/WebP plans mirroring the PNG plan, `Custom` import via
   `SerializerExtension`, stored `RenderModel` goldens next to the existing
   TS-generated fixtures.
E3. Geometry growth inside `nary-geometry` (pure math only): boolean ops behind
   a precision ADR (`i_overlay` first), offset/simplify/outline as follow-ups;
   spatial index stays custom until an ADR with benchmarks says otherwise
   (`rstar` deferred).
E4. Text growth (host-first): keep measurement in hosts; when scoped, add
   `parley` behind a host-gated layout crate — never inside `nary-core`.
E5. Test/bench hardening: `criterion`/`divan` benches (1k/10k/100k/1M series),
   stored baselines + CI gate, `proptest` for geometry/round-trip/history
   invariants, `cargo-fuzz` for `import_str`/clipboard/batch parsers, DAG-
   asserting `workspace_wiring`, Python/Tauri integration tests, tightened
   parity asserts. (Details: `04-roadmap.md`.)
E6. Future `nary-sdk` facade crate (thin, over the registry surfaces —
   `crates/README.md` already reserves the name). Not built in this phase.

Each step is independently shippable with build + tests green; none moves
existing files across crates (the "move, don't discard" rule is satisfied
trivially because nothing moves).
