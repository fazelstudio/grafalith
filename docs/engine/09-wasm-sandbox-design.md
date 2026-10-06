# 09 — Runtime WASM Plugin Sandbox (design only, M8)

Status: design approved for specification; implementation explicitly
deferred (no code in this milestone). This document records WHAT a safe
runtime plugin system requires so a future milestone can execute it
without rediscovering the constraints.

## 1. Problem

Today extensions are either compile-time Rust crates (full capability,
reviewed code) or TypeScript UI/overlay/automation over the JSON protocol
(no new node types, no history commands). A runtime sandbox would let
untrusted third-party `.wasm` modules add behavior to a running app —
the Figma-plugin / VSCode-extension-host endgame. That power needs a
security design first.

## 2. Threat model

- A malicious plugin must not read other documents, exfiltrate canvas
  content off-device, or corrupt the scene store.
- A buggy plugin must not wedge the host: infinite loops, unbounded
  allocation, and panics must terminate the plugin, not the app.
- Determinism must survive: plugin effects enter history as ordinary
  patches (undo/redo/inspect work unchanged); plugins never hold direct
  document references.

## 3. Capability model (what plugins may import)

The host exposes a closed import list — nothing else links:

- `doc.read`: id → serialized element (JSON string, size-capped);
- `doc.command`: submit one `BatchOp` JSON (validated, history-tracked,
  rate-limited per frame);
- `host.query`: viewport/selection snapshots (read-only);
- `host.log`: bounded diagnostic channel.
- No filesystem, no network, no clock beyond a monotonic frame budget,
  no threads.

Fuel metering (per-call instruction budget) plus a per-frame wall-clock
cap terminates runaway plugins; violations suspend the plugin with a
host-visible error, preserving the document.

## 4. Module loading and versioning

- Modules declare `nary-plugin/1` custom section with id, version, and
  the `PROTOCOL_VERSION` range they target (same check as native
  `PluginMetadata`, enforced at load).
- Host validates the module with `wasmparser` before instantiation
  (rejects unexpected imports/exports, oversized memories/tables).
- Upgrades never silently widen capabilities: the import list is
  versioned with the protocol; new capabilities require a protocol bump
  and re-consent.

## 5. Why deferred (not rejected)

Building this needs: a fuel-metered executor, the host-function ABI,
fuzzing of the ABI boundary itself, and a permissions UX — each a project.
The compile-time and TypeScript paths cover all scoped capabilities today
(ADR-0017/0019). Unblock condition: a concrete product requirement for
untrusted third-party distribution (marketplace), plus a dedicated
security review milestone.
