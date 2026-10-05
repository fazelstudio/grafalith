# ADR-0015: Expand, Do Not Rebuild

Date: 2026-10-04. Status: accepted. Context: master brief Phase 3 verdict
(`docs/engine/02-gap-analysis.md`), audit (`docs/engine/00-audit.md`), research
(`docs/engine/01-research.md`).

## Decision

The `crates/*` structure (bindings → io → core → geometry, acyclic, headless,
command-based, `RenderModel`-as-data) is retained. Gaps close by **expansion**
behind existing seams (registry completion, `nary-io` codecs, pure-math geometry
growth, test/bench hardening). No cross-crate file moves, no rewrite, no
fallback branch.

## Options considered

1. Keep as-is, fill gaps in place — rejected as a label: "in place" understates
   the registry-completion and benchmark work, but the substance matches this
   ADR; the verdict name "expand" is kept for clarity.
2. Expand (chosen): additive modules/ops/registries; every step ships with build
   + tests green. Evidence: `cargo test --workspace` (500+) green,
   `clippy -D warnings` clean, `cargo tree` DAG confirmed 2026-10-04; plugin star
   example passes without touching core; 6.32× hit-test win at 5k shows no
   structural bottleneck.
3. Reconstruct (gradual restructure / rewrite): rejected — no proven
   fundamental flaw. A rewrite would invalidate 500+ parity tests and the TS
   behavior oracle for taste, violating the "proven reason, migration plan,
   green build every step" rule. Revisit only with benchmark evidence of a
   structural bottleneck plus an explicit migration ADR.

## Consequences

- `PROTOCOL_VERSION`, `SCHEMA_VERSION`, element interfaces: frozen.
- Future `nary-sdk` facade stays a thin crate over registry surfaces (name
  already reserved in `crates/README.md`).
- Risks: god-crate drift in `nary-core` (mitigated by seam-respecting growth +
   review); doc drift (mitigated by living-docs rule: docs mismatch = bug).

## References

- `docs/engine/00-audit.md` §1–§4 (crate map, DAG, findings)
- `docs/engine/02-gap-analysis.md` (verdict + capability checklist)
- Prior ADRs: 0001 (workspace), 0002 (crate split), 0003 (instance scope),
  0004 (errors), 0005 (deps), 0006 (parity), 0007 (commands/history), 0012
  (plugin scope)
