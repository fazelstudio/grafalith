# Command Reference

All 88 commands. Audience: host developers calling the engine through the
JSON-string protocol.

Every capability is reachable through a unique command. Wire `op` strings are
frozen (protocol v1); command IDs use `namespace.action`.
`H` = history entry when the document changes. `Q` = read-only query (no
history, observes prior ops in the same batch). Results are `ok/data` or a
stable `code` (`invalidInput`, `notFound`, `invariantViolation`, `unsupported`,
`parseError`) + message. Source of truth: `crates/grafalith-bindings/src/protocol.rs`
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
| `group.rename` | `renameGroup` | `groupId`, `name` (trimmed, empty rejects, duplicates allowed) | ✅ | — |
| `group.reparent` | `reparentGroup` | `groupId`, `parentGroupId?` (cycles, locked source/destination, and locked-ancestor escapes reject atomically; descendant paths rewrite in the same entry) | ✅ | — |
| `node.moveToGroup` | `moveToGroup` | `ids[]`, `groupId?`, `index?` (parent-relative insertion index, clamped; locally locked leaves travel with flags intact, locked-ancestor escapes reject) | ✅ | — |
| `group.setLocked` | `setGroupLocked` | `ids[]`, `locked` (container locks inherit to descendants without rewriting child flags) | ✅ | — |
| `node.rename` | `renameNode` | `id`, `name` (any node: groups, frames, or labeled elements; trimmed, empty rejects, duplicates allowed) | ✅ | — |
| `node.reparent` | `reparentNodes` | `ids[]` (elements and groups), `parentGroupId?`, `index?` (subtrees travel once, cycles and locked escapes reject) | ✅ | — |
| `node.duplicateHierarchy` | `duplicateNodes` | `ids[]` (fresh ids throughout, parents/order/geometry/locks preserved) | ✅ | fresh ids |
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
| `session.configure` | `configure` | `enabledTools` (absent/null/array), `theme`, `snap` partials, `canvasMode` (`{"mode":"infinite"}` or `{"mode":"bounded",width,height}` in scene units) | — | bumps `asset_generation` |
| `session.state` | `sessionState` | — | Q | selection/tool/viewport/text/phase/undo-redo/allow-list/generations/pen/crop/path/canvasMode |
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

The desktop `Lock` command toggles the selected elements: a selection with
any unlocked member is locked, while an entirely locked selection is unlocked.
Hosts that need deterministic behavior can continue to call `setLocked`
directly with an explicit boolean.

Locking is local plus inherited: every node keeps its own flag while the
observed state walks ancestor containers (`effective = local || any ancestor
locked`). Locking a group never rewrites child flags; unlocking restores each
descendant to its stored flag. Direct canvas transforms need an effectively
unlocked node, except that moving a whole unlocked group carries locally locked
children as inherited motion. Structural paths accept locally locked leaves
with flags preserved but never let a node escape a locked ancestor. The Layers
panel may still select effectively locked rows for explicit unlock while canvas
hit-testing skips them.

Groups are pure organizational containers without transform, clip, or effects,
so grouping, ungrouping, and reparenting preserve scene-space geometry by
construction. Containers dissolve inside the triggering transaction once they
hold fewer than two direct children, bottom-up, with survivors promoted to the
dissolved slot and order kept contiguous. Element display names live in three
dedicated stores (group records, frame titles, explicit labels for other
elements); renames trim, reject empties, and allow duplicates because names are
never identity. Paste starts unlocked while in-place duplication preserves
local locks; both mint fresh group ids so copies never merge into sources.

Grouping is atomic with respect to locking: if any live selected element is
locked, the entire `group` operation fails and no selected element is added
to a group. Unlock the selection first, then group it.

The desktop Layers surface mirrors `groupIds` as nested folder-like rows.
Locked members are not selectable or draggable with the left pointer; the
right-click path can still target them so `unlock` remains available.

## Extension commands (dynamic dispatch)

| Command ID | Wire op | Input | H | Result data |
|---|---|---|---|---|
| `extension.execute` | `executeCommand` | `commandId` (e.g. `acme.sticker.create`; registration is native) | ✅ iff the command stored anything | `{affected: [], changed}` |

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
| `tool.commitDraw` | `commitDraw` | `requestId?` (one per press; repeat returns stored id), `shape, origin{x,y}, current{x,y}` (scene), `trail?[{x,y}]` (freedraw only) | ✅ (one entry; below-minimum stores nothing, `id` null) | `{id}` (new element id, stored id on requestId repeat, or null) |
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
| `view.previewResize` | `previewResize` | `id, handle, x,y, lockAspect=false` | Q | commit box, guides |
| `view.previewRotate` | `previewRotate` | `id, anchor{x,y}, current{x,y}, snap=false` | Q | commit angle |
| `view.renderModel` | `renderModel` | `canvasWidth,canvasHeight, showGrid, gridSize?, readyImages[], viewport?` (one-shot override for export; session untouched) | Q | `RenderModelDto` |
| `export.planPng` | `planPngExport` | `options?` (`background`, `padding`, `scale`) | Q | content bounds + canvas px + effective scale |

The wire `op` strings are frozen (protocol v1, additive growth only).
