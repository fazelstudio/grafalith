# 05 — Command Reference (all 78 commands)

Every capability is reachable through a unique command. Wire `op` strings are
frozen (protocol v1); command IDs follow ADR-0016 (`namespace.action`).
`H` = history entry when the document changes. `Q` = read-only query (no
history, observes prior ops in the same batch). Results are `ok/data` or a
stable `code` (`invalidInput`, `notFound`, `invariantViolation`, `unsupported`,
`parseError`) + message. Source of truth: `crates/nary-bindings/src/protocol.rs`
(`BatchOp`, `op_name`) and `engine.rs` dispatch. Tests: `bindings_model.rs`,
`bindings_react.rs`, `layout_binding_ops.rs`, `parity_model.rs`,
`interaction_model.rs`.

## Document & nodes

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `node.create` | `create` | `element` (scene-JSON object) | ✅ | created `id` | `bindings_model` |
| `node.delete` | `delete` | `ids[]` | ✅ | — | `bindings_model` |
| `node.move` | `move` | `ids[], dx, dy` (scene units) | ✅ | — | `parity_model` (drag) |
| `node.setBounds` | `setBounds` | `id, x, y, width, height` (≥1) | ✅ | — | `parity_model` (resize) |
| `node.setRotation` | `setRotation` | `id, rotation` (radians) | ✅ | — | `parity_model` (rotate) |
| `node.setLocked` | `setLocked` | `ids[], locked` | ✅ | — | `bindings_model` |
| `node.reorder` | `reorder` | `order[]` (back-to-front) | ✅ | — | `parity_model` |
| `node.group` | `group` | `ids[]` | ✅ | `groupId` | `bindings_model` |
| `node.ungroup` | `ungroup` | `groupId` | ✅ | — | `bindings_model` |
| `node.bringToFront` | `bringToFront` | `ids[]` | ✅ | — | `bindings_react` |
| `node.sendToBack` | `sendToBack` | `ids[]` | ✅ | — | `bindings_react` |
| `node.bringForward` | `bringForward` | `ids[]` | ✅ | — | `bindings_react` |
| `node.sendBackward` | `sendBackward` | `ids[]` | ✅ | — | `bindings_react` |
| `selection.nudge` | `nudge` | `dx, dy` (selection) | ✅ | — | `parity_model` |
| `selection.delete` | `deleteSelected` | — (selection) | ✅ | — | `bindings_model` |
| `selection.resize` | `resizeSelection` | `ids[], original{minX..}, next{minX..}` | ✅ | — | `layout_binding_ops` |

## Style, align, layout

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `style.set` | `setStyle` | `ids[], patch` (scalars; gradient → `unsupported`) | ✅ | — | `bindings_model` |
| `align.align` | `align` | `ids[], mode: left\|right\|top\|bottom\|centerH\|centerV` | ✅ | — | `layout_binding_ops` |
| `distribute.distribute` | `distribute` | `ids[], axis: horizontal\|vertical` (<3 valid = no-op) | ✅ | — | `layout_binding_ops` |
| `layout.applyAutoLayout` | `applyAutoLayout` | `frameId` | ✅ | — | `layout_binding_ops` |

## Selection, tools, session

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `selection.set` | `select` | `ids[]` | — | — | `bindings_model` |
| `tool.activate` | `setTool` | `tool` (unknown kept as custom; allow-list gated) | — | `false` when rejected | `bindings_model` |
| `session.configure` | `configure` | `enabledTools` (absent/null/array), `theme`, `snap` partials | — | bumps `asset_generation` | `bindings_react` |
| `session.state` | `sessionState` | — | Q | selection/tool/viewport/text/phase/undo-redo/allow-list/generations/pen/crop/path | `bindings_react` |
| `session.drainEvents` | `drainEvents` | — | Q | queued events, oldest first (clears) | `bindings_react` |
| `selection.contextMenu` | `contextMenu` | — | Q | applicable intents (host renders) | `bindings_react` |

## Boolean operations (rectangles, exact)

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `boolean.union` | `booleanUnion` | `ids` (exactly two unrotated rectangles) | ✅ | `{affected, changed}` (inputs consumed, disjoint cover on top) | `boolean_ops` |
| `boolean.subtract` | `booleanSubtract` | `ids` (exactly two) | ✅ | `{affected, changed}` (full cover destroys both) | `boolean_ops` |
| `boolean.intersect` | `booleanIntersect` | `ids` (exactly two) | ✅ | `{affected, changed}` | `boolean_ops` |
| `boolean.exclude` | `booleanExclude` | `ids` (exactly two) | ✅ | `{affected, changed}` | `boolean_ops` |

Arity violations are `invalidInput`, unknown/deleted ids `notFound`, locked or
rotated inputs `invalidInput`, and non-rectangle inputs the stable
`unsupported` code (path booleans are a follow-up behind a precision ADR).

## Plugin commands (dynamic dispatch)
| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `plugin.execute` | `executeCommand` | `commandId` (e.g. `acme.sticker.create`; registration is native) | ✅ iff the command stored anything | `{affected: [], changed}` | `plugin_protocol` |

Unknown ids are a per-op `notFound` error that changes nothing and never
fails the batch. Introspection beyond `plugin.execute` (`commands.list /
describe / can / dryRun`) stays roadmap M1-follow-up; the dispatch seam is
`PluginRegistry::command_by_id`.

## Clipboard & history

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `clipboard.copy` | `copy` | `ids[]` | — | — | `clipboard_model` |
| `clipboard.paste` | `paste` | `target?{x,y}` (default cascade) | ✅ | fresh ids | `clipboard_model` |
| `clipboard.duplicate` | `duplicate` | `ids[]` | ✅ | fresh ids | `clipboard_model` |
| `clipboard.cut` | `cut` | `ids[]` | ✅ | — | `clipboard_model` |
| `edit.undo` | `undo` | — | — | — | `history_model` |
| `edit.redo` | `redo` | — | — | — | `history_model` |

## I/O & assets

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `io.importScene` | `importScene` | `scene{schemaVersion,elements,elementOrder}, tracked=false` | ✅ iff `tracked` | skipped count | `io_model` |
| `io.exportScene` | `exportScene` | — | Q | scene JSON string | `io_model` |
| `asset.notifyChanged` | `notifyAssetsChanged` | — | — | bumps `asset_generation` | `bindings_react` |

## Normalized input (tools)

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `tool.pointerDown` | `pointerDown` | `x,y` (screen px), `button`, `modifiers`, `clickCount` | —/✅ | phase/intent | `bindings_react` |
| `tool.pointerMove` | `pointerMove` | `x,y, modifiers` | — | — | `bindings_react` |
| `tool.pointerUp` | `pointerUp` | `x,y, button, modifiers` | ✅ per gesture | — | `bindings_react` |
| `tool.pointerCancel` | `pointerCancel` | — | — | — | `bindings_react` |
| `tool.key` | `keyDown` | `key, modifiers` | ✅ for delete/nudge/undo/redo | `UnhandledIntent` for clipboard (host routes) | `bindings_react` |
| `view.wheel` | `wheel` | `dx,dy, zoomGesture, x,y` | — | — | `bindings_react` |
| `view.setViewport` | `setViewport` | `scrollX,scrollY,zoom` (clamped 0.1–10) | — | — | `bindings_react` |
| `view.fit` | `fitViewport` | `canvasWidth,canvasHeight, padding=0, ids?` (absent = all visible) | — | `{viewport}` | `viewport_frame` |
| `view.fill` | `fillViewport` | `canvasWidth,canvasHeight, padding=0, ids?` (edges may crop) | — | `{viewport}` | `viewport_frame` |

## Text & IME

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `text.startAt` | `startTextAt` | `x,y` (scene) | ✅ iff created | — | `bindings_react` |
| `text.input` | `textInput` | `text` (refused mid-composition) | — | — | `bindings_react` |
| `text.backspace` | `textBackspace` | — (errors without session) | — | — | `bindings_react` |
| `text.deleteForward` | `textDelete` | — (errors without session) | — | — | `bindings_react` |
| `text.setCaret` | `textSetCaret` | `caret` (clamped) | — | `caret` | `bindings_react` |
| `text.compositionStart` | `compositionStart` | — | — | — | `bindings_react` |
| `text.compositionUpdate` | `compositionUpdate` | `buffer` (buffered only) | — | — | `bindings_react` |
| `text.compositionEnd` | `compositionEnd` | `finalText` (merged at caret) | — | — | `bindings_react` |
| `text.commit` | `commitText` | — | ✅ | — | `parity_model` |
| `text.cancel` | `cancelText` | — | — | — | `bindings_react` |

## Pen, crop, path-edit sessions

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `pen.begin` | `penBegin` | — | — | — | `layout_binding_ops` |
| `pen.click` | `penClick` | `x,y` (scene) | — | `closed` | `layout_binding_ops` |
| `pen.dragHandle` | `penDragHandle` | `x,y, altBreak=false` | — | — | `layout_binding_ops` |
| `pen.commit` | `penCommit` | — | ✅ | path `id` or `committed:false` | `layout_binding_ops` |
| `pen.cancel` | `penCancel` | — | — | — | `layout_binding_ops` |
| `crop.start` | `cropStart` | `id` (image) | — | — | `layout_binding_ops` |
| `crop.drag` | `cropDrag` | `handle, x,y` (natural px) | — | — | `layout_binding_ops` |
| `crop.commit` | `cropCommit` | — | ✅ | — | `layout_binding_ops` |
| `crop.cancel` | `cropCancel` | — | — | — | `layout_binding_ops` |
| `path.begin` | `pathEditBegin` | `id` (path) | — | — | `layout_binding_ops` |
| `path.press` | `pathEditPress` | `x,y, zoom=1, alt=false` | — | `anchor\|handle\|add\|delete\|none` | `layout_binding_ops` |
| `path.drag` | `pathEditDrag` | `x,y, altBreak=false` | — | — | `layout_binding_ops` |
| `path.release` | `pathEditRelease` | — | — | — | `layout_binding_ops` |
| `path.commit` | `pathEditCommit` | — | ✅ | — | `layout_binding_ops` |
| `path.cancel` | `pathEditCancel` | — | — | — | `layout_binding_ops` |

## Read-only previews & render

| Command ID | Wire op | Input | H | Result data | Test |
|---|---|---|---|---|---|
| `view.previewMove` | `previewMove` | `ids[], from{x,y}, to{x,y}, axisLock=false` | Q | `dx,dy, guides` | `bindings_react` |
| `view.previewResize` | `previewResize` | `id, handle, x,y, lockAspect=false` | Q | commit box | `bindings_react` |
| `view.previewRotate` | `previewRotate` | `id, anchor{x,y}, current{x,y}, snap=false` | Q | commit angle | `bindings_react` |
| `view.renderModel` | `renderModel` | `canvasWidth,canvasHeight, showGrid, gridSize?, readyImages[]` | Q | `RenderModelDto` | `bindings_react` |

The wire `op` strings are frozen (protocol v1, additive growth only).
