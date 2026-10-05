# ADR-0018: Gradient `setStyle` Through the Shared Fill Parser

Date: 2026-10-05. Status: accepted. Supersedes the gradient note in
ADR-0010 (which held `setStyle` gradients as `unsupported` until a later
fill-DTO phase — this is that phase).

## Decision

`setStyle.background` accepts a plain string (solid) or a fill object
(`{"type":"solid"|"gradient", …}`) parsed by `nary_io::parse_fill_style` —
the same parser file import uses. One parser, no drift, no new crates.
Mistyped fills are `invalidInput` (explicit, per-op). The domain
`StylePatch.background: Option<FillStyle>` already carried gradients; only
the boundary parsing was missing.

## Options considered

- Keep `unsupported` + import-only gradients (status quo): rejected — hosts
  could not recolor gradient fills without rewriting whole elements through
  import, and two validation paths would drift.
- Duplicate a gradient parser in `nary-bindings` (rejected): two parsers for
  one schema is exactly what ADR-0010 forbade.
- Shared parser in `nary-io` (chosen): `schema::fill_from_value` (crate
  internal) surfaced as `pipeline::parse_fill_style`; boundary maps `None`
  to `invalidInput`.

## Consequences

- No wire-schema change (the `background: Value` field already accepted
  objects — they used to fail with `unsupported`); `PROTOCOL_VERSION`
  unchanged. Hosts that branched on `unsupported` for gradients now get
  success — noted here as the one observable behavior change.
- Tests: gradient apply + undo + mistyped rejection (`bindings_model`),
  parser units (`io_model`).

## References

- `docs/engine/05-command-reference.md` (`style.set`), ADR-0010, ADR-0009
