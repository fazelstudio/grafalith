"""Custom UI button scenario in Python (M6): the same toolbar flow as the
Rust/JS examples, driven through the real PyPI `nary` package.

Run after installing the built wheel (see README):  python button.py
"""

from nary import Engine


def main() -> None:
    engine = Engine()

    # 1. Custom "Rectangle" button.
    clicked = engine.apply_batch([{"op": "setTool", "tool": "rectangle"}])
    assert clicked["results"][0]["data"]["accepted"] is True
    print("rectangle button accepted")

    # 2. Pointer gesture commits one rectangle; toolbar state polled.
    drawn = engine.apply_batch(
        [
            {"op": "pointerDown", "x": 10, "y": 10, "button": "left"},
            {"op": "pointerMove", "x": 110, "y": 60},
            {"op": "pointerUp", "x": 110, "y": 60, "button": "left"},
            {"op": "sessionState"},
        ]
    )
    state = drawn["results"][3]["data"]
    assert engine.element_count() == 1
    print(f"drawn: selection={state['selection']} canUndo={state['canUndo']}")

    # 3. Custom "Delete" button + undo.
    engine.apply_batch([{"op": "deleteSelected"}])
    assert engine.element_count() == 0
    engine.apply_batch([{"op": "undo"}])
    assert engine.element_count() == 1
    print("delete + undo round-trip ok")

    # 4. One crossing renders the frame hosts paint.
    frame = engine.apply_batch([{"op": "renderModel", "canvasWidth": 800, "canvasHeight": 600}])
    assert len(frame["results"][0]["data"]["base"]) == 1
    print("renderModel carries 1 entry — custom UI scenario complete")


if __name__ == "__main__":
    main()
