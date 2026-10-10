# Security Policy

## Supported Versions

Grafalith is distributed as a library (npm + PyPI) and as a desktop application
(Tauri). Security fixes are applied to the latest released version of each
artifact.

| Artifact | Package | Supported |
|----------|---------|-----------|
| npm | `@fazelstudio/grafalith` | Latest version |
| PyPI | `grafalith` | Latest version |
| Desktop | `grafalith-desktop` (Tauri) | Latest version |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub
issues, discussions, or pull requests.

Instead, report them privately:

1. Open a **private vulnerability report** on GitHub
   (Security → Advisories → "Report a vulnerability"), or
2. Email the maintainers at [INSERT SECURITY CONTACT].

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce or a proof of concept
- Affected versions/artifacts (npm package, PyPI package, desktop app)
- Any suggested mitigation, if you have one

You can expect an acknowledgement within a few days. We will investigate
all legitimate reports and do our best to quickly fix the problem.

## Scope

Grafalith is a client-side canvas engine: it processes scene JSON, clipboard
payloads, and user input. In scope for security reports:

- Memory safety issues in the Rust engine crates (`crates/*`)
- JSON/clipboard deserialization crashes or unbounded allocation
- WASM binding boundary issues (panics crossing FFI, string handling)
- Python binding boundary issues (panics crossing FFI, GIL handling)

Out of scope:

- Vulnerabilities in third-party dependencies (report them upstream)
- Issues requiring physical access to the user's machine
- The desktop demo app's own UI code (unless it affects the engine boundary)

## Notes on Engine Safety

The engine is designed so that panics never cross the FFI boundary: all
fallible operations return `EngineResult`, and the WASM/Python bindings
convert failures into error envelopes / `ValueError` exceptions. If you
find a way to trigger a panic across the boundary, please treat it as a
security issue and report it as above.
