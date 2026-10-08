# AGENTS.md — Instructions for AI Coding Agents

This document MUST be read before doing any task in this repository.

If a task instruction contradicts this document or an established project constraint, do not guess or silently override the constraint. Stop and ask the user for a decision.

## 1. Project

OpenNary is a lightweight and efficient canvas drawing engine similar to Excalidraw and TLDraw.

The engine is a Rust workspace under `crates/*` and is distributed through:

* npm as `@fazelstudio/opennary` using `wasm-pack`
* PyPI as `opennary` using `maturin`

The engine has zero framework dependencies. Engine crates must not import React, Vue, or other UI frameworks, and must not access the DOM or Canvas directly.

Hosts such as the Tauri desktop application, browser applications, and custom UIs render the deterministic `RenderModel` produced by the engine.

## 2. Required Reading

Before working on a task, read the documentation relevant to that task.

### Always read

* `docs/PRD.md` — feature scope and explicit in/out boundaries.
* `docs/ARCHITECTURE.md` — technical contract, data structures, rendering patterns, and spatial index.
* `crates/README.md` — crate map, dependency direction, design rules, and parity notes.

### Read when relevant

* `docs/guides/locale-guide.md` when touching desktop UI text or locales.
* `docs/guides/comment-guidelines.md` when writing, reviewing, or rewriting source-code comments or documentation.

Do not deviate from an established architecture decision without explicit user approval.

## 3. Scope

Work only on the task requested by the user in the current session.

Do not:

* Start another task because it appears related.
* Fix unrelated problems discovered while working.
* Refactor unrelated code.
* Change established architecture decisions without approval.
* Modify project documentation outside the requested scope.

Documentation sync is part of the requested scope: every change to engine
crates (`crates/*`) or hosts (`apps/*`, `packages/*`, `examples/*`) must
also update the related documents in the same session, so information stays
relevant, valid, and current instead of going stale. Code without its doc
update is incomplete.

If completing the requested task requires changing an established architecture decision, stop and ask the user before making that change.

## 4. Architecture Constraints

The following project constraints must be preserved.

* Elements are plain data, not classes. Behavior such as rendering and hit testing is implemented separately from element data.
* Elements are stored in scene coordinates, not screen coordinates. Coordinate conversion occurs at the rendering or input boundary.
* Every element mutation goes through `Document`, which is the sole version/nonce authority.
* Every user intent is represented by a `Command` executed through `HistoryManager`.
* Each user operation must produce one undoable, atomic history entry.
* Element mutation follows the established validate-then-store flow.
* Delete is a soft delete using `isDeleted = true`; elements are not removed from the scene map.
* `opennary-core` must not depend on host bindings, renderers, DOM/Canvas APIs, React, or Tauri.
* `opennary-bindings` is the only crate that owns the JSON-string protocol.
* `opennary` and `opennary-python` are thin wrappers around `opennary-bindings`.
* Host adapters such as Tauri commands, browser JavaScript, and Python integration remain outside the engine crates.

Do not change the element interfaces defined in `docs/ARCHITECTURE.md` without explicit user approval.

## 5. Repository Structure

```text
crates/
  opennary-geometry/  # Pure 2D math: point, bounds, transform, hit, path, spatial, snap, viewport
  opennary-core/      # Document domain and editor session
  opennary-io/        # Interchange: versioned JSON schema, import pipeline, clipboard codec, PNG descriptors
  opennary-bindings/  # Host boundary: JSON-string protocol, Engine facade, render/session DTOs
  opennary/           # npm distribution through wasm-pack
  opennary-python/    # PyPI distribution through maturin/PyO3
  opennary-sdk/       # Rust SDK facade for extensions
  opennary-text/      # Text measurement and shaping helpers

apps/
  desktop/        # Tauri demo application and reference host

packages/
  opennary-sdk/       # TypeScript SDK: typed client, extension registry, overlays

examples/
  custom-button/  # One toolbar scenario on three hosts (Rust/JS/Python)
  ext-sticker/    # Standalone extension example (own workspace)

scripts/
  gen_command_bindings.py  # Single source for generated protocol bindings

generated/
  opennary-commands.d.ts  # Generated TS bindings (checked by CI)
  opennary.pyi            # Generated Python stubs (checked by CI)

docs/
  PRD.md              # Product scope and explicit in/out boundaries
  ARCHITECTURE.md     # Technical contract
  README.md           # Documentation index
  guides/             # Usage and contributor guides (js, python, desktop,
                      # commands, extensions, comments, locales)
```

Dependency direction:

```text
opennary / opennary-python
        ↓
opennary-bindings
        ↓
opennary-io
        ↓
opennary-core
        ↓
opennary-geometry
```

The `workspace_wiring` test enforces this dependency direction.

## 6. Code Conventions

* Rust source is the engine source of truth.
* Bun is used for the Tauri desktop application under `apps/desktop`.
* Rust file names use `snake_case.rs`.
* Rust types use `PascalCase`.
* Rust functions, methods, and variables use `snake_case`.
* TypeScript follows the repository's established TypeScript naming conventions.
* Elements remain plain data; do not attach behavior such as rendering or hit testing to element types.
* All element mutations go through `Document`.
* All user intents go through `Command` and `HistoryManager`.
* Deletion is implemented as a soft delete using `isDeleted`.
* Public Rust items must have appropriate Rustdoc because workspace lints enforce `missing_docs`.

Keep documentation concise and focused on behavior, contracts, constraints, and information useful to API consumers.

For detailed source-code comment rules, follow:

`docs/guides/comment-guidelines.md`

## 7. Project Commands

Canonical reference: `DEVELOPMENT.md` — the command list below is a quick
summary; if they diverge, `DEVELOPMENT.md` wins.

Run the commands relevant to the changes made.

### Test

```bash
cargo test --workspace
```

### Lint

The workspace must pass Clippy without warnings:

```bash
cargo clippy --workspace --all-targets -- -D warnings
```

### Format

```bash
cargo fmt --all
cargo fmt --all -- --check
```

### Build

```bash
cargo build --workspace
```

### npm / WASM artifact

Requires `wasm-pack`:

```bash
bun run build:wasm
```

### PyPI artifact

Requires `maturin`:

```bash
bun run build:python
```

### Desktop application

```bash
bun run tauri:dev
```

Use the desktop application for manual verification when the task affects behavior that can be meaningfully verified there.

## 8. Architecture Examples

The following patterns are representative of the repository's architecture.

```rust
// Correct: element data remains separate from behavior.
pub struct RectangleElement {
    pub base: BaseElement,
    pub roundness: Option<f64>,
}

pub fn render_rectangle(
    ctx: &mut RenderContext,
    element: &RectangleElement,
) {
    // ...
}
```

Do not attach rendering behavior directly to the element:

```rust
// Wrong: behavior is attached to the data type.
impl RectangleElement {
    fn render(&self) {
        // ...
    }
}
```

Element mutations must go through `Document`:

```rust
// Correct.
document.upsert(element)?;
```

Do not mutate element state directly when doing so bypasses the established versioning and history rules:

```rust
// Wrong.
element.x = new_x;
```

User intent must be represented as an undoable command:

```rust
// Correct: one user action produces one history entry.
editor.move_elements(ids, dx, dy)?;
```

## 9. Definition of Done

Before reporting a task as complete:

1. Run the relevant formatter, linter, tests, and build checks.
2. Update the related documents in the same session (code + docs ship
   together): engine changes update `crates/README.md` and the relevant
   `docs/guides/*`; host changes update the host README and the relevant
   guide; contract changes update `docs/ARCHITECTURE.md` or `docs/PRD.md`;
   new commands update `docs/guides/commands.md` and `generated/` via
   `scripts/gen_command_bindings.py`. Leave no stale document behind.
3. Verify that the implementation remains within the requested scope.
4. Review the final diff for accidental or unrelated changes.
5. Manually verify behavior in `apps/desktop` when the task affects behavior that requires desktop verification.
6. Report any checks that could not be run and explain why.

Do not claim a check passed unless it was actually run.

## 10. Changes Requiring Explicit Approval

Do not make the following changes without first reporting the issue and receiving user approval:

* Add large dependencies to engine crates.
* Add dependencies that affect WASM/native compatibility without justification.
* Change `BaseElement` or other element interfaces defined by `docs/ARCHITECTURE.md`.
* Add new fields to established element interfaces.
* Replace the established dual-canvas architecture.
* Replace Map-based scene storage with Array-based storage.
* Change or delete documents under `docs/` unless explicitly requested.
* Add React or other UI-framework dependencies to engine crates.
* Introduce global mutation for theme or configuration.
* Add computational-geometry dependencies without reporting the dependency and bundle-size impact.
* Change an established architectural boundary documented in the repository.
* Guess ambiguous interaction behavior when the behavior has not been established by the project's documentation or existing implementation.

When an architecture change appears necessary, stop and ask the user before proceeding.

## 11. Comments and Documentation

Every code change ships with its documentation update. A document that
describes changed behavior must be updated in the same session — never leave
a relevant document outdated. If a guide, README, or contract no longer
matches the implementation, the task is not done.

Source-code comments must follow:

`docs/guides/comment-guidelines.md`

Desktop UI text and locales must follow:

`docs/guides/locale-guide.md`

The guidelines cover:

* Comment purpose and content.
* Clarity, concision, and consistency.
* Self-contained comments.
* API and module documentation.
* TODO and FIXME comments.
* Safety and correctness comments.
* Restrictions on external references.
* Restrictions on project-management information.
* File and module descriptions.
* When comments should be removed rather than rewritten.

Do not duplicate the detailed comment rules in this file.

## 12. When in Doubt

If the user's instruction is ambiguous, or the task appears to require a decision not established by `docs/PRD.md`, `docs/ARCHITECTURE.md`, or the existing implementation:

* Do not guess.
* Do not silently choose an architecture.
* Ask the user a concise question.
* Explain the specific decision that needs to be made.

One incorrect assumption about the engine's data model or architecture can affect the rest of the project.
