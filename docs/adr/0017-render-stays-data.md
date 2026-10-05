# ADR-0017: Render Stays Data; Hosts Own Raster, Text, and Threads

Date: 2026-10-04. Status: accepted. Context: render/text/parallelism choices
from `docs/engine/01-research.md` §2.

## Decision

- The engine emits deterministic data (`RenderModel`/draw entries/paint descs/
  PNG plans) and never rasterizes, touches Canvas/DOM, measures glyphs (beyond
  the deterministic fallback), or spawns threads. `nary-core` keeps its single
  `nary-geometry` dependency; `serde` stays in `io`/`bindings` only.
- Rejected for the engine: `wgpu`, `vello` (either CPU or GPU split),
  `tiny-skia`, `skia-safe`, `lyon` tessellation, `femtovg`, `piet`, `resvg`
  rendering, `kurbo`/`parry2d`/`rstar` as deps, `parley`/`cosmic-text`/`swash`/
  `fontdb`/`icu4x` in core, `rayon` in core, `napi-rs` native addon, `uniffi`,
  `ts-rs` codegen, `bincode`, `rkyv` for interchange.
- Deferred (explicit, revisited only with a scoped need + benchmark): `usvg`
  for SVG import in `nary-io` (host-gated feature), `i_overlay` for boolean ops
  in `nary-geometry` (precision ADR first; `clipper2-rust` only after vetting
  vs `i_overlay`), `parley` for text layout in a host-gated layout crate,
  `postcard` for compact transport if JSON proves slow, `schemars` for plugin
  DTO validation in bindings, `slotmap` for storage (Map-vs-slotmap ADR with
  key-ser + `isDeleted` analysis), `smallvec`/`bitflags` on profiling evidence,
  `vello_cpu` for a software host, WebGPU/`wgpu` for a GPU host with
  WebGL2/Canvas2D fallback, WASM threads/`OffscreenCanvas` host-side.
- CRDT (`yrs`/`loro`/`automerge`): design-open only (atomic ops, stable IDs,
  parent-on-child, fractional index, journal/checkpoint); no implementation.

## Consequences

- Bundle/size/startup budgets stay intact (PRD §5: <150KB gzipped core).
- WASM story stays single-artifact (`wasm-pack`); npm stays WASM (no native
  matrix); Python stays PyO3 + `maturin` (`abi3`, `py.typed` + `.pyi`).
- Engine remains single-threaded/deterministic; parallelism is host-owned.

## References

- `docs/engine/01-research.md` §2–§3 (versions, licenses, wasm notes)
- Context7 `/linebender/vello`, `/linebender/parley` (2026-10-04)
- Prior ADRs: 0005 (dependency policy), 0010 (wasm strategy), 0014 (native vs
  wasm), 0009 (io/clipboard boundary)
