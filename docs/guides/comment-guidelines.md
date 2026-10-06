# Comment Guidelines

This document defines the general rules for writing, reviewing, and maintaining source-code comments in this repository.

These rules are language-independent. Language-specific comment syntax should follow the conventions and tooling of the language being used.

## Purpose

Comments exist to make the code easier to understand.

A good comment provides information that cannot be understood easily from the code itself. It should help a contributor understand the intent, constraints, assumptions, invariants, or non-obvious behavior of the implementation.

Comments are not a replacement for clear code.

Prefer improving the code itself when the code can be made clearer without introducing unnecessary complexity.

## General principles

Comments must be:

* Clear.
* Concise.
* Easy to understand.
* Consistent.
* Accurate.
* Self-contained.
* Relevant to the current implementation.

Write comments for the reader, not for the author.

A contributor should be able to understand a comment without needing to know the history of the implementation or consult external sources.

Prefer simple and precise technical language.

Use consistent terminology throughout the repository. Use the same term when referring to the same concept unless there is a meaningful reason to distinguish them.

## What comments should explain

Prefer comments that explain information that is not obvious from the code, especially:

* Why an implementation choice is necessary.
* Important constraints.
* Assumptions.
* Invariants.
* Non-obvious behavior.
* Safety requirements.
* Compatibility requirements.
* Important performance considerations.
* Non-obvious edge cases.
* Reasons for a workaround.
* Behavior that may otherwise appear incorrect or unusual.

For example:

```text
// Preserve the original path so diagnostics refer to the location
// provided by the user rather than the normalized path.
```

This is useful because the reason for preserving the original path is not obvious from the code alone.

## What comments should not explain

Do not write comments that merely describe what the code obviously does.

Avoid:

```text
// Increment the counter.
counter++;
```

Avoid:

```text
// Get the user name.
const name = user.name;
```

Avoid:

```text
// Loop through the items.
for (const item of items) {
    ...
}
```

The code already communicates this information.

Do not translate identifiers into English and present the result as a comment.

## Explain why, not what

When the behavior is already clear from the code, explain the reason behind it instead.

Prefer:

```text
// Keep the original value because downstream diagnostics use it
// to report the user's input.
```

Instead of:

```text
// Store the original value.
```

The first comment provides information that the code alone may not communicate.

## Self-contained comments

Comments must be understandable on their own.

Do not require the reader to consult another source to understand why the code exists.

Do not write comments such as:

```text
// See the design document for details.
```

or:

```text
// This is required by issue #123.
```

or:

```text
// See the discussion in the pull request.
```

Instead, include the relevant technical reason directly in the comment.

For example:

```text
// Keep the value unresolved here because the parser needs the original
// input to produce accurate diagnostics.
```

## No external references

Do not include external references in source-code comments unless they are required by an established technical or legal convention.

Avoid:

* URLs.
* Issue numbers.
* Pull request numbers.
* Commit hashes.
* Branch names.
* External documentation links.
* Design-document references.
* Chat or conversation references.
* References to external project-management systems.

Source-code comments should describe the current code rather than point to external context.

## No project-management information

Source-code comments are not project-management records.

Do not include:

* Development phases.
* Implementation phases.
* Milestones.
* Roadmaps.
* Progress updates.
* Task plans.
* Migration phases.
* Completion status.
* Historical development notes that are no longer relevant to the current implementation.

Avoid comments such as:

```text
// Phase 2 implementation.
// The next phase will move this logic into the new resolver.
```

If the current implementation requires an explanation, describe the current technical reason instead.

```text
// Keep resolution here because the caller requires the unresolved
// specifier when generating diagnostics.
```

## No lists in comments

Do not use numbered lists, bullet lists, checklists, or step-by-step plans inside source-code comments.

Avoid:

```text
// 1. Normalize the path.
// 2. Resolve the path.
// 3. Generate the cache key.
```

Prefer a concise explanation:

```text
// Normalize the path before generating the cache key so equivalent
// filesystem paths share the same cached result.
```

If a concept genuinely requires extensive structured documentation, it belongs in appropriate project documentation rather than an inline source-code comment.

## No unnecessary history

Do not document the history of the code unless the history is necessary to understand a current technical constraint.

Avoid:

```text
// This was changed during the resolver rewrite in 2025.
```

Avoid:

```text
// Originally implemented for the old parser.
```

Prefer explaining the current reason:

```text
// Preserve the unresolved value because diagnostics require the original
// parser input.
```

Historical context that is no longer relevant should not remain in source comments.

## No speculation

Comments must describe facts supported by the implementation.

Do not speculate about why code exists.

Avoid:

```text
// This probably exists because the filesystem is slow.
```

If the reason cannot be established, do not invent an explanation.

When the intent is genuinely unclear, prefer leaving the code unchanged rather than introducing an unsupported comment.

## Accuracy

A comment must remain consistent with the code.

When changing code, update related comments if their meaning changes.

Do not preserve a comment merely because it already exists.

An outdated comment is worse than no comment because it can mislead contributors.

## Conciseness

Prefer the shortest comment that communicates the necessary information.

Avoid unnecessary introductions, repetition, and explanations of basic programming concepts.

Prefer:

```text
// Preserve the original path for diagnostics.
```

Over:

```text
// We need to make sure that we preserve the original path here because
// there are some situations in which the diagnostic system might need
// access to the original path that was supplied by the user.
```

The comment should contain the essential information without unnecessary prose.

## Comment structure

For ordinary comments, prefer short paragraphs.

For documentation comments that support structured documentation, use the documentation conventions of the language and its ecosystem.

Do not introduce artificial structure merely to make a short comment appear more formal.

Avoid decorative separators, banners, or ASCII-art comments.

## File and module descriptions

Do not add a generic comment at the beginning of every source file.

Avoid comments such as:

```text
// File: resolver.rs
// Description: This file contains the resolver.
```

The file name and source structure already provide this information.

Module-level documentation may be appropriate when a module has an important architectural purpose that is not obvious from its contents.

When module-level documentation is useful, describe the module's responsibility and important boundaries rather than repeating its file name.

## Public API documentation

Public APIs should be documented when their behavior, contract, constraints, or usage is not sufficiently obvious from the API itself.

Documentation should focus on information useful to consumers, such as:

* Purpose.
* Important behavior.
* Preconditions.
* Postconditions.
* Error behavior.
* Safety requirements.
* Important constraints.
* Non-obvious semantics.
* Meaningful examples.

Do not document every symbol simply because it is public.

Do not repeat information already obvious from the name and type signature.

## TODO and FIXME

Use TODO or FIXME comments only for meaningful unresolved technical issues that belong close to the affected code.

They must be concise and self-contained.

Prefer:

```text
// TODO: Handle symbolic links before resolving the final path.
```

Do not include project-management information such as:

```text
// TODO: Phase 3 will address this.
// TODO: Fix this after the migration.
// TODO: See issue #123.
```

Do not invent issue references, deadlines, owners, or milestones.

## Workarounds

When a workaround is necessary, explain the technical reason it exists.

Prefer:

```text
// Keep this conversion here because the parser expects UTF-16 offsets.
```

Avoid documenting the history of the workaround unless the history explains a current constraint.

Do not rely on external references to explain the workaround.

## Safety and correctness

Comments describing safety-critical or correctness-critical assumptions should clearly state the relevant invariant.

For example:

```text
// The buffer remains valid for the duration of this operation because
// ownership is retained by the surrounding scope.
```

Do not claim an invariant that cannot be established from the surrounding code.

For unsafe operations, concurrency, memory management, synchronization, serialization, parsing, or other correctness-sensitive code, comments should explain the non-obvious condition that makes the operation valid when necessary.

## Tests

Comments in tests should explain unusual setup, non-obvious assertions, compatibility constraints, or the behavior being protected.

Avoid comments that merely announce what the test is doing.

Avoid:

```text
// Test the parser.
```

Prefer:

```text
// Use equivalent paths to verify that they produce the same cache entry.
```

## Generated code

Do not manually rewrite comments in generated code unless the generated output is intentionally maintained as a source-of-truth artifact.

When possible, update the generator or template instead.

Preserve required generated-file markers and tool-specific comments.

## Copyright and license notices

Copyright notices, license headers, generated-file markers, and other legally or technically required comments are not ordinary explanatory comments.

Preserve them unless there is an explicit requirement to change them.

## Language-specific syntax

These guidelines define the content and style of comments, not the exact syntax.

Use the established documentation and comment syntax of the language.

For example, a language may distinguish between:

* Ordinary comments.
* Documentation comments.
* Module-level documentation.
* API documentation.
* Tool directives.

Use the appropriate syntax for the intended purpose.

Do not use documentation syntax merely because a comment is long.

## Adding comments

Before adding a comment, ask:

1. Is the information already obvious from the code?
2. Does the reader need this information to understand the implementation?
3. Does the comment explain a reason, constraint, assumption, invariant, or non-obvious behavior?
4. Is the information accurate and supported by the code?
5. Will the comment remain useful if the implementation changes?
6. Can the same information be expressed more clearly through the code itself?

If the information is obvious, do not add a comment.

If the code can be made clearer without unnecessary complexity, prefer clearer code.

## Rewriting existing comments

When reviewing an existing comment:

* Keep it if it is useful and accurate.
* Rewrite it if the meaning is useful but the wording is unclear.
* Simplify it if it is unnecessarily verbose.
* Remove it if it only restates the code.
* Remove or replace it if it depends on obsolete context.
* Replace unsupported claims with facts established by the code.
* Convert it to the appropriate documentation form when its purpose is API or module documentation.

Do not add new comments solely because nearby code has comments.

## Final quality standard

A well-written comment should feel like a natural part of the codebase.

It should be:

* Clear.
* Short.
* Precise.
* Consistent.
* Technically accurate.
* Self-contained.
* Useful to someone reading the code for the first time.

The goal is not to maximize the number of comments.

The goal is to maximize the useful information conveyed by the comments that remain.
