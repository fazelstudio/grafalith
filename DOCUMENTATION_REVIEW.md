# Documentation Review — Grafalith

## Scope and limitation

The initial review covered six supplied Markdown files: `README.md`, `AGENTS.md`, `DEVELOPMENT.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, and `docs/guides/comment-guidelines.md`. `docs/README.md` was supplied afterward and is reviewed in this updated pack. `crates/README.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and `SECURITY.md` were subsequently reviewed as well.

The source code, full workspace manifests, nested `AGENTS.md` files, and other referenced guides were not supplied as part of this review. Therefore, this pack fixes inconsistencies visible within the supplied documents and records technical boundaries, but it does not claim that every crate path, script, protocol name, or behavior has been verified against the current repository. The follow-up code-based reconciliation is especially important for `docs/ARCHITECTURE.md` and the crate inventory.

## Findings and actions

| File | Assessment | Change in this pack |
|---|---|---|
| `README.md` | Good purpose, but crate inventory was incomplete and some feature claims overlapped with requirements/roadmap language. | Keeps README focused on introduction, capabilities, installation, workspace map, and documentation links. Points implementation status to authoritative API/test references and lists additional crates referenced elsewhere. Verify paths against the actual workspace. |
| `AGENTS.md` | Important constraints were repeated across 334 lines. Its default requirement to read PRD, architecture, and crate map for every task conflicts with selective task-based reading. It duplicated command and repository structure details. | Reworked as a concise entrypoint: mandatory instructions, task-to-reference map, high-value architecture invariants, scope control, documentation sync, and definition of done. It directs agents to read relevant references rather than all docs for every task. |
| `DEVELOPMENT.md` | Useful, but combines day-to-day development with detailed publication procedures and includes release-status claims that become stale. | Focuses on prerequisites, setup, build, tests, lint, local tooling, artifacts, and troubleshooting. Publication moved to `RELEASING.md`; version/release state should be verified at release time. |
| `docs/PRD.md` | Mixes product requirements, version history, checked implementation status, non-negotiable principles, and a phase-by-phase implementation order. Some requirements are phrased as exact parity with other products, which is not a testable product contract. It does not clearly position Design, Slides, and Whiteboard as related but distinct workflows. | Reorganized around product intent, goals, principles, shared engine capability areas, mode-specific requirements, non-functional targets, out-of-scope items, and acceptance expectations. It no longer claims that listing a feature means it is implemented. Track status/milestones separately. |
| `docs/ARCHITECTURE.md` | Significant conflict: the old document describes TypeScript interfaces, `packages/core`/`packages/react`, direct Canvas2D rendering, and `mount(HTMLCanvasElement)`, while `AGENTS.md` says the Rust engine is authoritative and hosts render a deterministic `RenderModel`. | Rewritten as a language-neutral cross-crate contract using constraints already stated in the supplied docs. Stale TypeScript API examples are removed. Exact Rust type fields, dependency edges, public methods, and protocol details must still be checked against the source before the document is treated as fully verified. |
| `docs/guides/comment-guidelines.md` | 480 lines with repeated rules and examples. The underlying rules are useful but hard to scan. | Condensed to 55 lines while retaining the substantive rules for rationale/invariants, self-contained and accurate comments, public APIs/modules, TODO/FIXME, workarounds, sensitive code, tests, generated code, legal notices, and comment review/removal. |
| `crates/README.md` | Useful crate map, but several claims deserve source verification: dependency graph completeness, SDK release status, package-name differences, and detailed implementation claims. | Prepared a more focused crate responsibility and invariant map; package names, dependency edges, and module claims still need manifest/source verification. |
| `docs/README.md` | Its overall role as a navigation index is appropriate. The extension guide descriptions were slightly overlapping, there was extra whitespace, and it did not link to the requested root `DESIGN.md` reference. | Kept it concise as an index; clarified the separate purpose of the extension guides, normalized wording/spacing, and added links to `DESIGN.md` and the crate map. Link targets still need to be checked against the actual repository. |
| `DESIGN.md` | Not supplied; requested as a template for a repository-aware agent to fill. | Added a template for verified module responsibilities, ownership boundaries, command/data/event flow, document invariants, rendering/performance, protocol/codegen, lifecycle, decisions, risks, and source verification. Placeholders must not be presented as facts. |
| `RELEASING.md` | A separate release guide was not supplied, but the development guide contained substantial publishing instructions. | Added a dedicated release guide to keep publication and registry-specific procedures separate from local development. Verify package names and publish order from the current manifests before using commands. |
| `CONTRIBUTING.md` | Concise, but primarily repeats repository structure and architecture rules; its Rustdoc rule is overly prescriptive at 1–2 lines, and the crate map omits `grafalith-pptx`. | Reframed around contributor workflow, tests/docs/generated files, PR expectations, and links to canonical references. Replaced the fixed Rustdoc length with contract-appropriate documentation. |
| `CODE_OF_CONDUCT.md` | Mostly follows Contributor Covenant 2.0 and should retain that standard structure. Its reporting contact is still an unresolved placeholder. | Preserved the adapted covenant text and marked the contact placeholder explicitly. A real private reporting method must be configured before publication. |
| `SECURITY.md` | Includes unresolved contact information, makes a broad exclusion for the desktop UI, and excludes third-party dependency vulnerabilities categorically. Its desktop distribution status/package naming also needs verification. | Expanded scope to security-relevant desktop/host issues and exploitable dependency issues; made the reporting route and release-artifact status explicit items to verify. |


## Suggested document responsibilities

- `README.md`: What the project is, why it exists, main capabilities, installation, and links to deeper documentation.
- `AGENTS.md`: Short mandatory instructions and a map to relevant canonical references.
- `docs/PRD.md`: What the product should do, who it serves, scope, constraints, and acceptance expectations.
- `docs/ARCHITECTURE.md`: Cross-crate architecture boundaries and invariants that must not change accidentally.
- `docs/README.md`: Navigation index to canonical product, architecture, guide, and development references.
- `DESIGN.md`: Verified implementation details and design decisions not suitable for the PRD; it must be reconciled with source code.
- `DEVELOPMENT.md`: Local setup, commands, tests, lint, builds, and troubleshooting.
- `RELEASING.md`: Versioning and artifact publication.
- `docs/guides/comment-guidelines.md`: Source comment and API/module documentation rules.
- `CONTRIBUTING.md`: Contributor workflow, review expectations, tests, docs, and PR process.
- `SECURITY.md`: Private vulnerability reporting, supported artifact policy, scope, and response expectations; do not put general development instructions here. The reporting contact must be configured before publication.
- `CODE_OF_CONDUCT.md`: Community behavior standards, enforcement, and a clear private reporting route.

## Follow-up verification required in the actual repository

1. Compare the workspace table in `README.md`, `AGENTS.md`, and `docs/ARCHITECTURE.md` with `Cargo.toml`, all crate manifests, and `crates/README.md`.
2. Verify that every listed Bun script exists in the root/package scripts and that the docs verification script accepts the updated links.
3. Check whether `CONTRIBUTING.md`, `SECURITY.md`, `docs/README.md`, `docs/guides/commands.md`, `docs/guides/locale-guide.md`, and nested `AGENTS.md` files exist at the referenced paths.
4. Trace actual drawing, command, history, subscription/watcher, render-model, group/lock, and protocol flows before making detailed assertions in `DESIGN.md` or adding implementation-level detail back to `docs/ARCHITECTURE.md`.
5. Reconcile product capability status against source/tests and keep implementation status outside the PRD, unless the project deliberately chooses a maintained status table.
6. Run repository markdown/link validation, binding checks where relevant, and the relevant test/build commands. This document review did not run the repository's build or tests.
