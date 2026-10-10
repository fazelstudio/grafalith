# custom-button — one scenario, three hosts

The same custom-toolbar story on every distribution, each running against
a **real built artifact** (not mocks):

| Host | Entry | Prerequisite | Run |
|---|---|---|---|
| Rust (native) | `crates/grafalith-bindings/examples/custom_button.rs` | none | `cargo run -p grafalith-bindings --example custom_button` |
| JS (wasm) | `button.cjs` | `bun run build:wasm:node` | `node examples/custom-button/button.cjs` |
| Python (native ext) | `button.py` | install the wheel from `maturin build` | `python examples/custom-button/button.py` |

Scenario (identical everywhere): a custom "Rectangle" button calls
`tool.activate`, a pointer gesture draws one rectangle, toolbar state
(`selection`, `canUndo`) is polled, a custom "Delete" button removes the
selection, `undo` restores it, and one `renderModel` crossing produces the
frame the host paints.
