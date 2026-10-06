#!/usr/bin/env python3
"""Single source of truth for command signatures (M6).

The 78 wire ops (see docs/engine/05-command-reference.md and the
`command_coverage` test, which pins the same count) are declared ONCE here.
From this table the script generates:

- generated/nary-commands.d.ts — BatchOp union + JsEngine surface for npm,
- generated/nary.pyi — Engine stub for PyPI.

Run `python3 scripts/gen_command_bindings.py` to regenerate, or with
`--check` (CI) to fail when the checked-in files drift from the table.
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "generated"

# (command_id, wire op, [(field, ts_type, py_type, required)])
COMMANDS: list[tuple[str, str, list[tuple[str, str, str, bool]]]] = [
    ("node.create", "create", [("element", "unknown", "dict", True)]),
    ("node.delete", "delete", [("ids", "string[]", "list", True)]),
    ("node.move", "move", [("ids", "string[]", "list", True), ("dx", "number", "float", True), ("dy", "number", "float", True)]),
    ("node.setBounds", "setBounds", [("id", "string", "str", True), ("x", "number", "float", True), ("y", "number", "float", True), ("width", "number", "float", True), ("height", "number", "float", True)]),
    ("node.setRotation", "setRotation", [("id", "string", "str", True), ("rotation", "number", "float", True)]),
    ("style.set", "setStyle", [("ids", "string[]", "list", True), ("patch", "StylePatch", "dict", True)]),
    ("node.setLocked", "setLocked", [("ids", "string[]", "list", True), ("locked", "boolean", "bool", True)]),
    ("node.reorder", "reorder", [("order", "string[]", "list", True)]),
    ("node.group", "group", [("ids", "string[]", "list", True)]),
    ("node.ungroup", "ungroup", [("groupId", "string", "str", True)]),
    ("selection.set", "select", [("ids", "string[]", "list", True)]),
    ("tool.activate", "setTool", [("tool", "string", "str", True)]),
    ("clipboard.copy", "copy", [("ids", "string[]", "list", True)]),
    ("clipboard.paste", "paste", [("target", "Point", "dict", False)]),
    ("clipboard.duplicate", "duplicate", [("ids", "string[]", "list", True)]),
    ("clipboard.cut", "cut", [("ids", "string[]", "list", True)]),
    ("selection.nudge", "nudge", [("dx", "number", "float", True), ("dy", "number", "float", True)]),
    ("selection.delete", "deleteSelected", []),
    ("edit.undo", "undo", []),
    ("edit.redo", "redo", []),
    ("io.importScene", "importScene", [("scene", "unknown", "dict", True), ("tracked", "boolean", "bool", False)]),
    ("io.exportScene", "exportScene", []),
    ("tool.pointerDown", "pointerDown", [("x", "number", "float", True), ("y", "number", "float", True), ("button", "string", "str", True), ("modifiers", "Modifiers", "dict", False), ("clickCount", "number", "int", False)]),
    ("tool.pointerMove", "pointerMove", [("x", "number", "float", True), ("y", "number", "float", True), ("modifiers", "Modifiers", "dict", False)]),
    ("tool.pointerUp", "pointerUp", [("x", "number", "float", True), ("y", "number", "float", True), ("button", "string", "str", True), ("modifiers", "Modifiers", "dict", False)]),
    ("tool.pointerCancel", "pointerCancel", []),
    ("tool.key", "keyDown", [("key", "string", "str", True), ("modifiers", "Modifiers", "dict", False)]),
    ("view.wheel", "wheel", [("dx", "number", "float", True), ("dy", "number", "float", True), ("zoomGesture", "boolean", "bool", False), ("x", "number", "float", True), ("y", "number", "float", True)]),
    ("view.setViewport", "setViewport", [("scrollX", "number", "float", True), ("scrollY", "number", "float", True), ("zoom", "number", "float", True)]),
    ("view.fit", "fitViewport", [("canvasWidth", "number", "float", True), ("canvasHeight", "number", "float", True), ("padding", "number", "float", False), ("ids", "string[]", "list", False)]),
    ("view.fill", "fillViewport", [("canvasWidth", "number", "float", True), ("canvasHeight", "number", "float", True), ("padding", "number", "float", False), ("ids", "string[]", "list", False)]),
    ("session.configure", "configure", [("enabledTools", "string[] | null", "object", False), ("theme", "unknown", "dict", False), ("snap", "unknown", "dict", False)]),
    ("asset.notifyChanged", "notifyAssetsChanged", []),
    ("text.startAt", "startTextAt", [("x", "number", "float", True), ("y", "number", "float", True)]),
    ("text.input", "textInput", [("text", "string", "str", True)]),
    ("text.backspace", "textBackspace", []),
    ("text.deleteForward", "textDelete", []),
    ("text.setCaret", "textSetCaret", [("caret", "number", "int", True)]),
    ("text.compositionStart", "compositionStart", []),
    ("text.compositionUpdate", "compositionUpdate", [("buffer", "string", "str", True)]),
    ("text.compositionEnd", "compositionEnd", [("finalText", "string", "str", True)]),
    ("text.commit", "commitText", []),
    ("text.cancel", "cancelText", []),
    ("node.bringToFront", "bringToFront", [("ids", "string[]", "list", True)]),
    ("node.sendToBack", "sendToBack", [("ids", "string[]", "list", True)]),
    ("node.bringForward", "bringForward", [("ids", "string[]", "list", True)]),
    ("node.sendBackward", "sendBackward", [("ids", "string[]", "list", True)]),
    ("align.align", "align", [("ids", "string[]", "list", True), ("mode", "string", "str", True)]),
    ("distribute.distribute", "distribute", [("ids", "string[]", "list", True), ("axis", "string", "str", True)]),
    ("layout.applyAutoLayout", "applyAutoLayout", [("frameId", "string", "str", True)]),
    ("selection.resize", "resizeSelection", [("ids", "string[]", "list", True), ("original", "BoundsBox", "dict", True), ("next", "BoundsBox", "dict", True)]),
    ("pen.begin", "penBegin", []),
    ("pen.click", "penClick", [("x", "number", "float", True), ("y", "number", "float", True)]),
    ("pen.dragHandle", "penDragHandle", [("x", "number", "float", True), ("y", "number", "float", True), ("altBreak", "boolean", "bool", False)]),
    ("pen.commit", "penCommit", []),
    ("pen.cancel", "penCancel", []),
    ("crop.start", "cropStart", [("id", "string", "str", True)]),
    ("crop.drag", "cropDrag", [("handle", "string", "str", True), ("x", "number", "float", True), ("y", "number", "float", True)]),
    ("crop.commit", "cropCommit", []),
    ("crop.cancel", "cropCancel", []),
    ("path.begin", "pathEditBegin", [("id", "string", "str", True)]),
    ("path.press", "pathEditPress", [("x", "number", "float", True), ("y", "number", "float", True), ("zoom", "number", "float", False), ("alt", "boolean", "bool", False)]),
    ("path.drag", "pathEditDrag", [("x", "number", "float", True), ("y", "number", "float", True), ("altBreak", "boolean", "bool", False)]),
    ("path.release", "pathEditRelease", []),
    ("path.commit", "pathEditCommit", []),
    ("path.cancel", "pathEditCancel", []),
    ("view.renderModel", "renderModel", [("canvasWidth", "number", "float", True), ("canvasHeight", "number", "float", True), ("showGrid", "boolean", "bool", False), ("gridSize", "number", "float", False), ("readyImages", "string[]", "list", False)]),
    ("view.previewMove", "previewMove", [("ids", "string[]", "list", True), ("from", "Point", "dict", True), ("to", "Point", "dict", True), ("axisLock", "boolean", "bool", False)]),
    ("view.previewResize", "previewResize", [("id", "string", "str", True), ("handle", "string", "str", True), ("x", "number", "float", True), ("y", "number", "float", True), ("lockAspect", "boolean", "bool", False)]),
    ("view.previewRotate", "previewRotate", [("id", "string", "str", True), ("anchor", "Point", "dict", True), ("current", "Point", "dict", True), ("snap", "boolean", "bool", False)]),
    ("selection.contextMenu", "contextMenu", []),
    ("session.drainEvents", "drainEvents", []),
    ("session.state", "sessionState", []),
    ("plugin.execute", "executeCommand", [("commandId", "string", "str", True)]),
    ("boolean.union", "booleanUnion", [("ids", "string[]", "list", True)]),
    ("boolean.subtract", "booleanSubtract", [("ids", "string[]", "list", True)]),
    ("boolean.intersect", "booleanIntersect", [("ids", "string[]", "list", True)]),
    ("boolean.exclude", "booleanExclude", [("ids", "string[]", "list", True)]),
]

EXPECTED_COUNT = 78


def render_dts() -> str:
    lines = [
        "// Generated by scripts/gen_command_bindings.py — do not edit by hand.",
        "// Single source of truth: the COMMANDS table in that script,",
        "// mirroring crates/nary-bindings/src/protocol.rs (pinned by the",
        "// command_coverage test: 78 unique wire names).",
        "",
        "export interface Point { x: number; y: number }",
        "export interface Modifiers { shift?: boolean; alt?: boolean; ctrlOrCmd?: boolean }",
        "export interface BoundsBox { minX: number; minY: number; maxX: number; maxY: number }",
        "export interface StylePatch { strokeColor?: string; strokeWidth?: number; strokeStyle?: string; opacity?: number; background?: string | unknown }",
        "",
    ]
    variants = []
    for command_id, op, fields in COMMANDS:
        if not fields:
            variants.append(f'  | {{ op: "{op}" }} // {command_id}')
            continue
        members = []
        for name, ts_type, _, required in fields:
            mark = "" if required else "?"
            members.append(f"{name}{mark}: {ts_type}")
        variants.append(f'  | {{ op: "{op}"; {"; ".join(members)} }} // {command_id}')
    lines.append("export type BatchOp =")
    lines.extend(variants)
    lines.extend(
        [
            "",
            "export interface OpResult { op: string; ok: boolean; code?: string; message?: string; data?: unknown }",
            "export interface BatchResult { version: number; applied: number; results: OpResult[] }",
            "",
            "export class JsEngine {",
            "  constructor();",
            "  apply_batch(batchJson: string): string;",
            "  status(): string;",
            "  export_scene(): string;",
            "  import_scene(sceneJson: string, tracked: boolean): string;",
            "  undo(): boolean;",
            "  redo(): boolean;",
            "  can_undo(): boolean;",
            "  can_redo(): boolean;",
            "  element_count(): number;",
            "  encode_clipboard(): string;",
            "  decode_clipboard(payload: string): string;",
            "  plan_png_export(optionsJson: string): string;",
            "  plan_jpeg_export(optionsJson: string): string;",
            "  plan_webp_export(optionsJson: string): string;",
            "}",
            "export function bindings_protocol_version(): number;",
            "",
        ]
    )
    return "\n".join(lines) + "\n"


def render_pyi() -> str:
    lines = [
        '"""Generated by scripts/gen_command_bindings.py — do not edit by hand.',
        "",
        "Single source of truth: the COMMANDS table in that script, mirroring",
        "crates/nary-bindings/src/protocol.rs (pinned by the command_coverage",
        "test: 78 unique wire names).",
        '"""',
        "",
        "from typing import Any, Union",
        "",
        "__version__: str",
        "PROTOCOL_VERSION: int",
        "",
        "SceneInput = Union[str, dict[str, Any]]",
        "BatchInput = Union[str, list[dict[str, Any]]]",
        "PngOptionsInput = Union[str, dict[str, Any], None]",
        "JpegOptionsInput = Union[str, dict[str, Any], None]",
        "WebpOptionsInput = Union[str, dict[str, Any], None]",
        "",
        "COMMAND_IDS: tuple[str, ...]",
        "",
        "class Engine:",
        "    def __init__(self) -> None: ...",
        "    def apply_batch(self, ops: BatchInput) -> dict[str, Any]: ...",
        "    def status(self) -> dict[str, Any]: ...",
        "    def export_scene(self) -> dict[str, Any]: ...",
        "    def import_scene(self, scene: SceneInput, tracked: bool = ...) -> dict[str, Any]: ...",
        "    def undo(self) -> bool: ...",
        "    def redo(self) -> bool: ...",
        "    def can_undo(self) -> bool: ...",
        "    def can_redo(self) -> bool: ...",
        "    def element_count(self) -> int: ...",
        "    def scene_nonce(self) -> int: ...",
        "    def encode_clipboard(self) -> str: ...",
        "    @staticmethod",
        "    def decode_clipboard(payload: str) -> dict[str, Any]: ...",
        "    def plan_png_export(self, options: PngOptionsInput = ...) -> dict[str, Any]: ...",
        "    def plan_jpeg_export(self, options: JpegOptionsInput = ...) -> dict[str, Any]: ...",
        "    def plan_webp_export(self, options: WebpOptionsInput = ...) -> dict[str, Any]: ...",
        "    def align(self, ids: list[str], mode: str) -> dict[str, Any]: ...",
        "    def distribute(self, ids: list[str], axis: str) -> dict[str, Any]: ...",
        "    def apply_auto_layout(self, frame_id: str) -> dict[str, Any]: ...",
        "    def resize_selection(self, ids: list[str], original: dict[str, Any], next: dict[str, Any]) -> dict[str, Any]: ...",
        "    def pen_begin(self) -> dict[str, Any]: ...",
        "    def pen_click(self, x: float, y: float) -> dict[str, Any]: ...",
        "    def pen_drag_handle(self, x: float, y: float, alt_break: bool = ...) -> dict[str, Any]: ...",
        "    def pen_commit(self) -> dict[str, Any]: ...",
        "    def pen_cancel(self) -> dict[str, Any]: ...",
        "    def crop_start(self, element_id: str) -> dict[str, Any]: ...",
        "    def crop_drag(self, handle: str, x: float, y: float) -> dict[str, Any]: ...",
        "    def crop_commit(self) -> dict[str, Any]: ...",
        "    def crop_cancel(self) -> dict[str, Any]: ...",
        "    def path_edit_begin(self, element_id: str) -> dict[str, Any]: ...",
        "    def path_edit_press(self, x: float, y: float, zoom: float = ..., alt: bool = ...) -> dict[str, Any]: ...",
        "    def path_edit_drag(self, x: float, y: float, alt_break: bool = ...) -> dict[str, Any]: ...",
        "    def path_edit_release(self) -> dict[str, Any]: ...",
        "    def path_edit_commit(self) -> dict[str, Any]: ...",
        "    def path_edit_cancel(self) -> dict[str, Any]: ...",
        "    @staticmethod",
        "    def version() -> str: ...",
        "    @staticmethod",
        "    def protocol_version() -> int: ...",
        "",
    ]
    ids = ", ".join(f'"{op}"' for _, op, _ in COMMANDS)
    lines.append(f"# Wire ops covered: {len(COMMANDS)}")
    lines.append(f"# {ids}")
    return "\n".join(lines) + "\n"


def rust_wire_ops() -> set[str]:
    """Extract wire names from the `op_name` match in protocol.rs."""
    text = (ROOT / "crates" / "nary-bindings" / "src" / "protocol.rs").read_text(
        encoding="utf-8"
    )
    start = text.index("pub fn op_name(")
    end = text.index("\n}\n", start)
    body = text[start:end]
    return set(re.findall(r'BatchOp::\w+(?:\s*\{[^}]*\})?\s*=>\s*"(\w+)"', body))


def main() -> int:
    if len(COMMANDS) != EXPECTED_COUNT:
        print(f"COMMANDS table has {len(COMMANDS)} entries, expected {EXPECTED_COUNT}", file=sys.stderr)
        return 1
    ops = [op for _, op, _ in COMMANDS]
    if len(set(ops)) != len(ops):
        print("duplicate wire ops in COMMANDS table", file=sys.stderr)
        return 1
    rust_ops = rust_wire_ops()
    table_ops = set(ops)
    if table_ops != rust_ops:
        print(
            f"table/protocol drift: table-only={sorted(table_ops - rust_ops)} "
            f"protocol-only={sorted(rust_ops - table_ops)}",
            file=sys.stderr,
        )
        return 1
    outputs = {
        OUT_DIR / "nary-commands.d.ts": render_dts(),
        OUT_DIR / "nary.pyi": render_pyi(),
    }
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    failed = False
    for path, content in outputs.items():
        if args.check:
            if not path.is_file() or path.read_text(encoding="utf-8") != content:
                print(f"drift: {path.relative_to(ROOT)} (regenerate without --check)", file=sys.stderr)
                for line in difflib.unified_diff(
                    path.read_text(encoding="utf-8").splitlines() if path.is_file() else [],
                    content.splitlines(),
                    str(path.relative_to(ROOT)),
                    "generated",
                    lineterm="",
                ):
                    print(line)
                failed = True
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            print(f"wrote {path.relative_to(ROOT)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
