# ADR-0019: Extension Ecosystem — TypeScript Primary, Rust Native

Date: 2026-10-06. Status: accepted. Context: owner question whether the SDK
should be Rust-only (shipped to npm via wasm for consistency).

## Decision

Both, with strict roles:

- **TypeScript SDK (`packages/nary-sdk`) is the primary extension surface**
  (VSCode model): extension manifests, activation/disposal, tool
  contributions, overlay renderers, and a typed engine client — all over
  the existing JSON-string protocol, generated from the same `COMMANDS`
  table as the other bindings.
- **Rust SDK (`crates/nary-sdk`) stays a thin facade** (re-exports only)
  for in-process native plugins: new node types, history-integrated
  commands, and format handlers.

## Options considered

1. Rust-only SDK shipped to npm via wasm (rejected): plugin `trait`
   objects cannot cross the wasm boundary (the codebase forbids it:
   WASM contracts are serializable/handle-based), so a wasm-compiled SDK
   could only re-format JSON at the cost of glue overhead, worse stack
   traces, and a duplicated serde in the bundle — negative value versus
   TypeScript written directly against `JsEngine`.
2. TypeScript-only SDK (rejected): `Custom` payloads and
   `CommandExtension` are Rust traits that never cross JSON (unknown scene
   types skip on import by design); without the Rust facade, new node
   types and history commands would be inexpressible.
3. Both, split by capability (chosen): consistency is kept where it is
   verifiable — one `COMMANDS` table generates the `.d.ts`, `.pyi`, and
   SDK protocol types, machine-checked against `protocol.rs` — instead of
   language uniformity, which the repo never had (Rust engine, TS host,
   Python package by design, ADR-0011).

Out of scope (unchanged): a runtime wasm-plugin sandbox (loading
third-party `.wasm` in the browser with capability sandboxing) stays
deferred per ADR-0017 — it is a separate architecture project, not an SDK
packaging choice.

## Consequences

- Extension authors choose by capability: UI/tools/panels/overlays/
  automation → TypeScript; node types/history commands/formats → Rust.
  The boundary is documented in `06-extension-guide.md` §5 and the
  `packages/nary-sdk` README.
- `packages/*` joins the bun workspaces; CI typechecks the SDK and runs
  its example against a fresh `wasm-pack` node build.

## References

- `docs/engine/03-architecture.md` §2, `docs/engine/06-extension-guide.md`,
  ADR-0010/0011/0012/0017
