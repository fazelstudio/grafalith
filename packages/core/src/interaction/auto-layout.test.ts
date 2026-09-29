import { describe, it, expect } from 'bun:test';
import { Scene } from '../scene';
import { createRectangle, createFrame } from '../scene/create-element';
import { applyAutoLayout } from './auto-layout';
import type { AutoLayoutConfig, FrameElement } from '../scene/types';

function makeConfig(overrides: Partial<AutoLayoutConfig> = {}): AutoLayoutConfig {
  return {
    direction: 'horizontal',
    gap: 10,
    padding: { top: 10, right: 10, bottom: 10, left: 10 },
    primaryAxisAlign: 'start',
    counterAxisAlign: 'start',
    sizing: 'fixed',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────
// Horizontal direction
// ────────────────────────────────────────────────────────────────────
describe('AutoLayout — horizontal', () => {
  it('lays out children left to right with gap', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({ direction: 'horizontal', gap: 10 }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', x: 0, y: 0, width: 80, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', x: 0, y: 0, width: 60, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'c', x: 0, y: 0, width: 100, height: 40, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;
    const c = scene.getElement('c')!;

    // Padding left = 10, so first child at x = 0 + 10 = 10
    expect(a.x).toBe(10);
    expect(a.y).toBe(10); // padding top

    // b at x = 10 + 80 + 10 = 100
    expect(b.x).toBe(100);

    // c at x = 100 + 60 + 10 = 170
    expect(c.x).toBe(170);
  });

  it('center alignment centers children in available space', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({
        direction: 'horizontal',
        gap: 10,
        primaryAxisAlign: 'center',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 80, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 60, height: 40, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;

    // Available width = 400 - 10 - 10 = 380
    // Total content = 80 + 10 + 60 = 150
    // Offset = (380 - 150) / 2 = 115
    // a.x = 10 + 115 = 125
    expect(a.x).toBe(125);
    // b.x = 125 + 80 + 10 = 215
    expect(b.x).toBe(215);
  });

  it('end alignment pushes children to the right', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({
        direction: 'horizontal',
        gap: 10,
        primaryAxisAlign: 'end',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 80, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 60, height: 40, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;

    // Available = 380, content = 150, offset = 380 - 150 = 230
    // a.x = 10 + 230 = 240
    expect(a.x).toBe(240);
    // b.x = 240 + 80 + 10 = 330
    expect(b.x).toBe(330);
  });

  it('space-between distributes even gaps', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({
        direction: 'horizontal',
        gap: 10, // ignored in space-between
        primaryAxisAlign: 'space-between',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 80, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 60, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'c', width: 100, height: 40, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;
    const c = scene.getElement('c')!;

    // Available = 380, content = 240, gap space = 140, 2 gaps → 70 each
    // a.x = 10, b.x = 10+80+70 = 160, c.x = 160+60+70 = 290
    expect(a.x).toBe(10);
    expect(b.x).toBe(160);
    expect(c.x).toBe(290);
  });
});

// ────────────────────────────────────────────────────────────────────
// Vertical direction
// ────────────────────────────────────────────────────────────────────
describe('AutoLayout — vertical', () => {
  it('lays out children top to bottom with gap', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 200, height: 400,
      autoLayout: makeConfig({
        direction: 'vertical',
        gap: 15,
        primaryAxisAlign: 'start',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 100, height: 50, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 100, height: 30, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'c', width: 100, height: 60, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;
    const c = scene.getElement('c')!;

    expect(a.y).toBe(10); // padding top
    expect(a.x).toBe(10); // padding left

    // b.y = 10 + 50 + 15 = 75
    expect(b.y).toBe(75);

    // c.y = 75 + 30 + 15 = 120
    expect(c.y).toBe(120);
  });

  it('center alignment on counter axis (horizontal)', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 200, height: 400,
      autoLayout: makeConfig({
        direction: 'vertical',
        gap: 10,
        counterAxisAlign: 'center',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 60, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 120, height: 30, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;

    // Available W = 200 - 10 - 10 = 180
    // a: centered → x = 10 + (180-60)/2 = 70
    expect(a.x).toBe(70);
    // b: centered → x = 10 + (180-120)/2 = 40
    expect(b.x).toBe(40);
  });
});

// ────────────────────────────────────────────────────────────────────
// Counter axis stretch
// ────────────────────────────────────────────────────────────────────
describe('AutoLayout — counter axis stretch', () => {
  it('horizontal layout: stretch children vertically', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({
        direction: 'horizontal',
        gap: 10,
        counterAxisAlign: 'stretch',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 80, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 60, height: 80, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;

    // Available H = 200 - 10 - 10 = 180 → both stretched to 180
    expect(a.height).toBe(180);
    expect(b.height).toBe(180);
    expect(a.y).toBe(10);
    expect(b.y).toBe(10);
  });

  it('vertical layout: stretch children horizontally', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 300, height: 400,
      autoLayout: makeConfig({
        direction: 'vertical',
        gap: 10,
        counterAxisAlign: 'stretch',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 60, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 120, height: 30, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;

    // Available W = 300 - 10 - 10 = 280 → both stretched to 280
    expect(a.width).toBe(280);
    expect(b.width).toBe(280);
    expect(a.x).toBe(10);
    expect(b.x).toBe(10);
  });
});

// ────────────────────────────────────────────────────────────────────
// Fill child sizing
// ────────────────────────────────────────────────────────────────────
describe('AutoLayout — fill child sizing', () => {
  it('fill child expands to fill remaining space', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({
        direction: 'horizontal',
        gap: 10,
        primaryAxisAlign: 'start',
      }),
    });
    scene.upsertElement(frame);

    // Fixed child: 100px wide
    scene.upsertElement(createRectangle({ id: 'a', width: 100, height: 40, frameId: 'f1' }));
    // Fill child: should expand
    scene.upsertElement(createRectangle({
      id: 'b', width: 50, height: 40, frameId: 'f1', childLayoutSizing: 'fill',
    }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;

    // Available = 400 - 10 - 10 = 380
    // Fixed total = 100, fill space = 380 - 100 = 280
    expect(a.x).toBe(10);
    expect(a.width).toBe(100);
    expect(b.x).toBe(120); // 10 + 100 + 10
    expect(b.width).toBe(280);
  });

  it('multiple fill children split space equally', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({
        direction: 'horizontal',
        gap: 10,
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 80, height: 40, frameId: 'f1', childLayoutSizing: 'fill' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 80, height: 40, frameId: 'f1', childLayoutSizing: 'fill' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    const b = scene.getElement('b')!;

    // Available = 380, no fixed, 2 fill → each gets 190
    expect(a.width).toBe(190);
    expect(b.width).toBe(190);
  });
});

// ────────────────────────────────────────────────────────────────────
// Hug sizing
// ────────────────────────────────────────────────────────────────────
describe('AutoLayout — hug sizing', () => {
  it('frame resizes to fit children (horizontal)', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 50, y: 50, width: 400, height: 400,
      autoLayout: makeConfig({
        direction: 'horizontal',
        gap: 10,
        padding: { top: 5, right: 5, bottom: 5, left: 5 },
        sizing: 'hug',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 100, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 80, height: 60, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const updatedFrame = scene.getElement('f1')! as FrameElement;

    // Width: 5 + 100 + 10 + 80 + 5 = 200
    expect(updatedFrame.width).toBe(200);
    // Height: max(40,60) + 5 + 5 = 70
    expect(updatedFrame.height).toBe(70);
  });

  it('frame resizes to fit children (vertical)', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 50, y: 50, width: 400, height: 400,
      autoLayout: makeConfig({
        direction: 'vertical',
        gap: 10,
        padding: { top: 5, right: 5, bottom: 5, left: 5 },
        sizing: 'hug',
      }),
    });
    scene.upsertElement(frame);

    scene.upsertElement(createRectangle({ id: 'a', width: 100, height: 40, frameId: 'f1' }));
    scene.upsertElement(createRectangle({ id: 'b', width: 80, height: 60, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const updatedFrame = scene.getElement('f1')! as FrameElement;

    // Height: 5 + 40 + 10 + 60 + 5 = 120
    expect(updatedFrame.height).toBe(120);
    // Width: max(100,80) + 5 + 5 = 110
    expect(updatedFrame.width).toBe(110);
  });
});

// ────────────────────────────────────────────────────────────────────
// Edge cases
// ────────────────────────────────────────────────────────────────────
describe('AutoLayout — edge cases', () => {
  it('no children — no changes', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig(),
    });
    scene.upsertElement(frame);

    applyAutoLayout(scene, 'f1');

    const f = scene.getElement('f1')!;
    expect(f.width).toBe(400);
    expect(f.height).toBe(200);
  });

  it('frame without autoLayout — no changes', () => {
    const scene = new Scene();
    const frame = createFrame({ id: 'f1', x: 0, y: 0, width: 400, height: 200 });
    scene.upsertElement(frame);
    scene.upsertElement(createRectangle({ id: 'a', width: 80, height: 40, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    // Position unchanged since frame has no autoLayout
    expect(a.x).toBe(0);
    expect(a.y).toBe(0);
  });

  it('single child — positioned at padding offset', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({
        direction: 'horizontal',
        padding: { top: 20, right: 20, bottom: 20, left: 30 },
      }),
    });
    scene.upsertElement(frame);
    scene.upsertElement(createRectangle({ id: 'a', width: 80, height: 40, frameId: 'f1' }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;
    expect(a.x).toBe(30);
    expect(a.y).toBe(20);
  });
});

// ────────────────────────────────────────────────────────────────────
// Constraints ignored when auto-layout active
// ────────────────────────────────────────────────────────────────────
describe('AutoLayout — constraints ignored', () => {
  it('child constraints do not affect position in auto-layout frame', () => {
    const scene = new Scene();
    const frame = createFrame({
      id: 'f1', x: 0, y: 0, width: 400, height: 200,
      autoLayout: makeConfig({ direction: 'horizontal', gap: 10 }),
    });
    scene.upsertElement(frame);

    // Child with max constraint (would pin to right in normal frame)
    scene.upsertElement(createRectangle({
      id: 'a', x: 300, y: 100, width: 80, height: 40,
      frameId: 'f1',
      constraints: { horizontal: 'max', vertical: 'max' },
    }));

    applyAutoLayout(scene, 'f1');

    const a = scene.getElement('a')!;

    // Auto-layout positions child at start (padding left), NOT at max (right)
    expect(a.x).toBe(10);
    expect(a.y).toBe(10);
  });
});
