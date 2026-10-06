# Command Reference

All 79 commands. Audience: host developers calling the engine through the
JSON-string protocol.

Every capability is reachable through a unique command. Wire `op` strings are
frozen (protocol v1); command IDs use `namespace.action`.
`H` = history entry when the document changes. `Q` = read-only query (no
history, observes prior ops in the same batch). Results are `ok/data` or a
stable `code` (`invalidInput`, `notFound`, `invariantViolation`, `unsupported`,
`parseError`) + message. Source of truth: `crates/nary-bindings/src/protocol.rs`
(`BatchOp`, `op_name`) and `engine.rs` dispatch.

## Document & nodes

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `node.create` | `create` | `element` (scene-JSON object) | ✅ | created `id` |
| `node.delete` | `delete` | `ids[]` | ✅ | — |
| `node.move` | `move` | `ids[], dx, dy` (scene units) | ✅ | — |
| `node.setBounds` | `setBounds` | `id, x, y, width, height` (≥1) | ✅ | — |
| `node.setRotation` | `setRotation` | `id, rotation` (radians) | ✅ | — |
| `node.setLocked` | `setLocked` | `ids[], locked` | ✅ | — |
| `node.reorder` | `reorder` | `order[]` (back-to-front) | ✅ | — |
| `node.group` | `group` | `ids[]` | ✅ | `groupId` |
| `node.ungroup` | `ungroup` | `groupId` | ✅ | — |
| `node.bringToFront` | `bringToFront` | `ids[]` | ✅ | — |
| `node.sendToBack` | `sendToBack` | `ids[]` | ✅ | — |
| `node.bringForward` | `bringForward` | `ids[]` | ✅ | — |
| `node.sendBackward` | `sendBackward` | `ids[]` | ✅ | — |
| `selection.nudge` | `nudge` | `dx, dy` (selection) | ✅ | — |
| `selection.delete` | `deleteSelected` | — (selection) | ✅ | — |
| `selection.resize` | `resizeSelection` | `ids[], original{minX..}, next{minX..}` | ✅ | — |

## Style, align, layout

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `style.set` | `setStyle` | `ids[], patch` (scalars + `strokeCap`, `strokeJoin`, `strokeAlign` + `background` string or gradient object) | ✅ | — |
| `align.align` | `align` | `ids[], mode: left\|right\|top\|bottom\|centerH\|centerV` | ✅ | — |
| `distribute.distribute` | `distribute` | `ids[], axis: horizontal\|vertical` (<3 valid = no-op) | ✅ | — |
| `layout.applyAutoLayout` | `applyAutoLayout` | `frameId` | ✅ | — |

## Selection, tools, session

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `selection.set` | `select` | `ids[]` | — | — |
| `tool.activate` | `setTool` | `tool` (unknown kept as custom; allow-list gated) | — | `false` when rejected |
| `session.configure` | `configure` | `enabledTools` (absent/null/array), `theme`, `snap` partials | — | bumps `asset_generation` |
| `session.state` | `sessionState` | — | Q | selection/tool/viewport/text/phase/undo-redo/allow-list/generations/pen/crop/path |
| `session.drainEvents` | `drainEvents` | — | Q | queued events, oldest first (clears) |
| `selection.contextMenu` | `contextMenu` | — | Q | applicable intents (host renders) |

## Boolean operations (rectangles exact, paths via flatten + overlay)

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `boolean.union` | `booleanUnion` | `ids` (exactly two unrotated rectangles) | ✅ | `{affected, changed}` |
| `boolean.subtract` | `booleanSubtract` | `ids` (exactly two) | ✅ | `{affected, changed}` |
| `boolean.intersect` | `booleanIntersect` | `ids` (exactly two) | ✅ | `{affected, changed}` |
| `boolean.exclude` | `booleanExclude` | `ids` (exactly two) | ✅ | `{affected, changed}` |

Arity violations are `invalidInput`, unknown/deleted ids `notFound`, locked or
rotated inputs `invalidInput`. Closed-path inputs (path/freedraw/ellipse/
rectangle outlines) run through flatten + overlay and return paths; holed
results are the stable `unsupported` code, degenerate inputs `invalidInput`.

## Plugin commands (dynamic dispatch)

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `plugin.execute` | `executeCommand` | `commandId` (e.g. `acme.sticker.create`; registration is native) | ✅ iff the command stored anything | `{affected: [], changed}` |

Unknown ids are a per-op `notFound` error that changes nothing and never
fails the batch.

## Clipboard & history

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `clipboard.copy` | `copy` | `ids[]` | — | — |
| `clipboard.paste` | `paste` | `target?{x,y}` (default cascade) | ✅ | fresh ids |
| `clipboard.duplicate` | `duplicate` | `ids[]` | ✅ | fresh ids |
| `clipboard.cut` | `cut` | `ids[]` | ✅ | — |
| `edit.undo` | `undo` | — | — | — |
| `edit.redo` | `redo` | — | — | — |

## I/O & assets

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `io.importScene` | `importScene` | `scene{schemaVersion,elements,elementOrder}, tracked=false` | ✅ iff `tracked` | skipped count |
| `io.importSvg` | `importSvg` | `svg` (string), `tracked=false` — `svg` feature only | ✅ iff `tracked` | `{imported, skipped}` |
| `io.exportScene` | `exportScene` | — | Q | scene JSON string |
| `asset.notifyChanged` | `notifyAssetsChanged` | — | — | bumps `asset_generation` |

## Normalized input (tools)

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `tool.pointerDown` | `pointerDown` | `x,y` (screen px), `button`, `modifiers`, `clickCount` | —/✅ | phase/intent |
| `tool.pointerMove` | `pointerMove` | `x,y, modifiers` | — | — |
| `tool.pointerUp` | `pointerUp` | `x,y, button, modifiers` | ✅ per gesture | — |
| `tool.pointerCancel` | `pointerCancel` | — | — | — |
| `tool.key` | `keyDown` | `key, modifiers` | ✅ for delete/nudge/undo/redo | `UnhandledIntent` for clipboard (host routes) |
| `view.wheel` | `wheel` | `dx,dy, zoomGesture, x,y` | — | — |
| `view.setViewport` | `setViewport` | `scrollX,scrollY,zoom` (clamped 0.1–10) | — | — |
| `view.fit` | `fitViewport` | `canvasWidth,canvasHeight, padding=0, ids?` (absent = all visible) | — | `{viewport}` |
| `view.fill` | `fillViewport` | `canvasWidth,canvasHeight, padding=0, ids?` (edges may crop) | — | `{viewport}` |

## Text & IME

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `text.startAt` | `startTextAt` | `x,y` (scene) | ✅ iff created | — |
| `text.input` | `textInput` | `text` (refused mid-composition) | — | — |
| `text.backspace` | `textBackspace` | — (errors without session) | — | — |
| `text.deleteForward` | `textDelete` | — (errors without session) | — | — |
| `text.setCaret` | `textSetCaret` | `caret` (clamped) | — | `caret` |
| `text.compositionStart` | `compositionStart` | — | — | — |
| `text.compositionUpdate` | `compositionUpdate` | `buffer` (buffered only) | — | — |
| `text.compositionEnd` | `compositionEnd` | `finalText` (merged at caret) | — | — |
| `text.commit` | `commitText` | — | ✅ | — |
| `text.cancel` | `cancelText` | — | — | — |

## Pen, crop, path-edit sessions

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `pen.begin` | `penBegin` | — | — | — |
| `pen.click` | `penClick` | `x,y` (scene) | — | `closed` |
| `pen.dragHandle` | `penDragHandle` | `x,y, altBreak=false` | — | — |
| `pen.commit` | `penCommit` | — | ✅ | path `id` or `committed:false` |
| `pen.cancel` | `penCancel` | — | — | — |
| `crop.start` | `cropStart` | `id` (image) | — | — |
| `crop.drag` | `cropDrag` | `handle, x,y` (natural px) | — | — |
| `crop.commit` | `cropCommit` | — | ✅ | — |
| `crop.cancel` | `cropCancel` | — | — | — |
| `path.begin` | `pathEditBegin` | `id` (path) | — | — |
| `path.press` | `pathEditPress` | `x,y, zoom=1, alt=false` | — | `anchor\|handle\|add\|delete\|none` |
| `path.drag` | `pathEditDrag` | `x,y, altBreak=false` | — | — |
| `path.release` | `pathEditRelease` | — | — | — |
| `path.commit` | `pathEditCommit` | — | ✅ | — |
| `path.cancel` | `pathEditCancel` | — | — | — |

## Read-only previews & render

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `view.previewMove` | `previewMove` | `ids[], from{x,y}, to{x,y}, axisLock=false` | Q | `dx,dy, guides` |
| `view.previewResize` | `previewResize` | `id, handle, x,y, lockAspect=false` | Q | commit box |
| `view.previewRotate` | `previewRotate` | `id, anchor{x,y}, current{x,y}, snap=false` | Q | commit angle |
| `view.renderModel` | `renderModel` | `canvasWidth,canvasHeight, showGrid, gridSize?, readyImages[]` | Q | `RenderModelDto` |

The wire `op` strings are frozen (protocol v1, additive growth only).
