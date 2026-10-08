# opennary — PyPI/Python distribution of the OpenNary engine

`opennary` is the `maturin`/`PyO3` entry point that ships the OpenNary Rust engine
to Python as the `opennary` package. It wraps the same `Engine` the WASM
hosts use — no second implementation. JSON conversion is manual via
`PyDict`/`PyList` (no `pythonize` dependency); Rust failures become
`ValueError`.

- **Full API.** `apply_batch`, `status`, `export_scene`,
  `import_scene(tracked)`, `undo`/`redo`/`can_undo`/`can_redo`,
  `element_count`, `scene_nonce`, `encode_clipboard`,
  `decode_clipboard` (static), `plan_png_export`, `version` (static),
  `protocol_version` (static).
- **Layout ops via `apply_batch`.** `align`, `distribute`, and
  `applyAutoLayout` need no dedicated method.

## Build

Requires [`maturin`](https://www.maturin.rs/) (`pip install maturin`)
and a Rust toolchain.

```bash
cd crates/opennary-python

# Dev install into the active venv (fast iteration)
maturin develop

# Release wheel + sdist
maturin build --release
pip install dist/opennary-*.whl
```

Native checks without a Python wheel:

```bash
# Unit tests for the JSON converters + version pins
cargo test -p opennary-python

# Fallback when no interpreter is configured (Windows without setup)
cargo check -p opennary-python
```

## Use from Python

```python
from opennary import Engine, PROTOCOL_VERSION, __version__

print(__version__, PROTOCOL_VERSION)

engine = Engine()

rect = lambda id, x, y: {
    "id": id, "type": "rectangle", "x": x, "y": y,
    "width": 100, "height": 50, "rotation": 0,
    "strokeColor": "#333333",
    "backgroundColor": {"type": "solid", "color": "#e8f4fc"},
    "strokeWidth": 2, "strokeStyle": "solid", "fillStyle": "solid",
    "opacity": 100, "seed": 1, "version": 0, "versionNonce": 1,
    "isDeleted": False, "groupIds": [], "locked": False,
    "hidden": False, "frameId": None, "roundness": None,
}

# Create two rectangles in one crossing.
out = engine.apply_batch([
    {"op": "create", "element": rect("a", 0, 0)},
    {"op": "create", "element": rect("b", 250, 30)},
])
assert out["applied"] == 2
assert engine.element_count() == 2

# Align left (layout ops go through apply_batch).
aligned = engine.apply_batch([
    {"op": "align", "ids": ["a", "b"], "mode": "left"},
])
assert aligned["results"][0]["ok"], aligned

# Distribute + auto-layout use the same path.
engine.apply_batch([
    {"op": "distribute", "ids": ["a", "b", "c"], "axis": "horizontal"},
])
engine.apply_batch([
    {"op": "applyAutoLayout", "frameId": "frame-1"},
])

# Undo / redo.
assert engine.can_undo()
engine.undo()
engine.redo()

# Export / import round-trip.
scene = engine.export_scene()
fresh = Engine()
summary = fresh.import_scene(scene, tracked=False)
assert summary == {"imported": 2, "skipped": 0}

# Clipboard + PNG plan.
engine.apply_batch([{"op": "copy", "ids": ["a"]}])
payload: str = engine.encode_clipboard()
decoded = Engine.decode_clipboard(payload)
assert decoded["count"] == 1
plan = engine.plan_png_export({"background": "white", "padding": 20, "scale": 2})
assert plan["canvasWidthPx"] > 0

print(engine.status()["tool"])  # 'select'
print(engine.scene_nonce())
```

`import_scene` and `apply_batch` also accept JSON strings
(`engine.apply_batch('[{"op":"undo"}]')`) — the wrapper parses them with
`json.loads` first. Check `Engine.protocol_version()` (currently `1`)
before long sessions and upgrade the wheel when it changes.

## Publishing to PyPI

PyPI has no scope/namespace concept (unlike npm's `@org/name`) — the
package name is flat and globally unique. `opennary` is the published name;
branding is carried by the GitHub org links in the project metadata and
PyPI's GitHub Org Verification badge.

First-time publish checklist:

1. Create a PyPI account and enable 2FA (required for API tokens).
2. Create an API token at pypi.org → Account Settings → API tokens.
3. **Test on TestPyPI first** (recommended for a first publish):

   ```bash
   maturin build --release
   twine upload --repository testpypi dist/*
   pip install --index-url https://test.pypi.org/simple/ opennary
   ```

4. Publish to real PyPI:

   ```bash
   maturin build --release
   twine upload dist/*
   # or, with the token configured: maturin publish
   ```

From the repo root the same flow is available as `bun run build:python`
(build only). The version is bumped in `pyproject.toml` (`[project].version`)
and mirrored in `Cargo.toml` — keep them in lockstep.
