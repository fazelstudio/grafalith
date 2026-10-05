# 01 — External Research (Phase 2, validated 2026-10-04)

Sources: Context7 (primary for library APIs) + web search/fetch of official docs,
repos, changelogs, and specs. Every decision in §5–§7 cites URL + access date
(all accessed 2026-10-04 unless noted). Where sources conflicted or were not
found, this is stated explicitly. No code was changed in this phase.

Context7 IDs actually consulted:

- `/websites/codemirror_net` — Extension/Facet/StateField/StateEffect/
  Compartment/StateField/Precedence reference + migration guide snippets.
- `/linebender/vello` (also `/websites/rs_vello_0_9_0`) — `Scene`/`Renderer`/
  `RenderParams` workflow, `vello_cpu`/`vello_gpu`/`webgl` feature flags, WASM
  build script.
- `/linebender/parley` — `FontContext`/`LayoutContext` sharing pattern,
  `ranged_builder`, BiDi/itemization/fallback/shaping/line-break pipeline,
  `doc/concept.md` + `doc/design.md`.

## 1. Reference architectures

### 1.1 CodeMirror 6 (mandatory deep-dive — principles, not copy-paste)

- Extension = nestable array value, deduplicated on resolve; a feature returns
  `[stateField, facetInput, viewPlugin, keymap, theme]`.
  Sources: https://codemirror.net/docs/guide/,
  https://codemirror.net/examples/config/
- `Facet.define({combine})`: many inputs → one output (`tabSize` highest-wins;
  `keymap` precedence-sorted; OR-style flags). `Facet.compute(deps, fn)` for
  derived config. Source: https://codemirror.net/docs/guide/ (*Facets*).
- `StateField.define({create, update})`: immutable value + Redux-like reducer per
  transaction; `provide: f => otherFacet.from(f)` wires field → facet.
  Source: https://codemirror.net/docs/guide/ (*State Fields*).
- `Transaction` + `StateEffect.define({map})` + `Annotation`: `state.update(spec)`
  builds `Transaction{changes, selection, effects, annotations, reconfigure}`;
  effects remap positions through changes; annotations carry metadata
  (e.g. `userEvent`); `changeFilter`/`transactionExtender` facets can veto/extend.
  Sources: https://codemirror.net/docs/guide/, https://codemirror.net/docs/ref/,
  https://github.com/codemirror/state/blob/main/src/README.md
- `Compartment`: named sub-tree, `c.of(ext)` + `c.reconfigure(newExt)` via
  effect; nested allowed. Prefer `Facet.compute` for derived values (cheaper).
  Source: https://codemirror.net/examples/config/
- `ViewPlugin.define/fromClass({update, destroy, decorations, provide,
  eventHandlers})`: imperative shell over functional core; crashed plugin
  auto-disabled; gets `ViewUpdate{docChanged, viewportChanged, transactions}`.
  Source: https://codemirror.net/docs/guide/ (*Affecting the View*),
  https://github.com/codemirror/view/blob/main/src/extension.ts
- Command: `(view) => boolean` / `StateCommand`, **no central registry by design**;
  keymap arrays tried in precedence order until `true`.
  Source: https://codemirror.net/docs/guide/ (*Commands*).
- Precedence `Prec.highest/high/default/low/lowest`: flatten → bucket → stable
  intra-bucket order. Source: https://codemirror.net/examples/config/
  (*Precedence*), https://codemirror.net/docs/ref/

Transfer to Nary: functional core (`Document`/`History` immutable + versioned)
vs imperative shell (renderer/host); facets for config (snap providers,
default style) instead of global mutation; transactions carrying
`{elementDelta, selectionMap, effects[], userEvent}` with `docChanged` separated
from `selectionOnly`; compartments for tools/themes; ViewPlugin rule (hosts
derive from `RenderModel`, never store canonical geometry); bool-returning
command dispatch in precedence order.

### 1.2 tldraw

- Store (`@tldraw/store`): reactive DB of JSON records (`TLShape`, `TLBinding`,
  `TLAsset`, `TLPage`, `TLCamera`, presence); `put/remove/update`,
  `mergeRemoteChanges`, `extractingChanges → RecordsDiff`, `applyDiff`,
  `atomic/transact`, computed caches, integrity checker, schema migrations.
  Sources: https://github.com/tldraw/tldraw/blob/main/packages/store/src/lib/Store.ts,
  https://tldraw.dev/sdk-features/store
- ShapeUtils: one instance per type; `getDefaultProps`, `getGeometry →
  Geometry2d` (`Rectangle2d/Circle/Ellipse/Polygon/Polyline/Arc/Group2d`,
  cached), `component`, `getIndicatorPath`; capabilities
  (`canEdit/canResize/canCrop/canScroll/canBind/canCull/
  canReceiveNewChildrenOfType`); hooks (`onBeforeCreate/onBeforeUpdate`,
  `onResize/onRotate/onTranslate(+Start/End)`, `onChildrenChange`,
  `onDoubleClick/onDragShapesOver`); `T.*` prop validation + style-props +
  `createShapePropsMigrationSequence`.
  Sources: https://tldraw.dev/sdk-features/shapes,
  https://tldraw.dev/sdk-features/geometry
- Tools = `StateNode` hierarchy (`Select: idle/pointing_canvas/brushing/
  translating`, `Draw`, `Arrow`, …); `Browser → InputsManager/ClickManager →
  Root.dispatch → currentTool`; managers for history, snap, spatial index
  (`rbush`), inputs, click, tick, text/font, scribble, edge-scroll, theme,
  user-prefs, collaborators, performance.
  Sources: https://tldraw.dev/sdk-features/editor,
  https://tldraw.dev/sdk-features/tools
- Bindings (`BindingUtil`): first-class relation records with
  `onAfterChangeToShape/onBeforeDelete/onBeforeIsolate`.
  Source: https://tldraw.dev/sdk-features/bindings
- Signia (`@tldraw/state`): `atom/computed/transact/react`, lazy clock-based
  computed, rollback on throw. Source: https://signia.tldraw.dev/,
  https://github.com/tldraw/signia

Transfer: split shape behavior into `geometry/validate/defaultProps/migrate`
(core) vs `render` (outside core); `BindingUtil` pattern for arrows/containers;
`StateNode` tool hierarchy over switch-statements; `transact` batching +
computed caches + `rbush`-class index; fractional indexing for z-order.

### 1.3 Figma (engineering blogs)

- Rendering: 2015 WebGL bet for infinite canvas; C++ engine → WASM (Emscripten)
  + native for server render/test (2017: 3× faster load); 2025 WebGPU migration
  (explicit draw args, GLSL→WGSL via custom processor + `naga`, batched uniform
  buffers, Dawn native + `emdawnwebgpu` web, WebGL fallback on device loss).
  Sources: https://www.figma.com/blog/figma-rendering-powered-by-webgpu/,
  https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/,
  https://www.figma.com/blog/how-figma-draws-inspiration-from-the-gaming-world/
- Multiplayer: custom LWW per `(objectId, property)` (not OT); parent link on
  child (atomic `parent+position`), server rejects cycles; fractional indexing;
  undo modifies the opposite stack so undo-copy-redo is identity; journal/WAL
  (seq deltas ~0.5s + checkpoint ~60s, >2.2B changes/day, p95 <600ms).
  Sources: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/,
  https://www.figma.com/blog/making-multiplayer-more-reliable/
- Loading: QueryGraph (in-memory read+write dependency graph, first-page + deps
  only, parallel decode, deferred instance materialization → 33% faster slow
  loads, 70% fewer nodes, 33% fewer OOM); LiveGraph (GraphQL-like subscriptions
  over Postgres replication, edge + read-through cache + stateless invalidator).
  Sources: https://www.figma.com/blog/speeding-up-file-load-times-one-page-at-a-time/,
  https://www.figma.com/blog/livegraph-real-time-data-fetching-at-figma/
- Gap honestly noted: Figma does not publish its scene-graph struct or
  viewport-culling code; the above is protocol/loading/renderer-interface level.

Transfer: LWW `(id, prop)` + parent-on-child + fractional index fit the current
`Document` version/nonce + soft-delete design; journal-vs-checkpoint split for
future sync; `RenderModel` should ship visible page + deps only; keep an explicit
graphics interface (Canvas2D now, WebGPU compute later); WASM engine + native
tests/server render matches `nary-bindings` direction.

### 1.4 Excalidraw, Penpot, Konva, PixiJS, Skia/CanvasKit, Rive

- Excalidraw: dual Array+`Map` scene (`SceneElementsMap`), `nonDeleted` views,
  `sceneNonce` cache-buster, soft-delete + `version/versionNonce`,
  `StoreSnapshot` structural clone of changed-only, `CaptureUpdateAction
  (IMMEDIATELY/EVENTUALLY/NEVER)`, `History/HistoryDelta` inverse stacks,
  fractional indices. Sources: https://github.com/excalidraw/excalidraw/blob/b2e81e38/packages/element/src/Scene.ts,
  https://github.com/excalidraw/excalidraw/blob/b2e81e38/packages/element/src/store.ts,
  https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/history.ts
  Borrow: keep Map+order+nonce+soft-delete; adopt capture-action levels to avoid
  drag history spam.
- Penpot (real Rust/WASM migration): `render-wasm` (Rust + `skia-safe, glam,
  bezier-rs`) via `wasm-pack`; dual Live/GPU (WebGL+Skia tiles, LRU farthest-
  evict, `fast_mode`) vs Vector/CPU (single Skia PDF canvas); parity guards via
  `ShapeRenderer` capability method + exhaustive `match`; text via DOM
  `contenteditable` → FFI → Skia `Paragraph` overlay. Sources:
  https://penpot.app/blog/penpots-new-rendering-system/,
  https://github.com/penpot/penpot/blob/develop/render-wasm/docs/rendering_architecture.md,
  https://github.com/penpot/penpot/blob/develop/render-wasm/src/tiles.rs,
  https://github.com/penpot/penpot/pull/5077
  Borrow: trait-guard parity pattern; tile/LRU + `fast_mode` roadmap; text
  editing in host, layout in engine.
- Konva: `Stage>Layer>Group>Shape`, scene canvas (@dpr) + hit canvas (@1×),
  `sceneFunc` vs `hitFunc(colorKey)`, `batchDraw` via rAF, off-screen culling
  manual, layer budget (~5 layers ≈ 200MB warning).
  Sources: https://konvajs.org/docs/overview.html,
  https://konvajs.org/docs/performance/All_Performance_Tips.html
- PixiJS v8: `Container` tree, `worldTransform/worldAlpha`, insertion order,
  `RenderGroup` mini-graphs, `cullable/cullArea`.
  Source: https://pixijs.com/8.x/guides/concepts/scene-graph
- Skia/CanvasKit: C++ Skia → WASM (`canvaskit.wasm` + `.js`),
  `MakeWebGLCanvasSurface/MakeSWCanvasSurface`, `Paint/Path/Paragraph`.
  Sources: https://skia.org/docs/user/modules/quickstart/,
  https://docs.skia.org/docs/user/modules/canvaskit/
  Borrow: if a Skia backend ever lands, hide it behind a `Renderer/Factory`
  interface; share validation, swap only the draw call.
- Rive: `File::import → Artboard::instance → StateMachineInstance::
  advanceAndApply(dt) → draw(Renderer)`; `Renderer{save/restore/transform/
  clipPath/drawPath/drawImage}` + `Factory`; PLS GPU + Skia/CG/Sokol adapters;
  fixed-timestep deterministic playback.
  Sources: https://rive.app/docs/runtimes/cpp/external-renderer,
  https://github.com/rive-app/rive-runtime

## 2. Rust ecosystem (latest versions checked 2026-10-04)

Render — verdict: **nothing new inside the engine**. `RenderModel`-as-data stays;
rasterizers belong to hosts.

| Crate | Latest seen | Status / WASM / license | Verdict |
|---|---|---|---|
| `wgpu` | 30.0.1, MSRV 1.87 | Active (gfx-rs); WebGPU + WebGL2 fallback; MIT/Apache | Reject in core (host concern, breaks zero-dep) |
| `vello` | 0.10.0 (Sep 2026); split into `vello_cpu` (SIMD MT, most mature) / `vello_gpu` (sparse strips, WebGL2/wgpu, no compute) / `vello` compute (experimental) | Active (linebender); Apache/MIT | Reject in core; evaluate `vello_cpu` for a software host first |
| `tiny-skia` | 0.12.0 (Jun 2026, now `linebender/tiny-skia`) | Active/slow; pure Rust, portable; BSD-3 | Defer — best CPU-raster reference for host/`nary-io` PNG, not core |
| `skia-safe` | 0.153.3-pre (tracks Skia m153) | Active; C++ build; no WASM | Reject (C++ dep breaks pure-Rust + parity) |
| `lyon` | 1.0.19 | Maintenance; pure Rust; MIT/Apache | Defer — tessellation is host-only |
| `femtovg` | 0.27.0 (Sep 2026) | Active; OpenGL ES 3 + wgpu backend; MIT/Apache | Reject in core (renderer = host) |
| `piet` 0.8.0 / `kurbo` 0.13.1 | — | `piet` stale/superseded by Vello; `kurbo` active, pure Rust, Apache/MIT | Reject both as deps; keep `kurbo` as accuracy reference |
| `resvg`/`usvg` 0.48.1 | — | Active (now linebender); pure Rust incl. WASM (`tiny-skia` backend); Apache/MIT | Defer — `usvg` as SVG-import reference for `nary-io`, never core |

Primary: https://crates.io/crates/wgpu, https://crates.io/crates/vello,
https://github.com/linebender/vello, https://docs.rs/crate/tiny-skia/latest/builds,
https://github.com/rust-skia/rust-skia/releases, https://docs.rs/lyon,
https://github.com/femtovg/femtovg, https://docs.rs/piet/latest/piet,
https://crates.io/crates/kurbo, https://crates.io/crates/resvg, https://crates.io/crates/usvg

Geometry/path/spatial — verdict: **reference only; no new core deps**.

| Crate | Latest seen | Verdict |
|---|---|---|
| `kurbo` 0.13.1, `lyon_path` (lyon 1.0.19) | Active / maintenance | Defer — zero-dep rule forbids; vendor ideas only |
| `geo` 0.33.1 | Active (georust) but GIS-domain, heavy | Reject (map ≠ canvas) |
| `i_overlay` ^8.1 | Active, robust boolops (union/intersect/diff/xor) | Defer — top boolean-ops candidate when scoped; needs precision ADR |
| `clipper2` 0.5.4 (C++) / `clipper2-rust` 1.2.0 (2026 pure port, `forbid(unsafe)`, WASM demo) | Mixed | Reject C++; defer `-rust` — vet AI-ported correctness vs `i_overlay` first |
| `flo_curves` ~0.7.x (unverified) | Low-active | Reject (`kurbo` covers) |
| `rstar` 0.13.0 | Active | Defer — conflicts with the documented custom spatial index; needs ADR to replace |
| `bvh` ~0.10.x (unverified) | Unknown/stale | Reject (prefer own index or `rstar`) |
| `parry2d` 0.30.2 | Active physics (dimforge) | Reject (physics overkill; borrow BVH ideas only) |

Primary: https://crates.io/crates/kurbo, https://github.com/georust/geo,
https://github.com/georust/rstar, https://github.com/iShape-Rust/iOverlay,
https://docs.rs/clipper2-rust/1.2.0/clipper2_rust,
https://docs.rs/parry2d/0.30.2/parry2d/index.html

Text — verdict: **`parley` is the preferred future layout engine; nothing now**.

| Crate | Latest seen | Verdict |
|---|---|---|
| `parley` 0.11.1 (Sep 2026) | Active (linebender); shaping/line-break/bidi/align, `FontContext`+`LayoutContext`, editing utils; stack ICU4X+harfrust+swash/skrifa; Apache/MIT | Defer (preferred) — best fit for canvas text boxes when text is scoped |
| `cosmic-text` 0.19.0 (Apr 2026) | Active (pop-os); full widget via harfrust+fontdb+swash | Defer (alternative) — layout-only (`parley`) vs editor (`cosmic-text`); never both |
| `rustybuzz` 0.20.1 | **Archived/unmaintained — RUSTSEC-2026-0206 (2026-07-12), use HarfRust** | Reject |
| `harfrust` 0.5.2, `swash` 0.2.10, `skrifa` 0.47.0 / `read-fonts`, `fontdb` 0.24.0, `fontique` 0.11.1 | Active | Defer — only via `parley`, never direct |
| `unicode-bidi` ~0.3.x, `unicode-segmentation` 1.13.3 | Active (unicode-rs), tiny, `no_std` | Defer — `unicode-segmentation` is the tiniest safe text dep when editing lands |
| `icu4x` (`icu` 2.3.0) | Active but **Unicode-3.0 license** (legal review needed) + CLDR data weight | Reject in core (host-side only if full i18n needed) |

Primary: https://github.com/linebender/parley, https://docs.rs/parley/latest/parley,
https://github.com/pop-os/cosmic-text/releases,
https://rustsec.org/advisories/RUSTSEC-2026-0206.html,
https://github.com/harfbuzz/rustybuzz/blob/main/README.md,
https://crates.io/crates/fontdb, https://crates.io/crates/fontique,
https://crates.io/crates/unicode-segmentation, https://crates.io/crates/icu/versions

Data/state — verdict: **no new core deps; `slotmap` is the only strong future
candidate (ADR-gated)**.

| Crate | Latest seen | Verdict |
|---|---|---|
| `slotmap` 1.1.1 (Zlib, `no_std`+`serde` feature, ABA-safe keys) | Active | Defer (strongest adopt-candidate) — needs ADR (Map vs slotmap, key ser, `isDeleted` interplay) |
| `generational-arena` ~0.2.9 | Stale | Reject (superseded by `slotmap`) |
| `hecs` ~0.10.x / `bevy_ecs` 0.19.1 | Game-ECS, heavy | Reject (ECS overkill; `Document`+`Command`+`HistoryManager` suffice) |
| `im`/`rpds` | Low-active persistent-immutable | Reject (conflicts with atomic `Command` undo) |
| `smallvec` 1.x / `bitflags` 2.13.0 | Ubiquitous, zero-cost | Defer — allow only on profiling evidence |

Primary: https://docs.rs/crate/slotmap/latest,
https://github.com/orlp/slotmap/blob/master/RELEASES.md,
https://crates.io/crates/bevy_ecs/versions

Collaboration CRDT — **design only, do not implement**: `yrs` (~0.23.x, Yjs-
compatible, MIT, lowest memory in benchmarks), `loro` (^1, very active, trees +
movable lists + time-travel, Apache-2.0 — richest for canvas), `automerge`
(0.6.x, JSON maps/lists + sync protocol, heavier). Design constraint carried
into `03-architecture.md`: atomic/idempotent/mergeable ops, stable IDs,
parent-on-child, fractional index, journal/checkpoint split.
Primary: https://docs.rs/yrs/latest/yrs, https://docs.rs/loro/latest/loro/,
https://docs.rs/automerge/latest/automerge/, https://automerge.org/blog/automerge-2

Serialization — verdict: **stay on `serde`/`serde_json`; binary only if JSON
proves too slow on a hot path**.

| Crate | Verdict |
|---|---|
| `serde` 1.0.229 + `serde_json` 1.0.151 (already allowed) | Keep — versioned JSON schema + protocol |
| `rkyv` 0.8.18 | Reject for interchange (no wire spec/evolution, 0.7→0.8 incompatible) |
| `postcard` 1.0.0+ (stable wire spec, `no_std`) | Defer — candidate for compact binary transport/clipboard if JSON too large |
| `bincode` 1.3.3 | Reject — unmaintained, RUSTSEC-2025-0141 |
| `schemars` | Defer — useful for plugin DTO/schema validation in bindings, not core geometry |

Primary: https://crates.io/crates/rkyv, https://github.com/rkyv/rkyv/releases,
https://docs.rs/postcard/latest/postcard,
https://rustsec.org/advisories/RUSTSEC-2025-0141.html

Bindings/toolchain — verdict: **stay the course**.

| Tool | Latest seen | Verdict |
|---|---|---|
| `wasm-bindgen` 0.2.129 | Active | Keep — sole JS boundary (JSON-string protocol) |
| `wasm-pack` 0.15.0 | Low-active/maintenance | Keep with caution — works for `@fazelstudio/nary`; consider `wasm-bindgen-cli` + Vite/Rollup if it stalls |
| `napi-rs` v3.9.1 / cli 3.7.1 | Active | Reject for npm — native addon forks the OS matrix for no proven geometry win; WASM suffices |
| `PyO3` 0.29.2 + `maturin` 1.15.0 | Active | Keep — PyPI path; use `abi3`/`abi3t` (PEP 803), `compatibility=pypi`, `auditwheel`, `universal2`/`win_amd64` |
| `uniffi` 0.32.0 | Active (Mozilla IDL) | Reject — extra IDL couples the engine; JSON-string protocol already owned |
| `tsify`/`ts-rs`/`specta` 2.0.0-rc | Mixed/unstable | Reject — hand-written DTOs + JSON Schema keep the engine decoupled from codegen churn |

Primary: https://crates.io/crates/wasm-bindgen, https://wasm-bindgen.github.io/wasm-pack,
https://napi.rs/, https://napi.rs/docs/concepts/webassembly.md,
https://pypi.org/project/maturin, https://pyo3.rs/v0.29.2/building-and-distribution.html,
https://github.com/mozilla/uniffi-rs/blob/main/CHANGELOG.md

Parallelism/web platform — verdict: **engine stays single-threaded and
deterministic; parallelism belongs to hosts**.

- `rayon` 1.12.0: native excellent; WASM needs `wasm-bindgen-rayon` + nightly
  std rebuild + `SharedArrayBuffer`. Reject in core.
  Primary: https://github.com/rayon-rs/rayon/blob/main/RELEASES.md,
  https://docs.rs/crate/wasm-bindgen-rayon/latest
- WASM threads/`SharedArrayBuffer`: COOP/COEP isolation required; Safari
  15.2+/iOS 16.4+, Chrome 85+, FF 105+. Defer to host with single-thread
  fallback + dual-build pattern.
- `OffscreenCanvas`: Baseline widely available since Mar 2023. Adopt in browser
  hosts (decouple raster from DOM), not engine.
  Primary: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- WebGPU: W3C CR 2026-09-15; Chrome/Edge 113+, FF 141 Win + 145 macOS ARM64,
  Safari 26; ~84–87% `caniuse`; secure-context only. Defer as host opt-in with
  WebGL2/Canvas2D fallback.
  Primary: https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API,
  https://web.dev/blog/webgpu-supported-major-browsers,
  https://www.w3.org/TR/webgpu/, https://caniuse.com/webgpu

## 3. Distribution

- npm: ship **WASM** (`@fazelstudio/nary`), one artifact for browser + Node +
  Tauri webview — no per-OS `.node` matrix. Dual ESM/CJS from the same `.wasm`
  (`exports` map with `import`/`require` + `types`), test both in CI. Hand-
  augmented `.d.ts` for `RenderModel`/session DTOs owned by `nary-bindings`
  (no `ts-rs` codegen). `wasm-pack --target bundler|web`, `wasm-opt -Oz`,
  `sideEffects:false`, feature-gate `nary-io` codecs, lazy-load future
  `usvg`/`parley` host plugins — never in core.
- PyPI: `maturin` + PyO3, `bindings="pyo3"`, `compatibility="pypi"`,
  `abi3`/`abi3t` for one wheel across CPython, manylinux2014+ Docker or `--zig`
  + `auditwheel`, macOS `universal2` + `delocate`, Windows targets, `py.typed` +
  `.pyi` stubs tested with `mypy`/`pyright`. Keep `nary-python` thin over
  `nary-bindings`.
  Primary: https://github.com/PyO3/maturin/blob/main/guide/src/distribution.md,
  https://www.maturin.rs/distribution
- Semver for a plugin ecosystem (still `0.x`): breaking allowed but explicit;
  freeze `BaseElement` + element interfaces (`docs/ARCHITECTURE.md` — approval-
  gated); additive fields via versioned DTOs in `nary-io`/`nary-bindings`;
  MSRV bumps logged in CHANGELOG (never silent); one intent = one undoable
  history entry; `Document` sole version/nonce authority; soft-delete;
  validate-then-store; plugins go through `Command`, never direct mutation.

## 4. Honest unknowns (follow up only if scoped in)

- Exact 2026-10-04 patches for `flo_curves`, `bvh`, `generational-arena`,
  `hecs`, `im`/`rpds`, `smallvec`, `unicode-bidi`, `schemars`, `tsify`/`ts-rs` —
  not verified against `crates.io` in this pass (all rejected or deferred
  regardless, so no decision depends on them).
- `clipper2-rust` license file + long-term maintenance (2026 AI port) — verify
  before ever preferring it over `i_overlay`.
- `icu` Unicode-3.0 license acceptance — confirm with project owners if full
  i18n is ever scoped.
