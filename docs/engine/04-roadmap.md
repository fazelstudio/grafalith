# 04 — Roadmap (Phase 5 plan)

Ordering follows dependencies: foundation → geometry/spatial → render seam →
tools/interaction → shape/style/text → I/O → bindings → deep optimization.
Every milestone keeps `cargo test --workspace` green and `clippy -D warnings`
clean; docs in `docs/engine/` are updated in the same milestone (docs mismatch
= bug). Desktop (`apps/desktop`) is never touched; each milestone notes its
public-contract impact instead.

## M0 — Hygiene (done in this pass)

- Remove dead `nary-core` dep from `nary-python/Cargo.toml` (audit §4.2).
- Publish `docs/engine/00–08` + `docs/adr/0015–0017`.
- Verify: `cargo test --workspace` green (~500 tests), clippy clean,
  `cargo tree` DAG confirmed.
- Contract impact: none (no wire/schema change).

## M1 — Registry completion (foundation)

- `Editor` accepts a `PluginRegistry` inlet; plugin-declared tools/shapes/
  commands flow into the live session (removes manual `register_custom` glue).
- Add `executeCommand(id, payload)` dispatch over `command_by_id`
  (additive protocol op; wire strings unchanged).
- `Custom` import via `SerializerExtension` (close export-only asymmetry) or
  document it as intentional with a test pinning the skip-and-count behavior.
- Naming-linter test for `namespace.action` + capability-coverage check
  (fail CI on unmapped capabilities).
- Contract impact: additive op only; `PROTOCOL_VERSION` unchanged.

**Status 2026-10-05: done.** Shipped: `Editor::{register_plugin,
plugin_registry, plugin_command_ids, execute_plugin_command}` (one undoable
entry, `NotFound` on unknown id, rollback on failure, silence on no-op);
`executeCommand` wire op + `Engine::register_plugin` (additive, v1 intact);
`command_coverage` (all 72 ops: unique lowerCamel names + exactly-one-result
dispatch) and `plugin_protocol` (3 tests) suites; `io_model` pin for
Custom-type skip-and-count (intentional: io has no registry access by
dependency direction — hosts re-register types at runtime). Deferred to
follow-up: `commands.list/describe/can/dryRun` introspection helpers.

## M2 — Geometry & spatial

- Route `hit_test_top/all` and rubber-band through the owned `SpatialGrid`
  (today render-cull only) behind benches; keep z-order + tombstone semantics
  identical (existing tests pin this).
- Boolean ops: precision ADR first, then `i_overlay` (top candidate) as pure
  math in `nary-geometry`; `clipper2-rust` only if vetted against it.
  Follow-ups: offset/simplify/outline-stroke.
- Contract impact: new `boolean.*` commands (additive); no schema change.

**Status 2026-10-05: done (rectangle scope).** Shipped:
`hit_test_top_indexed` + `query_in_bounds_indexed` (parity-proven vs the
linear scans over rotation/lock/hide/delete fixtures) with the editor's click
and rubber-band paths switched over (123 parity/interaction/geometry tests
still green); debug numbers on the 5k row layout — indexed 4.245ms vs linear
4.709ms (the O(n) order walk is the floor; a position-index follow-up is
noted in `07-performance.md`). Exact rectangle booleans
(`nary-geometry/src/boolean.rs`: intersect/subtract/union-partition/exclude
with area/disjointness/commutativity invariants over 500 LCG boxes) plus
`Editor::apply_boolean` (one entry, style inheritance, explicit
`NotFound`/`InvalidInput`/`Unsupported`) and four additive wire ops
(`booleanUnion/Subtract/Intersect/Exclude`, 76 total). Path booleans stay
`unsupported` pending the `i_overlay` dependency decision (needs owner
approval per AGENTS.md) — recommended in the final report, not smuggled in.

## M3 — Render seam & tools

- Stored `RenderModel` goldens (like the `nary-io` TS-generated fixtures);
  tile/scene-cache design with precise invalidation; dirty-rect proposal.
- Tool behavior hooks so custom tools are not inert captures; `IMMEDIATELY/
  EVENTUALLY/NEVER` capture levels (Excalidraw pattern) to prevent drag history
  spam; lasso select; multi-select rotate; fit/fill viewport ops.
- Desktop host paints images/hatch/grid/bounded-chrome (host-side, noted only).

**Status 2026-10-05: done (scoped).** Shipped: `Editor::fit_viewport` /
`fill_viewport` + additive `fitViewport`/`fillViewport` ops (78 total,
session change with `ViewportChanged` event, explicit errors for empty
content and degenerate canvas); core pinned-values render test plus a
bindings JSON golden (`render_golden` + checked-in fixture with
`UPDATE_GOLDEN=1` regeneration, rotated-bounds value hand-verified).
Evaluated and intentionally **not** built: custom-tool core behavior hooks
(host-owned tools through capture + preview/commit ops is the architecture
per ADR-0011 — core stays behavior-free for custom tools by design, with a
worked host-driven flow in `06-extension-guide.md`); tile/scene caching and
lasso/multi-rotate (recorded follow-ups: payoff unproven at current scale,
invalidation complexity unjustified yet).

## M4 — Shape/style/text & I/O

- Per-corner radius, arc/ring primitives (only on host demand); stroke
  cap/join/align; `usvg`-gated SVG import in `nary-io`; JPEG/WebP plans
  mirroring the PNG plan; asset GC/dedup/quota design.
- Text stays host-measured; `parley` lands only as a host-gated layout crate
  when rich/bidi text is scoped — never in `nary-core`.
- Contract impact: additive commands/DTO fields; `setStyle` gradient support
  arrives with the fill-DTO phase (replacing today's explicit `unsupported`).

## M5 — Benchmarks, fuzz, gates

- `criterion`/`divan` benches: 1k/10k/100k/1M series for load, select, marquee,
  mass-move, hit-test, undo/redo, frame render, export; stored baselines;
  regression gate in CI; release-profile numbers (today's data are debug-
  profile single samples — see `07-performance.md`).
- `proptest` for geometry/transform/round-trip/history invariants
  (`apply → undo == initial`); `cargo-fuzz` for `import_str`/clipboard/batch
  parsers; DAG-asserting `workspace_wiring`; Python/Tauri integration tests;
  tightened parity asserts (snap no-ops, rotate tolerance).
- CI matrix: Linux/macOS/Windows, `wasm32`, supported Python & Node; publish
  dry-runs for npm/PyPI; `cargo deny`/`audit`/`udeps`/public-API checks.

## M6 — Distribution & SDK

- `wasm-opt -Oz` at publish, bundle-size tracking (<150KB gzipped core),
  ESM+CJS dual tested, `.d.ts`/`.pyi` generated from the command schema,
  `py.typed` + stub tests, TestPyPI → PyPI checklist execution.
- Thin `nary-sdk` facade crate over the registry surfaces (name reserved);
  first out-of-tree example crate (node type + tool + command) living outside
  the workspace, built in CI against the published artifact.

## Status

| Milestone | State (2026-10-04) |
|---|---|
| M0 | Done (2026-10-04) |
| M1 | Done (2026-10-05) |
| M2 | Done (2026-10-05) |
| M3 | Done (2026-10-05) |
| M2–M6 | Planned, ordered, unblocked in sequence; each is independently shippable |
