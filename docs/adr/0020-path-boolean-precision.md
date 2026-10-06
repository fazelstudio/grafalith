# ADR-0020: Path Boolean Ops via Flatten + i_overlay

Date: 2026-10-06. Status: accepted (owner approved the i_overlay
dependency). Context: `boolean.*` covered rectangles exactly; paths
returned explicit `Unsupported`.

## Decision

Path booleans run on **flattened polygons** through `i_overlay` 9:

1. Closed, unrotated path inputs → world-space anchors/handles →
   `flatten_anchors` (10 samples per cubic, the existing hit-test
   tessellation) → closed contours.
2. Rectangles in mixed pairs convert to 4-corner contours.
3. `SingleFloatOverlay::overlay` with `OverlayRule::{Union, Intersect,
   Difference, Xor}` and `FillRule::EvenOdd`.
4. Each result shape contributes its outer contour only, re-based to a
   tight origin box as sharp-anchor closed paths.

## Precision contract (honest)

- Results are exact **on the flattened polygons**, an approximation of the
  true beziers bounded by flatten chord error (same tessellation the
  hit-tester already trusts). This is documented on the function, not
  hidden.
- Rectangle+rectangle pairs keep the existing exact rectangle math
  (bit-identical results, existing tests untouched).
- Closed paths only (open → `InvalidInput`); unrotated only (same rule as
  rects); coordinates must be finite and within ±3e150 (below i_overlay's
  f64 limit of 2^500 — larger inputs are `InvalidInput`, and i_overlay's
  infallible API would panic otherwise).
- Result shapes **with holes** are `Unsupported` (our `PathElement` is a
  single contour; holes need compound paths — a model change for later).
  Degenerate (<3-point) contours drop as simplification noise.
- Fill rule is `EvenOdd`, documented.

## Options considered

- `i_overlay` 9 (chosen): active (9.0.0 Sep 2026), MIT OR Apache-2.0, pure
  Rust, WASM-safe, empty default features (no rayon unless asked),
  f64 API with documented limits. Verified via docs.rs 2026-10-06.
- `clipper2-rust` 1.2.0 (not chosen): 2026 AI port, `forbid(unsafe)`,
  unvetted correctness/longevity — stays a documented alternative, no
  second implementation (owner's "both" = i_overlay primary + recorded
  comparison in `01-research.md`).
- Hand-rolled clipping (rejected): robust boolean ops are famously hard;
  buying them is the entire point of the dependency.

## Consequences

- `nary-core` gains `i_overlay 9` (+ `i_float`/`i_shape`/`i_tree`/
  `i_key_sort` transitives, all MIT/Apache, pure Rust). `nary-geometry`
  stays zero-dep (the dep lives in core, behind `path_boolean.rs`).
  `workspace_wiring` allow-list grows by exactly `i_overlay`.
- No wire-schema change: the four `boolean.*` ops take the same `{ids}`;
  paths now succeed where they returned `unsupported`.
- Bundle note: i_overlay adds monomorphized polygon code to native/wasm
  artifacts (measured in the next publish-size pass, not hand-waved).

## References

- `docs/engine/01-research.md` §2 (ecosystem table), ADR-0005 (deps),
  ADR-0017 (render stays data)
