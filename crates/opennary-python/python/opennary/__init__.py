"""opennary — Python bindings for the OpenNary canvas engine.

This package is the PyPI/maturin distribution of the OpenNary Rust engine.
The compiled extension ``opennary._opennary`` exposes the raw :class:`PyEngine`
handle; this module wraps it in the Pythonic :class:`Engine` facade that
accepts ``str | dict`` inputs and always returns plain ``dict``/``list``/
``str``/``bool``/``int`` values.

Layout ops (``align``, ``distribute``, ``applyAutoLayout``) flow through
the generic :meth:`Engine.apply_batch` path — there is no dedicated
method for them by design.
"""

from __future__ import annotations

import json
from typing import Any, Union

from opennary._opennary import PROTOCOL_VERSION as _PROTOCOL_VERSION  # type: ignore[import-not-found]
from opennary._opennary import PyEngine as _RawPyEngine  # type: ignore[import-not-found]
from opennary._opennary import __version__ as _version  # type: ignore[import-not-found]

__version__: str = _version
"""Bindings crate version (echoed in status for skew detection)."""

PROTOCOL_VERSION: int = int(_PROTOCOL_VERSION)
"""Protocol version — bump only with an explicit breaking-change note."""

PyEngine = _RawPyEngine
"""Raw extension handle alias (prefer :class:`Engine` for Python code)."""

__all__ = ["Engine", "PyEngine", "__version__", "PROTOCOL_VERSION"]

SceneInput = Union[str, dict[str, Any]]
BatchInput = Union[str, list[dict[str, Any]]]
PngOptionsInput = Union[str, dict[str, Any], None]
JpegOptionsInput = Union[str, dict[str, Any], None]
WebpOptionsInput = Union[str, dict[str, Any], None]


def _as_dict(payload: Any) -> dict[str, Any]:
    """Normalize an extension return to a ``dict``.

    The Rust layer already returns ``dict``; a ``str`` is parsed with
    ``json.loads`` so callers never branch on the transport shape.
    """
    if isinstance(payload, str):
        parsed = json.loads(payload)
        if not isinstance(parsed, dict):
            raise ValueError(f"expected JSON object, got: {payload[:120]}")
        return parsed
    if isinstance(payload, dict):
        return payload
    raise TypeError(f"expected dict or JSON string, got {type(payload).__name__}")


class Engine:
    """Pythonic facade over the instance-scoped OpenNary engine.

    One instance owns one document view (document, history, selection,
    viewport, clipboard). Instances are independent — create one per
    document. All mutation flows through :meth:`apply_batch` so one
    frame costs one crossing.
    """

    def __init__(self) -> None:
        """Create an empty engine."""
        self._engine = _RawPyEngine()

    def apply_batch(self, ops: BatchInput) -> dict[str, Any]:
        """Execute a list of op dicts in one crossing and return the batch-result dict.

        Covers the full protocol, including ``align``, ``distribute``,
        and ``applyAutoLayout``. Per-op problems are ``ok: False``
        entries — never raised.

        Args:
            ops: List of op dicts (or a JSON array string).

        Example:
            >>> engine = Engine()
            >>> engine.apply_batch([{"op": "create", "element": {...}}])
            {'version': 1, 'applied': 1, 'results': [...]}
        """
        if isinstance(ops, str):
            ops = json.loads(ops)
        return _as_dict(self._engine.apply_batch(ops))

    def status(self) -> dict[str, Any]:
        """Return the whitelisted status snapshot as a dict.

        Hosts poll this for render-loop dirty checks (``sceneNonce``),
        toolbar state (``canUndo``/``canRedo``), and session mirrors
        (selection, tool, viewport) — no per-element getter loop exists
        by design.
        """
        payload = self._engine.status()
        if isinstance(payload, str):
            return _as_dict(payload)
        if isinstance(payload, dict):
            return payload
        raise TypeError(f"unexpected status shape: {type(payload).__name__}")

    def export_scene(self) -> dict[str, Any]:
        """Export the document to its scene dict."""
        return _as_dict(self._engine.export_scene())

    def import_scene(
        self, scene: SceneInput, tracked: bool = False
    ) -> dict[str, Any]:
        """Replace document content from a scene dict (or JSON string).

        Args:
            scene: Scene object (``{schemaVersion, elements, elementOrder}``).
            tracked: When ``True``, records the replacement as one undo entry.

        Returns:
            ``{"imported": ..., "skipped": ...}``.
        """
        return _as_dict(self._engine.import_scene(scene, tracked))

    def undo(self) -> bool:
        """Undo one history entry (``False`` = nothing to undo)."""
        return bool(self._engine.undo())

    def redo(self) -> bool:
        """Redo one history entry (``False`` = nothing to redo)."""
        return bool(self._engine.redo())

    def can_undo(self) -> bool:
        """Whether :meth:`undo` would do anything."""
        return bool(self._engine.can_undo())

    def can_redo(self) -> bool:
        """Whether :meth:`redo` would do anything."""
        return bool(self._engine.can_redo())

    def element_count(self) -> int:
        """Live (non-deleted) element count."""
        return int(self._engine.element_count())

    def scene_nonce(self) -> int:
        """Current document nonce (bump = re-render / re-query)."""
        return int(self._engine.scene_nonce())

    def encode_clipboard(self) -> str:
        """Encode the clipboard buffer to the versioned payload string."""
        payload = self._engine.encode_clipboard()
        if not isinstance(payload, str):
            raise TypeError(f"expected clipboard string, got {type(payload).__name__}")
        return payload

    @staticmethod
    def decode_clipboard(payload: str) -> dict[str, Any]:
        """Decode a clipboard payload string to ``{"count", "skipped", "ids"}``.

        Pure function — touches no engine state. Hosts decide whether to
        feed the ids back through a ``paste`` op.
        """
        return _as_dict(_RawPyEngine.decode_clipboard(payload))

    def plan_png_export(self, options: PngOptionsInput = None) -> dict[str, Any]:
        """Plan PNG export from an options dict and return the plan dict.

        Pure math — the host allocates the canvas and rasterizes.

        Args:
            options: ``{"background": ..., "padding": ..., "scale": ...}``;
                ``None`` means engine defaults.
        """
        if options is None:
            options = {}
        return _as_dict(self._engine.plan_png_export(options))

    def plan_jpeg_export(self, options: JpegOptionsInput = None) -> dict[str, Any]:
        """Plan JPEG export from an options dict and return the plan dict.

        No alpha channel: ``"transparent"`` resolves to white in the plan.

        Args:
            options: ``{"background": ..., "padding": ..., "scale": ...,
                "quality": 1-100}``; ``None`` means engine defaults.
        """
        if options is None:
            options = {}
        return _as_dict(self._engine.plan_jpeg_export(options))

    def plan_webp_export(self, options: WebpOptionsInput = None) -> dict[str, Any]:
        """Plan WebP export from an options dict and return the plan dict.

        Pure math — the host encodes.

        Args:
            options: ``{"background": ..., "padding": ..., "scale": ...,
                "quality": 1-100, "lossless": ...}``; ``None`` means defaults.
        """
        if options is None:
            options = {}
        return _as_dict(self._engine.plan_webp_export(options))

    @staticmethod
    def version() -> str:
        """Return the bindings crate version string."""
        return str(_RawPyEngine.version())  # type: ignore[operator]

    @staticmethod
    def protocol_version() -> int:
        """Return the protocol version for host-side skew checks."""
        raw: Any = _RawPyEngine.protocol_version()
        return int(raw)  # type: ignore[arg-type]

    def align(self, ids: list[str], mode: str) -> dict[str, Any]:
        """Align elements to one edge (or center) of their combined bounds.

        Args:
            ids: Element ids to align.
            mode: One of ``"left"``, ``"right"``, ``"top"``, ``"bottom"``,
                ``"centerH"``, ``"centerV"``.
        """
        return _as_dict(self._engine.align(ids, mode))

    def distribute(self, ids: list[str], axis: str) -> dict[str, Any]:
        """Distribute elements with equal gaps along one axis (outer fixed).

        Args:
            ids: Element ids to distribute.
            axis: ``"horizontal"`` or ``"vertical"``.
        """
        return _as_dict(self._engine.distribute(ids, axis))

    def apply_auto_layout(self, frame_id: str) -> dict[str, Any]:
        """Run a frame's auto-layout config as one undo step."""
        return _as_dict(self._engine.apply_auto_layout(frame_id))

    def resize_selection(
        self,
        ids: list[str],
        original: tuple[float, float, float, float],
        next_bounds: tuple[float, float, float, float],
    ) -> dict[str, Any]:
        """Proportionally rescale a multi-selection between combined bounds.

        Args:
            ids: Element ids to scale.
            original: ``(min_x, min_y, max_x, max_y)`` before the drag.
            next_bounds: ``(min_x, min_y, max_x, max_y)`` after the drag.
        """
        return _as_dict(self._engine.resize_selection(ids, original, next_bounds))

    def pen_begin(self) -> dict[str, Any]:
        """Start a pen session for multi-click path creation."""
        return _as_dict(self._engine.pen_begin())

    def pen_click(self, x: float, y: float) -> dict[str, Any]:
        """Click a pen anchor at a scene point (``closed`` = path closed)."""
        return _as_dict(self._engine.pen_click(x, y))

    def pen_drag_handle(
        self, x: float, y: float, alt_break: bool = False
    ) -> dict[str, Any]:
        """Drag the last pen anchor's Bezier handles.

        Args:
            x: Scene-space x.
            y: Scene-space y.
            alt_break: When ``True``, keep the opposite handle untouched.
        """
        return _as_dict(self._engine.pen_drag_handle(x, y, alt_break))

    def pen_commit(self) -> dict[str, Any]:
        """Commit the pen session as one history entry (``committed`` + ``id``)."""
        return _as_dict(self._engine.pen_commit())

    def pen_cancel(self) -> dict[str, Any]:
        """Cancel the pen session with no document effect."""
        return _as_dict(self._engine.pen_cancel())

    def crop_start(self, element_id: str) -> dict[str, Any]:
        """Start a crop session over an image element."""
        return _as_dict(self._engine.crop_start(element_id))

    def crop_drag(self, handle: str, x: float, y: float) -> dict[str, Any]:
        """Drag the crop session's handle to natural-pixel coordinates.

        Args:
            handle: One of ``"top-left"``, ``"top"``, ``"top-right"``,
                ``"right"``, ``"bottom-right"``, ``"bottom"``,
                ``"bottom-left"``, ``"left"``.
            x: Natural-pixel x.
            y: Natural-pixel y.
        """
        return _as_dict(self._engine.crop_drag(handle, x, y))

    def crop_commit(self) -> dict[str, Any]:
        """Commit the crop session as one history entry."""
        return _as_dict(self._engine.crop_commit())

    def crop_cancel(self) -> dict[str, Any]:
        """Cancel the crop session with no document effect."""
        return _as_dict(self._engine.crop_cancel())

    def path_edit_begin(self, element_id: str) -> dict[str, Any]:
        """Start a path-edit session over a path element."""
        return _as_dict(self._engine.path_edit_begin(element_id))

    def path_edit_press(
        self, x: float, y: float, zoom: float = 1.0, alt: bool = False
    ) -> dict[str, Any]:
        """Press at a scene point during path editing.

        Returns ``{"kind": ...}`` where kind is ``"anchor"``, ``"handle"``,
        ``"add"``, ``"delete"``, or ``"none"``.
        """
        return _as_dict(self._engine.path_edit_press(x, y, zoom, alt))

    def path_edit_drag(
        self, x: float, y: float, alt_break: bool = False
    ) -> dict[str, Any]:
        """Drag the active path-edit target (``alt_break`` splits symmetry)."""
        return _as_dict(self._engine.path_edit_drag(x, y, alt_break))

    def path_edit_release(self) -> dict[str, Any]:
        """Release the active path-edit drag (no document effect yet)."""
        return _as_dict(self._engine.path_edit_release())

    def path_edit_commit(self) -> dict[str, Any]:
        """Commit the path-edit session as one history entry."""
        return _as_dict(self._engine.path_edit_commit())

    def path_edit_cancel(self) -> dict[str, Any]:
        """Cancel the path-edit session with no document effect."""
        return _as_dict(self._engine.path_edit_cancel())
