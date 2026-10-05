# ADR-0016: Command-System Conventions

Date: 2026-10-04. Status: accepted. Context: owner requirement "every capability
has a unique command" (`docs/engine/03-architecture.md` §3).

## Decision

- IDs are `namespace.action` (lowerCamel after the dot), globally unique, stable
  forever; collisions are hard errors; external namespaces mandatory
  (`acme.*`). Full map: `docs/engine/05-command-reference.md`.
- One JSON command schema is the source of truth → Rust types, TS `.d.ts`,
  Python `.pyi`, reference docs. Parity is mechanical, not hand-kept.
- Dynamic `executeCommand(id, payload)` dispatches through
  `PluginRegistry::command_by_id`; introspection (`list/describe/can/dryRun`)
  generalizes the existing `preview_*`/`contextMenu`/`sessionState` machinery.
- Results are structured (`ok/data` or stable `code` + message); undoable by
  default with declared coalescing; keymaps are a separate extension (never
  part of commands); events are fine-grained (`docChanged` vs `selectionOnly`).
- Naming-linter test + coverage matrix (`docs/engine/08-capability-matrix.md`)
  fail CI on violations or unmapped capabilities.

## Options considered

- CodeMirror-style no-registry (keymap arrays tried in order): rejected for the
  wire boundary — hosts, scripts, and AI need stable introspectable IDs, which
  bare function arrays do not provide over JSON.
- Central registry with codegen (chosen): fits the existing `BatchOp`
  dispatch (72 ops since M1) and the JSON-string protocol (ADR-0010/0011/0013).

## Consequences

- The built-in ops are renamed only in documentation (wire strings unchanged —
  protocol v1 frozen); `executeCommand` is additive (M1, tested).
- `setStyle` gradient stays `unsupported` until the fill-DTO phase (ADR-0010
  note carried forward).

## References

- `docs/engine/03-architecture.md` §3, `docs/engine/05-command-reference.md`,
  `docs/engine/08-capability-matrix.md`
- Context7 `/websites/codemirror_net` (commands/keymap/precedence, 2026-10-04)
- Prior ADRs: 0007 (command/history), 0010 (wasm binding), 0011 (react/host),
  0012 (plugin scope), 0013 (tauri IPC)
