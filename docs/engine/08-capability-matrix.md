# 08 — Capability Matrix (feature ↔ command ↔ test ↔ status)

Source: audit `00` §5, gap analysis `02` §1, reference `05`. Status:
✅ present + tested · 🟡 partial · ❌ absent with plan. Every ✅/🟡 row names a
command; no capability is internal-only.

## Document & scene

| Feature | Command(s) | Test | Status |
|---|---|---|---|
| Scene store (Map + order + nonce) | `io.importScene`, `io.exportScene`, `session.state` | `document_model` (19) | ✅ |
| Soft delete + tombstones | `node.delete`, `selection.delete` | `document_model`, `parity_model` | ✅ |
| Frame | `node.create`, `view.renderModel` (clip partition) | `document_model` | ✅ |
| Group / ungroup + drill-in | `node.group`, `node.ungroup` | `bindings_model`, `parity_model` | ✅ |
| Component/instance + overrides | `node.create` (instance), resolve (render) | `nary-core` units (20) | 🟡 (no nesting/variants) |
| Custom types + plugins | `node.create` (custom), `tool.activate` (custom tool), `plugin.execute` (commands) | `plugin_example` (4), `plugin_commands` (6), `plugin_protocol` (3), `command_coverage` (2) | 🟡 (import skips unknown types by design, pinned in `io_model`; commands/tools flow into the live session since M1) |
| Out-of-workspace SDK example | `plugin.execute` (`example.sticker.create`) | `ext-sticker` (3, own workspace) | ✅ |
| Custom-button demos (Rust/JS/Python) | `tool.activate`, pointer ops, `session.state`, `view.renderModel` | runnable examples vs real artifacts | ✅ |
| Generated `.d.ts`/`.pyi` parity | all 78 wire ops | generator `--check` (CI) + `tsc` + protocol cross-check | ✅ |
| TypeScript SDK (client + registry) | all 78 wire ops via `batch()` + typed helpers | `tsc --noEmit` + runnable bun example vs real wasm | ✅ |
| Rust SDK facade | plugin traits + registry (re-export) | `sdk_surface` (1) | ✅ |
| Dependency security gate | advisories + bans + licenses + sources | `cargo deny check` green (deny.toml, engine scope) | ✅ (pyo3 0.29 upgrade killed 2 RUSTSEC) |
| Lock/hide | `node.setLocked`, `node.create/update` | `document_model` | ✅ |
| Z-order | `node.reorder`, `node.bringToFront/SendToBack/BringForward/SendBackward` | `parity_model`, `bindings_react` | ✅ |
| Schema v1 + repair + clipboard codec | `io.importScene/exportScene`, `clipboard.*` | `io_model` (21, TS goldens) | 🟡 (v1 only; M4) |
| Pages | — | — | ❌ (no plan until host demand) |

## Shapes & style

| Feature | Command(s) | Test | Status |
|---|---|---|---|
| Rectangle/ellipse/line/arrow/text/freedraw/image/path | `node.create`, `node.setBounds/Rotation` | `parity_model` (57) | ✅ (rect radius single; arc/ring ❌) |
| Pen session | `pen.begin/click/dragHandle/commit/cancel` | `layout_binding_ops` | ✅ |
| Path edit session | `path.begin/press/drag/release/commit/cancel` | `layout_binding_ops` | ✅ |
| Crop session | `crop.start/drag/commit/cancel` | `layout_binding_ops` | ✅ |
| Solid fill / stroke / opacity | `style.set` | `bindings_model` | ✅ |
| Linear/radial gradient | stored + `style.set` gradient objects (shared io fill parser) | `bindings_model`, `io_model` | ✅ (angular/diamond still ❌ — needs element field, approval-gated) |
| Align (6) / distribute (2) | `align.align`, `distribute.distribute` | `layout_binding_ops` | ✅ |
| Constraints / manual auto-layout / block resize | `node.setBounds/Rotation` (constraints inside), `layout.applyAutoLayout`, `selection.resize` | units + `layout_binding_ops` | ✅/🟡 (no live re-layout) |
| Arrow binding follow | `node.move`, `node.setBounds`, `selection.nudge`, `clipboard.paste` (inside) | `layout_binding_ops` | ✅ |

## Interaction, history, view, I/O, observability

| Feature | Command(s) | Test | Status |
|---|---|---|---|
| Click/marquee/additive select | `tool.pointerDown/Move/Up`, `selection.set` | `interaction_model` (46) | ✅ (box-rubber indexed; lasso M3) |
| Move/resize/rotate + previews | `node.move/setBounds/setRotation`, `view.previewMove/Resize/Rotate` | `parity_model`, `bindings_react` | ✅ (single-rotate; multi-rotate M3) |
| Snap (grid/object/guides) | `node.move` (inside), `session.configure` | `parity_model`, `geometry_model` | 🟡 (no spacing-distribution op) |
| Pan/zoom + viewport + culling | `view.wheel`, `view.setViewport`, `view.fit/fill`, `view.renderModel` | `bindings_react`, `geometry_model`, `viewport_frame` (4), `render_golden` | ✅ (golden-locked DTO; tile cache follow-up) |
| Text + IME sessions | `text.*` (10 commands) | `bindings_react`, `parity_model` | 🟡 (plain text; `parley` deferred) |
| Clipboard (internal, fresh ids) | `clipboard.copy/paste/duplicate/cut` | `clipboard_model` (19) | ✅ |
| Undo/redo (atomic, coalesced) | `edit.undo/redo` | `history_model` (18) | ✅ (linear, max 100) |
| PNG/JPEG/WebP plans / JSON / assets | `view.renderModel`, `io.*`, `asset.notifyChanged`, `plan_*_export` methods | `io_model`, `bindings_react`, `bindings_model` | ✅ plans (raster + fetch host-side, by design) |
| Outline / offset / simplify / SVG / PDF / video / pages / skew / eraser / tracing | — | — | ❌ (SVG import needs `usvg` dep approval; outline/offset need path-boolean ADR; rest on demand — see M4 status) |
| Events + introspection | `session.drainEvents/state`, `selection.contextMenu`, `view.*` previews | `bindings_react` (37) | ✅ (finer `docChanged` granularity M1) |
| Boolean ops (rect-exact) | `boolean.union/subtract/intersect/exclude` | `boolean_ops` (3), `boolean_model` (3), geometry `boolean` (3 + 500-box invariants) | ✅ rect-only (paths → explicit `unsupported`; `i_overlay` follow-up needs approval) |

## Harness status (M5 landed)

✅ `criterion` series 1k/10k/100k/1M (`nary-core` + `nary-io` benches, numbers
in `07-performance.md` §2.5) · ✅ `proptest` (geometry rotation/boolean,
io fill parsing) + deterministic LCG properties (history undo/redo
invariants) · 🟡 `cargo-fuzz`: deterministic adversarial corpus
(`adversarial_parsers.rs`) stands in on the stable-only toolchain; wire the
same shapes into fuzz targets as follow-up · ✅ DAG-asserting
`workspace_wiring` (path edges + external deps per layer) · ✅ stored render
goldens · follow-ups: CI regression gate, Python/Tauri integration tests,
tightened snap/rotate asserts.
