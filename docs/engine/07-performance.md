# 07 — Performance (strategy, evidence, limits)

Frame budget: 16ms. Targets (PRD §5): ≥5,000 elements at 60fps pan/zoom; culled
frame <16ms; click hit-test <5ms at 5k; core bundle <150KB gzipped; cold start
to interactive <500ms. Optimization only on data; every claim below names its
measurement.

## 1. Strategy (from `03-architecture.md` §4)

- Data: Map + explicit order; patches (`SlotDelta`), never document copies;
  `slotmap`/SoA/`SmallVec`/interning only on profiling evidence (ADR-gated).
- Reactivity: `scene_nonce` + `asset_generation` dirty roots; rotation-aware
  `bounds()` for paint/hit vs unrotated `raw_bounds()` for layout; batched
  per-transaction events; fine-grained `docChanged` vs `selectionOnly`.
- Spatial: owned grid-hash (cell 200), incremental sync, tombstone eviction;
  staged hit-test; indexed snapping (zoom-normalized, object wins).
- Render: viewport culling + frame-clip partition; tiles/scene-cache, batching/
  instancing, tessellation/glyph caches, dirty-rect/incremental + async
  pipeline, time-slicing for heavy ops (M3/M5).
- Concurrency: engine single-threaded/deterministic; heavy work in host workers.
- FFI: one batch per crossing; deltas not documents; bulk APIs; no JSON on
  proven hot paths; no per-node call loops.
- Size/startup: features for heavy codecs, release LTO/single-CGU, `wasm-opt`
  at publish, lazy fonts/assets, streaming parse.

## 2. Evidence

### 2.1 Prior report (checked in)

`docs/modules/phases/BENCHMARK_RESULTS.md` (2026-08-29, 5k random in
10k×10k world, viewport 1920×1080 ≈2.1%, cell 200): viewport culling linear
median 0.311ms vs grid 0.349ms (0.89× — grid slightly slower, more candidates
152 vs 119); hit-test linear 63.15µs vs grid 10.0µs (**6.32×** median, 4.22×
P99, identical 448/1000 accuracy). Decision: keep the grid for interaction
latency. Limitations: single point, no machine/commit info, no scaling series.

### 2.2 This pass (2026-10-04, Windows dev machine, `cargo test` debug profile,
`benchmark_model`, single samples, no warmup — upper bounds, not baselines)
| Scenario | Result (debug) | Read |
|---|---|---|
| Create 1000 elements | 715ms | one-time build path |
| Create 5000 elements | ~17.7s | one-time; import path is the fast path |
| Import 5000 elements | 1.287s | staged pipeline + full grid rebuild |
| Serialize 1000 / export 1000 | 3.2ms / 4.0ms | JSON envelope cheap |
| Export 5000 | 35.8ms | — |
| Deserialize 1000 | 122ms | validation cost visible |
| Delete 1000 | 3.4s | per-element soft-delete + grid evict in debug |
| Drag 100 elements | 1.466s total loop | includes per-step commit in test harness |
| Undo 100 drags / redo | 4.5ms / 2.2ms | snapshot inversion is cheap |
| Undo/redo ×100 mixed | 28ms / 52ms | linear history, no branching cost |
| Select 100 elements | 310ms loop | harness loop, not single-select latency |
| Drag move (100) preview math | 403µs | `snap_move_delta` path is sub-ms |
| Render model 5000 | 21.2ms | full rebuild in debug; above 16ms budget — release + caching work is M3/M5 |
| Hit-test top 5000 (linear) | 17.2ms | **linear** path; grid-candidate path is the 10µs-median design (`hit_test.rs:271-273` routes it next, bench-gated) |
| Click select 5000 | 15.4ms | same linear path as above |
| Query in bounds 5000 | 9.0ms | linear `query_in_bounds`; index routing is M2 |

Full suite result: `cargo test --workspace` green (all suites, exit 0);
`cargo clippy --workspace --all-targets` clean (51.5s check, no warnings).

### 2.3 M2 indexed hit-test (2026-10-05, same debug conditions)

| Scenario | Linear | Indexed | Note |
|---|---|---|---|
| Hit-test top, 5k row layout | 4.709ms | 4.245ms | 1.1×; parity-proven identical results |
| Click select, 5k (editor, indexed path) | 15.4ms (pre-M2 linear) | — | re-measure in M5 harness |

The indexed walk is O(n) in the order scan (one hash probe per element) —
the grid shrinks exact geometry checks, not the walk. A position index
(order → rank, maintained incrementally) would remove the floor; recorded
as follow-up, not implemented. Parity tests (200 mixed elements × 500
points × 2 filters; 200 × 300 bounds probes) pin identical results, so the
editor's click and rubber-band paths now use the indexed variants.

### 2.4 Honest reading
- Interaction-critical paths (snap math, undo/redo, serialize/export) are
  already sub-ms to low-ms in the worst profile (debug).
- The two over-budget debug numbers (render rebuild 21ms, linear hit-test
  17ms at 5k) were **known architectural next steps**: render still needs
  caching/incremental (M3); hit-test index routing landed in M2 (§2.3) with
  parity proofs. The prior report's grid numbers show the headroom exists.
- Import (1.3s/5k) and one-by-one creation (17.7s/5k debug) confirm the bulk-
  import path matters; per-node `apply_batch` creation at scale should stay a
  test-only pattern (documented anti-pattern, `protocol.rs:764-770`).

### 2.5 M5 criterion series (2026-10-05, Windows dev machine, optimized bench profile)

Harness: `crates/nary-core/benches/scale.rs`, `crates/nary-io/benches/scale.rs`
(criterion 0.5.1, dev-only). Grid-layout scenes, shared `OnceLock` documents
for read tiers. Full command in repo: `cargo bench -p nary-core --bench scale`
/ `-p nary-io`.

| Operation | 1k | 10k | 100k | 1M |
|---|---|---|---|---|
| Hit-test top (indexed) | 99µs | 1.0ms | 14.8ms | 176ms |
| Render model (full build) | 1.1ms | 26ms | 302ms | — (not benched: allocation) |
| Marquee query (indexed, 10k² probe) | — | 10.4ms | 54.7ms | 188ms |
| Mass move (all + arrows + 1 entry) | 11ms | 160ms | — | — |
| Undo after mass move (1k) | 7.6ms | — | — | — |
| Document build (factories + upsert) | — | — | 465ms | — |
| Import scene JSON | 22ms | 235ms | 4.0s | — |
| Export scene JSON | — | 268ms | 1.6s | — |

Two benchmark-driven fixes landed in M5 (optimize only on data):

1. **Import order repair was O(n²)** (`restored.contains` per element):
   import 100k measured **26 s → 4.0 s (6.5×)** after switching to a
   `HashSet` membership set with identical output order.
2. **Mass move was O(n²)** (`update_bound_arrows` scanned the whole
   document per moved id): mass move 10k measured **18.6 s → 160 ms
   (116×)** after adding `update_bound_arrows_many` (single scan, same
   endpoint math, same one-entry semantics).

Evidenced follow-ups (not implemented): full render at 10k costs 26ms
(over the 16ms frame budget → tile/scene caching, M3 note); indexed
hit-test is still an O(n) order walk (5ms budget holds to ~30k elements →
position index); 1M mutating paths unmeasured (setup dominates).

## 3. Known limits (updated M5)

- Criterion harness + LCG/proptest properties + adversarial corpus + DAG
  wiring test land in M5; stored baselines are this document's §2.5 table
  (criterion's machine-local baselines live under `target/`, uncommitted).
  No CI regression gate yet (follow-up: `critcmp` or bencher jobs).
- No release-profile lab numbers beyond `cargo bench` (optimized); no
  machine-pinned lab; 1M mutating paths unmeasured.
- `cargo-fuzz` libfuzzer unavailable on the stable-only toolchain here —
  deterministic adversarial corpus (`adversarial_parsers.rs`) stands in,
  wired as future fuzz targets.
- `cargo-deny` / `cargo-audit` / `cargo-semver-checks` unavailable here —
  recorded as CI follow-up (master allows "bila tersedia").
- Desktop host drops images/hatch/grid/bounded-chrome (visual, not engine).
- `wasm-opt=false` (larger WASM; documented Windows tradeoff, publish-time fix).
