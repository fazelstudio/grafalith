# ext-sticker — out-of-workspace extension example

A third-party OpenNary extension that lives **outside** the engine workspace
(`examples/` is excluded from `Cargo.toml` members). It adds:

- node type `example.sticker` (circle sticker backed by `Element::Custom`),
- tool `example.sticker` (host-owned; the core captures presses for it),
- command `example.sticker.create` (history-tracked, undoable).

It depends on `opennary-core` only, through the public extension traits
(`Extension`, `ShapeExtension`, `CommandExtension`) — no engine sources
modified, no internals touched.

## Run

```bash
cd examples/ext-sticker
cargo test
```

## Use from a host

```rust
use opennary_core::editor::Editor;

let mut editor = Editor::new();
editor.register_extension(Box::new(ext_sticker::StickerExtension::new()))?;
editor.execute_extension_command(ext_sticker::STICKER_CREATE_COMMAND)?;
```

Over the JSON boundary (after native registration), hosts dispatch the
command dynamically:

```json
[{"op": "executeCommand", "commandId": "example.sticker.create"}]
```
