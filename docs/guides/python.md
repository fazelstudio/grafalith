# Python Guide — Grafalith

Use the Grafalith engine from Python through the PyPI build.

Package: `grafalith`. Source of truth: `crates/grafalith-python/`.

## Install

```bash
pip install grafalith
```

## Quick start

```python
from grafalith import Engine

engine = Engine()

# Create shapes
engine.apply_batch([
    {"op": "create", "element": {"id": "r1", "type": "rectangle", "x": 100, "y": 100,
     "width": 200, "height": 120, "rotation": 0, "strokeColor": "#333333",
     "backgroundColor": {"type": "solid", "color": "#e8f4fc"}, "strokeWidth": 2,
     "strokeStyle": "solid", "fillStyle": "solid", "opacity": 100, "seed": 1,
     "version": 0, "versionNonce": 1, "isDeleted": False, "groupIds": [],
     "locked": False, "hidden": False, "frameId": None, "roundness": None}},
])

# Layout ops
engine.align(["r1", "r2"], "left")
engine.distribute(["r1", "r2", "r3"], "horizontal")

# Status, export, undo
status = engine.status()
scene = engine.export_scene()
engine.undo()
```

`apply_batch` accepts dicts or JSON strings. Rust failures surface as
`ValueError`. Layout ops (`align`, `distribute`, `applyAutoLayout`) go through
the same `apply_batch` path by design.

Full op list: [`commands.md`](./commands.md).

## Build the artifact

Requires `maturin`. From the repo root:

```bash
# Dev install into the active venv (fast iteration)
bun run dev:python

# Release wheel
bun run build:python
```

Details: [`crates/grafalith-python/README.md`](../../crates/grafalith-python/README.md).
Publishing: [`../../DEVELOPMENT.md`](../../DEVELOPMENT.md).
