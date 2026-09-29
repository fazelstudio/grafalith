import { describe, test, expect } from 'bun:test';
import { Scene } from '../scene/scene';
import { createRectangle, createEllipse, createLine, createText } from '../scene/create-element';
import { exportSceneToJSON } from './export-json';
import { importSceneFromJSON } from './import-json';
import type { Element } from '../scene/types';

function createTestScene(): Scene {
  const scene = new Scene();

  scene.upsertElement(createRectangle({
    id: 'rect-1',
    x: 100,
    y: 200,
    width: 150,
    height: 100,
    strokeColor: '#333333',
    backgroundColor: { type: 'solid', color: '#e8f4fc' },
  }));

  scene.upsertElement(createEllipse({
    id: 'ellipse-1',
    x: 300,
    y: 150,
    width: 120,
    height: 80,
    strokeColor: '#ff0000',
    backgroundColor: { type: 'gradient', gradientType: 'linear', angle: 45, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] },
  }));

  scene.upsertElement(createLine({
    id: 'line-1',
    x: 50,
    y: 50,
    width: 200,
    height: 100,
    points: [[0, 0], [100, 50], [200, 100]],
    strokeColor: '#00ff00',
    backgroundColor: { type: 'solid', color: 'transparent' },
  }));

  scene.upsertElement(createText({
    id: 'text-1',
    x: 400,
    y: 400,
    width: 100,
    height: 30,
    text: 'Hello World',
    fontSize: 16,
    fontFamily: 'Arial',
    textAlign: 'left',
    containerId: null,
    strokeColor: '#000000',
    backgroundColor: { type: 'solid', color: 'transparent' },
  }));

  return scene;
}

describe('JSON Export/Import', () => {
  test('export produces valid JSON with version and elements', () => {
    const scene = createTestScene();
    const json = exportSceneToJSON(scene);
    const parsed = JSON.parse(json);

    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.elements)).toBe(true);
    expect(parsed.elements.length).toBe(4);
  });

  test('round-trip export→import preserves all elements', () => {
    const scene = createTestScene();
    const json = exportSceneToJSON(scene);

    const targetScene = new Scene();
    importSceneFromJSON(json, targetScene);

    const elements = targetScene.getAllElements();
    expect(elements.length).toBe(4);

    // Verify IDs preserved
    const ids = elements.map((e) => e.id).sort();
    expect(ids).toEqual(['ellipse-1', 'line-1', 'rect-1', 'text-1']);
  });

  test('round-trip preserves element properties', () => {
    const scene = createTestScene();
    const json = exportSceneToJSON(scene);

    const targetScene = new Scene();
    importSceneFromJSON(json, targetScene);

    const rect = targetScene.getElement('rect-1');
    expect(rect).toBeDefined();
    expect(rect!.x).toBe(100);
    expect(rect!.y).toBe(200);
    expect(rect!.width).toBe(150);
    expect(rect!.height).toBe(100);
    expect(rect!.strokeColor).toBe('#333333');
    if (rect!.backgroundColor.type === 'solid') {
      expect(rect!.backgroundColor.color).toBe('#e8f4fc');
    } else {
      throw new Error('Expected solid background');
    }
  });

  test('round-trip preserves gradient fill style', () => {
    const scene = createTestScene();
    const json = exportSceneToJSON(scene);

    const targetScene = new Scene();
    importSceneFromJSON(json, targetScene);

    const ellipse = targetScene.getElement('ellipse-1');
    expect(ellipse).toBeDefined();
    if (ellipse!.backgroundColor.type === 'gradient') {
      expect(ellipse!.backgroundColor.gradientType).toBe('linear');
      expect(ellipse!.backgroundColor.angle).toBe(45);
      expect(ellipse!.backgroundColor.stops.length).toBe(2);
      expect(ellipse!.backgroundColor.stops[0].color).toBe('#ff0000');
      expect(ellipse!.backgroundColor.stops[1].color).toBe('#0000ff');
    } else {
      throw new Error('Expected gradient background');
    }
  });

  test('round-trip preserves line points', () => {
    const scene = createTestScene();
    const json = exportSceneToJSON(scene);

    const targetScene = new Scene();
    importSceneFromJSON(json, targetScene);

    const line = targetScene.getElement('line-1');
    expect(line).toBeDefined();
    expect(line!.type).toBe('line');
    if (line!.type === 'line') {
      expect(line!.points).toEqual([[0, 0], [100, 50], [200, 100]]);
    }
  });

  test('round-trip preserves text properties', () => {
    const scene = createTestScene();
    const json = exportSceneToJSON(scene);

    const targetScene = new Scene();
    importSceneFromJSON(json, targetScene);

    const text = targetScene.getElement('text-1');
    expect(text).toBeDefined();
    expect(text!.type).toBe('text');
    if (text!.type === 'text') {
      expect(text!.text).toBe('Hello World');
      expect(text!.fontSize).toBe(16);
      expect(text!.fontFamily).toBe('Arial');
      expect(text!.textAlign).toBe('left');
    }
  });

  test('import clears existing elements before importing', () => {
    const scene1 = createTestScene();
    const scene2 = new Scene();

    // Add an element to scene2
    scene2.upsertElement(createRectangle({
      id: 'old-rect',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      strokeColor: '#000',
      backgroundColor: { type: 'solid', color: '#fff' },
    }));

    const json = exportSceneToJSON(scene1);
    importSceneFromJSON(json, scene2);

    // Old element should be soft-deleted (still in Map but isDeleted=true)
    const oldEl = scene2.getElement('old-rect');
    expect(oldEl).toBeDefined();
    expect(oldEl!.isDeleted).toBe(true);
    // New elements should be present
    expect(scene2.getElement('rect-1')).toBeDefined();
    expect(scene2.getElementCount()).toBe(4);
  });

  test('import skips invalid elements gracefully', () => {
    const validData = {
      version: 1,
      elements: [
        { id: 'valid', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, rotation: 0, strokeColor: '#000', backgroundColor: { type: 'solid', color: '#fff' }, strokeWidth: 1, strokeStyle: 'solid', fillStyle: 'solid', opacity: 100, seed: 1, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], locked: false, roundness: null },
        { id: 'invalid', type: 'unknown_type' },  // invalid type
        { id: 'also-invalid' },  // missing required fields
      ],
    };

    const scene = new Scene();
    importSceneFromJSON(JSON.stringify(validData), scene);

    // Only valid element should be imported
    expect(scene.getElement('valid')).toBeDefined();
    expect(scene.getElementCount()).toBe(1);
  });

  test('import rejects invalid JSON', () => {
    const scene = new Scene();
    expect(() => importSceneFromJSON('not json', scene)).toThrow('Invalid JSON');
  });

  test('import migrates missing version (legacy default v1)', () => {
    const scene = new Scene();
    const result = importSceneFromJSON('{"elements":[]}', scene);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });

  test('import rejects unsupported version', () => {
    const scene = new Scene();
    expect(() => importSceneFromJSON('{"version": 99, "elements":[]}', scene)).toThrow('Unsupported scene version');
  });

  test('import rejects non-array elements', () => {
    const scene = new Scene();
    expect(() => importSceneFromJSON('{"version": 1, "elements": "bad"}', scene)).toThrow('elements');
  });

  test('import rejects empty valid elements', () => {
    const scene = new Scene();
    expect(() => importSceneFromJSON('{"version": 1, "elements": [{"bad": true}]}', scene)).toThrow('No valid elements');
  });

  test('export excludes deleted elements', () => {
    const scene = createTestScene();
    scene.deleteElement('rect-1');

    const json = exportSceneToJSON(scene);
    const parsed = JSON.parse(json);

    expect(parsed.elements.length).toBe(3);
    expect(parsed.elements.find((e: Element) => e.id === 'rect-1')).toBeUndefined();
  });

  test('JSON.stringify on exported data produces valid JSON', () => {
    const scene = createTestScene();
    const json = exportSceneToJSON(scene);

    // Re-parse to verify it's valid
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.elements.length).toBe(4);
  });
});
