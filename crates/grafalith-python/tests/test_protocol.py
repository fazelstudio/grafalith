"""Python integration tests over the real PyPI wheel.

Stdlib unittest only (no pytest dependency): run against an installed
`grafalith` wheel with `python -m unittest discover -s crates/grafalith-python/tests`.
CI installs the just-built wheel first, so these pin the Python-facing
parity, not the Rust internals (those live in cargo tests).
"""

import unittest

from grafalith import Engine


def rect(element_id, x=10.0, y=10.0, w=100.0, h=50.0):
    return {
        "id": element_id,
        "type": "rectangle",
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "rotation": 0.0,
        "strokeColor": "#333333",
        "backgroundColor": {"type": "solid", "color": "#e8f4fc"},
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "fillStyle": "solid",
        "opacity": 100.0,
        "seed": 1,
        "version": 0,
        "versionNonce": 1,
        "isDeleted": False,
        "groupIds": [],
        "locked": False,
        "hidden": False,
        "frameId": None,
        "roundness": None,
    }


class ProtocolTest(unittest.TestCase):
    def test_versions(self):
        self.assertEqual(Engine.protocol_version(), 1)
        self.assertTrue(Engine.version())

    def test_create_move_undo_round_trip(self):
        engine = Engine()
        created = engine.apply_batch([{"op": "create", "element": rect("p1")}])
        self.assertTrue(created["results"][0]["ok"])
        self.assertEqual(engine.element_count(), 1)
        engine.apply_batch([{"op": "move", "ids": ["p1"], "dx": 5.0, "dy": 5.0}])
        engine.apply_batch([{"op": "undo"}])
        engine.apply_batch([{"op": "undo"}])
        self.assertEqual(engine.element_count(), 0)

    def test_error_codes_are_stable(self):
        engine = Engine()
        arity = engine.apply_batch([{"op": "booleanUnion", "ids": ["ghost"]}])
        self.assertEqual(arity["results"][0]["code"], "invalidInput")
        result = engine.apply_batch(
            [{"op": "booleanUnion", "ids": ["ghost-1", "ghost-2"]}]
        )
        self.assertFalse(result["results"][0]["ok"])
        self.assertEqual(result["results"][0]["code"], "notFound")

    def test_export_import_round_trip(self):
        engine = Engine()
        engine.apply_batch([{"op": "create", "element": rect("p1")}])
        exported = engine.apply_batch([{"op": "exportScene"}])
        scene = exported["results"][0]["data"]
        other = Engine()
        imported = other.apply_batch([{"op": "importScene", "scene": scene}])
        self.assertTrue(imported["results"][0]["ok"])
        self.assertEqual(other.element_count(), 1)

    def test_viewport_and_plans(self):
        engine = Engine()
        engine.apply_batch([{"op": "create", "element": rect("p1")}])
        fitted = engine.apply_batch(
            [{"op": "fitViewport", "canvasWidth": 800, "canvasHeight": 600}]
        )
        self.assertTrue(fitted["results"][0]["ok"])
        png = engine.plan_png_export({})
        self.assertGreater(png["canvasWidthPx"], 0)
        jpeg = engine.plan_jpeg_export({})
        self.assertEqual(jpeg["background"], "#ffffff")
        webp = engine.plan_webp_export({"lossless": True})
        self.assertTrue(webp["lossless"])

    def test_clipboard_and_text_session(self):
        engine = Engine()
        engine.apply_batch([{"op": "create", "element": rect("p1")}])
        engine.apply_batch([{"op": "copy", "ids": ["p1"]}])
        engine.apply_batch([{"op": "paste"}])
        self.assertEqual(engine.element_count(), 2)
        payload = engine.encode_clipboard()
        self.assertIsInstance(payload, str)


if __name__ == "__main__":
    unittest.main()
