# AGENTS.md — Repository Instructions for AI Agents

Read this file before making any repository change. Also read any `AGENTS.md` in the directories you will modify.

## 1. Agent execution standard

The goal is to complete the requested scope correctly and thoroughly—not merely to produce a small diff or make the happy path work. Do not interpret scope control as permission to skip necessary edge cases, integration, tests, or documentation. At the same time, do not add speculative features, unnecessary abstractions, or unrelated refactors.

For non-trivial tasks, follow this workflow:

1. **Explore:** Read this file and applicable nested `AGENTS.md` files. Inspect relevant documentation, source, tests, manifests, callers, generated files, and host integrations before editing.
2. **Analyze:** Compare intended behavior with current behavior. Trace the relevant flow end-to-end, identify the root cause or missing capability, and list invariants, failure modes, edge cases, and affected boundaries.
3. **Decide:** Establish whether the existing implementation is correct, incomplete, incorrect, or inefficient before adding or replacing code. Reuse correct implementations; change them when evidence shows a defect or a contract gap. Do not create parallel implementations of the same responsibility.
4. **Implement:** Complete the requested acceptance criteria across every affected layer within scope. Preserve architectural contracts, state ownership, error behavior, compatibility, and existing functionality. Do not stop after a plan, scaffolding, or a happy-path-only change.
5. **Test:** Add or update meaningful unit, integration, and regression tests. Cover relevant invalid inputs, boundary conditions, failure paths, state transitions, and interactions with existing features—not just the new function in isolation.
6. **Verify:** Run the relevant formatter, linter, tests, build, typecheck, code-generation checks, and manual host checks when applicable. For performance-sensitive changes, inspect complexity and allocations; benchmark when useful and feasible rather than claiming performance from intuition.
7. **Review:** Inspect the complete diff for stale or duplicated logic, partial integrations, accidental scope creep, missed generated files, and documentation drift. Report the actual results and any remaining blockers.

Choose the simplest design that fully satisfies the requirements and established contracts. “Simple” must not mean incomplete; “thorough” must not mean over-engineered. If a blocker prevents full completion, finish all safe, independent work and state exactly what remains, why it is blocked, and what decision or environment is needed. Never silently leave known essential work unfinished or claim unverified success.

## 2. Reference map

| Task | Read these references when relevant |
|---|---|
| Product scope or behavior | `docs/PRD.md` |
| Data model, module boundaries, mutation, rendering, history, or protocol | `docs/ARCHITECTURE.md`, `DESIGN.md`, `crates/README.md`, relevant crate docs/source |
| Public commands or generated host bindings | `docs/guides/commands.md`, `scripts/gen_command_bindings.py`, generated files |
| JavaScript/TypeScript or Python integration | The matching guide under `docs/guides/` and the binding crate |
| Desktop UI or localization | `apps/desktop/` instructions and `docs/guides/locale-guide.md` |
| Source-code comments | `docs/guides/comment-guidelines.md` |
| Build, test, lint, packaging, or release | `DEVELOPMENT.md` or `RELEASING.md` |

A task-specific instruction to read a document does not make that document optional. If a reference is missing or contradictory, inspect the source and report the discrepancy rather than inventing its contents.

## 3. Project boundaries

- Grafalith's engine is implemented in Rust. Engine crates must remain independent of React, Vue, Tauri, DOM APIs, and host rendering APIs.
- The engine produces deterministic render data (including the applicable `RenderModel` contract); hosts render it and own platform-specific UI and input integration.
- Keep element/document data separate from behavior such as rendering, hit testing, and interaction handling.
- Store document geometry in scene/document coordinates. Convert screen coordinates at the host input or rendering boundary.
- All document mutations must pass through the established `Document` mutation path so versioning, invalidation, and invariants remain centralized.
- User operations must use the established command/history mechanism and remain atomic and undoable where the operation is user-visible.
- Preserve the repository's soft-delete behavior (`isDeleted`) unless an approved architecture change says otherwise.
- `grafalith-bindings` owns the host JSON-string protocol. Wrapper crates and host adapters must not introduce competing protocol or domain implementations.
- Follow dependency direction and crate responsibilities documented in `crates/README.md`, Cargo manifests, and the verified architecture contract.

## 4. Scope and design decisions

- Change only what is required by the current task. Do not opportunistically fix unrelated issues or perform broad refactors.
- Reuse existing APIs and abstractions when they are correct. Do not create parallel state, caches, command paths, or duplicated business rules without a demonstrated need.
- Prefer measured performance improvements. Avoid unnecessary full-document cloning, repeated tree-wide scans, redundant allocations, polling, or per-event work in hot paths.
- Do not guess ambiguous product behavior. Check the PRD, architecture/design notes, tests, and established conventions. If a consequential decision remains unresolved, explain the options and ask for direction.
- Do not change established data contracts, dependency boundaries, serialization formats, or major rendering architecture without explicit maintainer approval.
- Do not add a substantial dependency, especially one affecting WASM/native compatibility or bundle size, without reporting the trade-off and obtaining approval where required.

## 5. Documentation and generated files

Documentation is part of the implementation. Update the smallest relevant set of documents in the same task:

- Public behavior or scope changes: `docs/PRD.md` or the relevant guide.
- Architectural invariants or cross-crate contracts: `docs/ARCHITECTURE.md` and, if needed, `DESIGN.md`.
- Crate responsibilities or dependency direction: `crates/README.md`.
- Public commands/protocol: command guide and generated bindings through the repository's generator.
- Development or release workflow: the relevant root guide.

Do not duplicate long instructions across files; link to the canonical reference. Do not edit generated artifacts by hand when they are produced by a generator.

## 6. Checks and definition of done

Use `DEVELOPMENT.md` for canonical commands. Run the checks relevant to the change, review the final diff, and manually verify host behavior when a desktop interaction is affected and the environment permits it.

A task is complete only when:

- the change addresses the root cause and preserves existing invariants;
- regression tests cover the important behavior and edge cases;
- related docs and generated artifacts are current;
- no unrelated files or changes were introduced;
- the final report lists actual checks and their results, including any checks that could not run.

Never claim a test, build, lint, benchmark, or manual check passed unless it was actually run.

## 7. When instructions conflict

If the task conflicts with an established contract or requires a consequential architecture change, do not silently choose a direction. Describe the precise conflict and request maintainer approval. For ordinary implementation details already determined by source and tests, proceed without unnecessary questions.
