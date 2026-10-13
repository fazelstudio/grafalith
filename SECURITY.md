# Security Policy

## Supported versions

Security fixes target the latest supported release of each published Grafalith artifact. Confirm release status and artifact names against the current manifests and release configuration before publishing this policy.

| Artifact | Package or location | Support policy |
|---|---|---|
| npm | `@fazelstudio/grafalith` | Latest supported release |
| PyPI | `grafalith` | Latest supported release |
| Desktop | Tauri application under `apps/desktop/` | Latest supported release, if distributed |

Older releases may not receive security fixes. If a release-specific support window is adopted later, document it here explicitly.

## Reporting a vulnerability

Please do not disclose security vulnerabilities through public issues, discussions, or pull requests.

1. If GitHub private vulnerability reporting is enabled for this repository, use the repository's **Security → Advisories → Report a vulnerability** flow.
2. Otherwise, contact the maintainers privately through **[ADD A SECURITY CONTACT BEFORE PUBLISHING]**.

Before publishing this policy, verify that at least one reporting route is active and monitored.

Include, when possible:

- A concise description of the issue and its potential impact.
- Reproduction steps or a proof of concept.
- Affected versions and artifacts.
- Relevant logs or input samples, after removing secrets and personal data.
- Any proposed mitigation, if known.

Maintainers will acknowledge reports as soon as reasonably practicable. Investigation and remediation timing depends on severity, reproducibility, and maintainer capacity. Please allow an opportunity to investigate and coordinate a fix before making details public.

## Scope

Report security issues that materially affect Grafalith or its users, including:

- Rust engine correctness or memory-safety issues.
- Crashes, excessive resource use, or unbounded allocation triggered by untrusted scene JSON, import files, clipboard payloads, or other supported inputs.
- WASM and Python binding boundary issues, including panic/unwind behavior, unsafe string handling, or incorrect error conversion.
- Tauri/desktop host issues, including unsafe file handling, command exposure, permissions, or flaws that compromise the engine/host boundary.
- Vulnerable dependencies when the vulnerability is exploitable in Grafalith or affects a shipped artifact.

Non-security bugs, usage questions, and feature requests should use the repository's normal contribution or issue workflow. A vulnerability in an upstream dependency may also need to be reported to that project's maintainers; please still notify Grafalith maintainers when a released or development version of Grafalith is affected.

## Engine boundary expectations

The architecture requires fallible engine operations to return structured errors and requires host bindings to translate failures into the relevant protocol error instead of allowing a panic or unwind to cross an FFI boundary. Report any reproducible violation of this contract as a security issue.
