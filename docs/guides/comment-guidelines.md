# Comment Guidelines

Comments exist to explain technical information that is not clear from the code itself. Prefer clear code over comments that merely restate implementation details.

## Write useful comments

A comment should be accurate, concise, self-contained, and relevant to the current implementation. Use it to explain non-obvious:

- intent or rationale;
- constraints, assumptions, or invariants;
- correctness, safety, concurrency, or memory-lifetime requirements;
- performance trade-offs or cache invalidation rules;
- compatibility behavior, edge cases, or necessary workarounds.

Explain **why** a choice is necessary, not simply **what** the next line does. Use consistent terminology and enough context that a reader does not need chat history or an external discussion to understand the comment.

## Avoid noise and stale context

Do not add comments that:

- repeat what clear code or identifiers already say;
- translate an identifier into a sentence without adding information;
- speculate about intent that cannot be verified;
- record milestones, phases, plans, progress, ownership, deadlines, or historical implementation notes;
- point to issue/PR numbers, chat, branches, commit hashes, external documentation, or project-management systems;
- use numbered steps or bullet lists for routine inline explanations;
- add generic file-header banners or decorative separators.

Do not add a comment just because nearby code has one. Long conceptual explanations belong in module/API documentation or a design guide, not in a series of inline comments.

## APIs and modules

Document public APIs when consumers need information not evident from the name and type signature, such as purpose, preconditions, important semantics, error behavior, safety requirements, or a meaningful example. Use the language's established documentation syntax. Module-level documentation is appropriate when it explains an important responsibility or boundary; do not add boilerplate descriptions to every file.

For concurrency, unsafe code, memory management, serialization, parsing, or other correctness-sensitive code, document the non-obvious invariant when the code alone does not make it clear. Never assert a guarantee that cannot be established from the implementation.

## TODO, FIXME, and workarounds

Use `TODO` or `FIXME` only for a real unresolved technical issue that belongs near the relevant code. Keep it concise and self-contained. Do not attach project-management data, invented issue references, phases, owners, or deadlines.

When a workaround is necessary, explain the current technical reason it exists and any non-obvious constraint it preserves. Do not preserve obsolete history merely because it once explained the code.

## Tests, generated files, and legal notices

Comments in tests should explain unusual setup, non-obvious assertions, or the regression being protected—not announce an obvious test step.

Do not manually edit comments in generated code. Update the generator/template when appropriate and preserve required generated-file markers.

Preserve copyright notices, licenses, tool directives, and other legally or technically required comments unless an explicit change is needed.

## Reviewing existing comments

When code changes, re-check nearby comments for accuracy. Keep useful comments; clarify or shorten unclear ones; remove comments that merely restate code, rely on obsolete context, or make unsupported claims. Use the appropriate API/module documentation form when the information is too extensive for an inline comment.

Before adding a comment, ask: Does this tell the reader something important that the code does not already tell them? Is it correct, self-contained, and likely to remain useful? If not, do not add it.
