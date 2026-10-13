# Grafalith Rust Engine (`crates/`)

The Rust workspace is the source of truth for engine behavior. Browser, Python,
and Tauri hosts adapt the engine through its public bindings; engine crates must
remain independent of UI frameworks and DOM/Canvas APIs.

## Crate map

The diagram below shows the primary engine dependency path. It is not a complete
dependency graph for every workspace member; verify exact dependency edges in
individual `Cargo.toml` files and keep this section synchronized when they change.

```text
Host applications / package wrappers
              │
              ▼
     grafalith-bindings
              │
              ▼
         grafalith-io
              │
              ▼
        grafalith-core
              │
              ▼
      grafalith-geometry

Additional workspace crates: grafalith-pptx, grafalith-sdk, grafalith-text,
grafalith (WASM/npm), and grafalith-python (Python/PyO3).
```

| Crate / workspace member | Responsibility | Boundary |
|---|---|---|
| `grafalith-geometry` | Pure 2D math: points, bounds, segments, transforms, path math, hit testing, spatial grid, snapping, and viewport calculations. | No document/session state or host UI dependencies. |
| `grafalith-core` | Document domain, editor session, elements, selection, commands/history, hierarchy, transforms, constraints, assets, components, and render-model construction. | Must not depend on host bindings, DOM/Canvas, React, Tauri, or a host renderer. |
| `grafalith-io` | Versioned document interchange, import/export pipelines, clipboard codecs, and export descriptors. | Converts data at the interchange boundary; domain mutations still go through core commands. |
| `grafalith-bindings` | Host-facing `Engine` facade, JSON-string protocol, command dispatch, protocol DTOs, and host-compatible session/render data. | The public protocol boundary; keep it thin and independent of UI-framework code. |
| `grafalith` | WASM/npm distribution, published as `@fazelstudio/grafalith`. | Thin package wrapper over bindings. |
| `grafalith-python` | Python/PyO3 distribution, published on PyPI as `grafalith`. | Thin package wrapper over bindings. Confirm the Cargo package name in its manifest. |
| `grafalith-sdk` | Rust-facing SDK facade for engine extensions and related extension-package APIs. | Keep extension-facing APIs stable and avoid exposing unnecessary engine internals. |
| `grafalith-text` | Text measurement and shaping helpers. | Keep platform-dependent measurement separate from deterministic core behavior. |
| `grafalith-pptx` | PowerPoint `.pptx` export support, including slide package/XML generation and an exporter capability. | Keep PPTX-specific behavior outside the generic core; verify its exact dependency edges in `Cargo.toml`. |

For implementation details and public contracts, see [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md). For user-visible scope and exclusions, see [`../docs/PRD.md`](../docs/PRD.md).

## Core invariants

- Elements are serializable data; rendering, hit testing, and other behavior live in separate functions/systems.
- Elements use document/scene coordinates. Screen-to-scene conversion belongs at the input/rendering boundary.
- `Document` owns document mutation and version/nonce updates. Do not mutate stored element data around the established mutation path.
- Every user operation is represented by a command and follows the established history/transaction mechanism. A single user action should produce one atomic undo entry.
- Mutations validate before storing changes. Failed validation must not leave partial document state.
- Deletion follows the documented soft-delete policy; do not remove records directly unless an established cleanup/compaction path requires it.
- State is instance-scoped. Do not introduce mutable global singletons.
- The engine produces deterministic render data; hosts perform rasterization and own DOM, canvas, native window, clipboard, file-dialog, and other UI-specific behavior.
- Protocol changes must preserve compatibility. Add operations compatibly where possible and update generated bindings and command documentation in the same change. Increment `PROTOCOL_VERSION` only according to the documented compatibility policy.
- Hierarchy membership, group records, z-order, and labels are related document state. Any representations stored in parallel must be updated atomically and kept consistent by invariants and tests.
- Spatial-query data and caches must be invalidated or updated through the established document mutation path; never let derived state become an independent source of truth.
- Async asset fetching belongs to the host. Core stores the documented asset reference/data representation and receives explicit invalidation/update signals where required.

## Feature ownership at a glance

| Capability | Primary crate / area |
|---|---|
| Geometry, transforms, bounds, snapping, spatial queries | `grafalith-geometry` |
| Elements, document state, editor session, selection, gestures | `grafalith-core` |
| Commands, transactions, undo/redo, hierarchy, lock, z-order | `grafalith-core` |
| Render model, hit-test queries, canvas/view policy | `grafalith-core` |
| Versioned document schema, clipboard codec, import/export | `grafalith-io` |
| JSON protocol and host dispatch | `grafalith-bindings` |
| Text shaping/measurement abstractions | `grafalith-text` and the documented core interface |
| PowerPoint package export | `grafalith-pptx` |
| WASM/npm package | `grafalith` |
| Python/PyPI package | `grafalith-python` |
| Extension-facing Rust facade | `grafalith-sdk` |

This table identifies primary ownership, not permission to bypass command or module boundaries.

## Extension SDK status

The workspace contains a `grafalith-sdk` crate and extension-related APIs. Distinguish implementation in the repository from public release status: consult [`../DEVELOPMENT.md`](../DEVELOPMENT.md) and package verification before describing a crate as published or release-ready.

Extension capabilities may include shapes, commands, serialization, import, and export. Keep extension lifecycle and registration instance-scoped, and expose only documented public contracts. Desktop-specific installation, UI notifications, and operating-system integration must remain in the appropriate host layer unless the established architecture explicitly assigns a portable DTO or validation API to the SDK.

## Distribution and publishing

Distribution channels are:

| Channel | Distribution | Source |
|---|---|---|
| npm | `@fazelstudio/grafalith` | `crates/grafalith` (WASM via `wasm-pack`) |
| PyPI | `grafalith` | `crates/grafalith-python` (PyO3 via `maturin`) |
| crates.io | Publishable Rust libraries | Individual publishable workspace crates |

Which workspace members are publishable, their Cargo package names, version alignment, and dependency-respecting publish order must match the manifests and the repository's package-verification script. Do not treat directory names, Cargo package names, library names, and registry distribution names as interchangeable.

Publishing commands and release requirements are maintained in [`../DEVELOPMENT.md`](../DEVELOPMENT.md#publishing). The verification script is the authoritative automated check for package metadata and publish constraints.

## Validation commands

Use [`../DEVELOPMENT.md`](../DEVELOPMENT.md) as the canonical command reference. Common Rust checks are:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build --workspace
```

Run the relevant WASM, Python, binding-generation, desktop, and documentation checks when a change affects those surfaces. Do not claim a check passed unless it was actually run.
