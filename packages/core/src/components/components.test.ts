import { describe, it, expect, beforeEach } from 'bun:test';
import { Scene } from '../scene/scene';
import { createRectangle, createEllipse } from '../scene/create-element';
import type { Element, InstanceElement, RectangleElement } from '../scene/types';
import { ComponentRegistry, defineComponent } from './component-registry';
import { resolveInstance, InstanceResolveCache } from './instance-sync';
import { createInstance, resetInstanceOverride, detachInstance } from './component-actions';

// ─── Component Registry Tests ────────────────────────────────

describe('ComponentRegistry', () => {
  let registry: ComponentRegistry;

  beforeEach(() => {
    registry = new ComponentRegistry();
  });

  it('should register and retrieve a component', () => {
    registry.register({ id: 'comp-1', name: 'Button', rootElementIds: ['el-1'] });
    const def = registry.get('comp-1');
    expect(def).toBeDefined();
    expect(def!.name).toBe('Button');
    expect(def!.rootElementIds).toEqual(['el-1']);
  });

  it('should throw on duplicate ID', () => {
    registry.register({ id: 'comp-1', name: 'Button', rootElementIds: ['el-1'] });
    expect(() => {
      registry.register({ id: 'comp-1', name: 'Button2', rootElementIds: ['el-2'] });
    }).toThrow('already exists');
  });

  it('should remove a component', () => {
    registry.register({ id: 'comp-1', name: 'Button', rootElementIds: ['el-1'] });
    expect(registry.remove('comp-1')).toBe(true);
    expect(registry.get('comp-1')).toBeUndefined();
  });

  it('should return false when removing non-existent component', () => {
    expect(registry.remove('ghost')).toBe(false);
  });

  it('should lookup by root element', () => {
    registry.register({ id: 'comp-1', name: 'Button', rootElementIds: ['el-1', 'el-2'] });
    const found = registry.getByRootElement('el-2');
    expect(found).toBeDefined();
    expect(found!.id).toBe('comp-1');
  });

  it('isMasterRoot returns true for registered root elements', () => {
    registry.register({ id: 'comp-1', name: 'Button', rootElementIds: ['el-1'] });
    expect(registry.isMasterRoot('el-1')).toBe(true);
    expect(registry.isMasterRoot('el-999')).toBe(false);
  });

  it('getAll returns all registered components', () => {
    registry.register({ id: 'comp-1', name: 'A', rootElementIds: ['el-1'] });
    registry.register({ id: 'comp-2', name: 'B', rootElementIds: ['el-2'] });
    expect(registry.getAll().length).toBe(2);
  });
});

// ─── defineComponent Tests ───────────────────────────────────

describe('defineComponent', () => {
  let scene: Scene;
  let registry: ComponentRegistry;

  beforeEach(() => {
    scene = new Scene();
    registry = new ComponentRegistry();
  });

  it('should create a component from existing elements', () => {
    const rect = createRectangle({ id: 'rect-1' });
    scene.upsertElement(rect);

    const def = defineComponent(scene, ['rect-1'], 'My Button', registry);
    expect(def.name).toBe('My Button');
    expect(def.rootElementIds).toEqual(['rect-1']);
    expect(registry.has(def.id)).toBe(true);
  });

  it('should throw if element not found', () => {
    expect(() => {
      defineComponent(scene, ['ghost'], 'Missing', registry);
    }).toThrow('not found');
  });

  it('should throw if element is deleted', () => {
    const rect = createRectangle({ id: 'rect-1' });
    scene.upsertElement(rect);
    scene.deleteElement('rect-1');
    expect(() => {
      defineComponent(scene, ['rect-1'], 'Deleted', registry);
    }).toThrow('not found');
  });

  it('should throw if element is already a master root', () => {
    const rect = createRectangle({ id: 'rect-1' });
    scene.upsertElement(rect);
    defineComponent(scene, ['rect-1'], 'First', registry);

    expect(() => {
      defineComponent(scene, ['rect-1'], 'Second', registry);
    }).toThrow('already a master root');
  });

  it('should throw if no elements provided', () => {
    expect(() => {
      defineComponent(scene, [], 'Empty', registry);
    }).toThrow('at least one');
  });

  it('should support multiple root elements', () => {
    const rect = createRectangle({ id: 'rect-1' });
    const ellipse = createEllipse({ id: 'ellipse-1' });
    scene.upsertElement(rect);
    scene.upsertElement(ellipse);

    const def = defineComponent(scene, ['rect-1', 'ellipse-1'], 'Multi', registry);
    expect(def.rootElementIds).toEqual(['rect-1', 'ellipse-1']);
  });
});

// ─── Instance Creation Tests ─────────────────────────────────

describe('createInstance', () => {
  let scene: Scene;
  let registry: ComponentRegistry;

  beforeEach(() => {
    scene = new Scene();
    registry = new ComponentRegistry();
  });

  it('should create an instance at the specified position', () => {
    const rect = createRectangle({ id: 'rect-1', x: 100, y: 200, width: 150, height: 80 });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Button', registry);

    const instance = createInstance(scene, def.id, 50, 60, registry);
    expect(instance.type).toBe('instance');
    expect(instance.x).toBe(50);
    expect(instance.y).toBe(60);
    expect(instance.componentId).toBe(def.id);
    expect(instance.overrides).toEqual({});
  });

  it('should throw if component not found', () => {
    expect(() => {
      createInstance(scene, 'ghost', 0, 0, registry);
    }).toThrow('not found');
  });

  it('instance should be in the scene', () => {
    const rect = createRectangle({ id: 'rect-1' });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    const retrieved = scene.getElement(instance.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.type).toBe('instance');
  });
});

// ─── Instance Resolution Tests ───────────────────────────────

describe('resolveInstance', () => {
  let scene: Scene;
  let registry: ComponentRegistry;

  beforeEach(() => {
    scene = new Scene();
    registry = new ComponentRegistry();
  });

  it('should resolve instance to elements identical to master (no overrides)', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 100,
      y: 200,
      width: 150,
      height: 80,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 50, 60, registry);
    const resolved = resolveInstance(instance, def, scene);

    expect(resolved.length).toBe(1);
    expect(resolved[0].type).toBe('rectangle');
    // Position should be offset by instance position - master root position
    // master root at (100, 200), instance at (50, 60)
    // offset = (50-100, 60-200) = (-50, -140)
    expect((resolved[0] as RectangleElement).x).toBe(50);
    expect((resolved[0] as RectangleElement).y).toBe(60);
    expect(resolved[0].width).toBe(150);
    expect(resolved[0].height).toBe(80);
  });

  it('should apply overrides on top of master properties', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 150,
      height: 80,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    // Override stroke color on root child
    const overridden: InstanceElement = {
      ...instance,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };
    const resolved = resolveInstance(overridden, def, scene);

    expect(resolved.length).toBe(1);
    expect(resolved[0].strokeColor).toBe('#00ff00'); // overridden
    expect(resolved[0].width).toBe(150); // inherited from master
  });

  it('overriding one property does NOT lock other properties from master sync', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 150,
      height: 80,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    // Override only strokeColor
    const overridden: InstanceElement = {
      ...instance,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };

    // Resolve — strokeColor should be overridden, width/height from master
    const resolved = resolveInstance(overridden, def, scene);
    expect(resolved[0].strokeColor).toBe('#00ff00'); // overridden
    expect(resolved[0].width).toBe(150); // from master
    expect(resolved[0].height).toBe(80); // from master
  });

  it('master change propagates to instance (except overridden properties)', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 150,
      height: 80,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    const overridden: InstanceElement = {
      ...instance,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };

    // Master changes width
    scene.upsertElement({ ...rect, width: 300, version: rect.version + 1 });

    const resolved = resolveInstance(overridden, def, scene);
    expect(resolved[0].strokeColor).toBe('#00ff00'); // still overridden
    expect(resolved[0].width).toBe(300); // updated from master
  });

  it('should skip deleted master elements', () => {
    const rect1 = createRectangle({ id: 'rect-1', x: 0, y: 0 });
    const rect2 = createRectangle({ id: 'rect-2', x: 100, y: 0 });
    scene.upsertElement(rect1);
    scene.upsertElement(rect2);
    const def = defineComponent(scene, ['rect-1', 'rect-2'], 'Multi', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    scene.deleteElement('rect-1');

    const resolved = resolveInstance(instance, def, scene);
    expect(resolved.length).toBe(1); // rect-1 is deleted, only rect-2
  });
});

// ─── Override Granularity Tests (CRITICAL — DoD requirement) ─

describe('Override granularity — override one property does NOT lock others', () => {
  let scene: Scene;
  let registry: ComponentRegistry;

  beforeEach(() => {
    scene = new Scene();
    registry = new ComponentRegistry();
  });

  it('overriding strokeColor on instance A does NOT affect instance B', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instA = createInstance(scene, def.id, 0, 0, registry);
    const instB = createInstance(scene, def.id, 200, 0, registry);

    // Override strokeColor on instance A only
    const overriddenA: InstanceElement = {
      ...instA,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };

    const resolvedA = resolveInstance(overriddenA, def, scene);
    const resolvedB = resolveInstance(instB, def, scene);

    // Instance A has overridden color
    expect(resolvedA[0].strokeColor).toBe('#00ff00');
    // Instance B still has master color
    expect(resolvedB[0].strokeColor).toBe('#ff0000');
  });

  it('overriding strokeColor on instance does NOT lock position from master sync', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 10, 20, registry);
    const overridden: InstanceElement = {
      ...instance,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };

    // Resolve — color is overridden, position still synced from master
    const resolved = resolveInstance(overridden, def, scene);
    expect(resolved[0].strokeColor).toBe('#00ff00'); // overridden
    expect(resolved[0].x).toBe(10); // synced from instance position
    expect(resolved[0].y).toBe(20); // synced from instance position
  });

  it('overriding strokeColor does NOT lock size from master sync', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    const overridden: InstanceElement = {
      ...instance,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };

    // Master changes size
    scene.upsertElement({ ...rect, width: 200, height: 200, version: rect.version + 1 });

    const resolved = resolveInstance(overridden, def, scene);
    expect(resolved[0].strokeColor).toBe('#00ff00'); // still overridden
    expect(resolved[0].width).toBe(200); // updated from master
    expect(resolved[0].height).toBe(200); // updated from master
  });

  it('master strokeColor change propagates to instance without color override', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    // Instance with NO color override
    const instance = createInstance(scene, def.id, 0, 0, registry);

    // Master changes strokeColor
    scene.upsertElement({ ...rect, strokeColor: '#0000ff', version: rect.version + 1 });

    const resolved = resolveInstance(instance, def, scene);
    expect(resolved[0].strokeColor).toBe('#0000ff'); // follows master
  });
});

// ─── Reset Override Tests ────────────────────────────────────

describe('resetInstanceOverride', () => {
  let scene: Scene;
  let registry: ComponentRegistry;

  beforeEach(() => {
    scene = new Scene();
    registry = new ComponentRegistry();
  });

  it('should remove override and property syncs back to master', () => {
    const rect = createRectangle({
      id: 'rect-1',
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    // Set override
    const overridden: InstanceElement = {
      ...instance,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };
    scene.upsertElement(overridden);

    // Reset the override
    resetInstanceOverride(scene, instance.id, '0');

    const updated = scene.getElement(instance.id) as InstanceElement;
    expect(updated.overrides['0']).toBeUndefined();

    // After reset, should follow master again
    const resolved = resolveInstance(updated, def, scene);
    expect(resolved[0].strokeColor).toBe('#ff0000'); // master value
  });

  it('should throw for non-instance element', () => {
    const rect = createRectangle({ id: 'rect-1' });
    scene.upsertElement(rect);
    expect(() => {
      resetInstanceOverride(scene, 'rect-1', '0');
    }).toThrow('not found');
  });
});

// ─── Detach Instance Tests ───────────────────────────────────

describe('detachInstance', () => {
  let scene: Scene;
  let registry: ComponentRegistry;

  beforeEach(() => {
    scene = new Scene();
    registry = new ComponentRegistry();
  });

  it('should materialize resolved elements and soft-delete instance', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 50, 60, registry);
    const overridden: InstanceElement = {
      ...instance,
      overrides: { '0': { strokeColor: '#00ff00' } as Partial<Element> },
    };
    scene.upsertElement(overridden);

    const materialized = detachInstance(scene, overridden.id, (id) => registry.get(id));

    expect(materialized.length).toBe(1);
    expect(materialized[0].type).toBe('rectangle');
    expect(materialized[0].strokeColor).toBe('#00ff00'); // override preserved
    expect(materialized[0].id).not.toBe('rect-1'); // new ID

    // Instance is soft-deleted
    const instanceAfter = scene.getElement(overridden.id);
    expect(instanceAfter).toBeDefined();
    expect(instanceAfter!.isDeleted).toBe(true);
  });

  it('detached elements are NOT affected by subsequent master changes', () => {
    const rect = createRectangle({
      id: 'rect-1',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      strokeColor: '#ff0000',
    });
    scene.upsertElement(rect);
    const def = defineComponent(scene, ['rect-1'], 'Btn', registry);

    const instance = createInstance(scene, def.id, 0, 0, registry);
    const materialized = detachInstance(scene, instance.id, (id) => registry.get(id));

    // Master changes
    scene.upsertElement({ ...rect, strokeColor: '#0000ff', version: rect.version + 1 });

    // Detached element should not be affected
    const detached = scene.getElement(materialized[0].id);
    expect(detached!.strokeColor).toBe('#ff0000'); // original master value
  });

  it('should throw for non-instance', () => {
    const rect = createRectangle({ id: 'rect-1' });
    scene.upsertElement(rect);
    expect(() => {
      detachInstance(scene, 'rect-1', (id) => registry.get(id));
    }).toThrow('not found');
  });
});

// ─── InstanceResolveCache Tests ──────────────────────────────

describe('InstanceResolveCache', () => {
  it('should cache and retrieve resolved results', () => {
    const cache = new InstanceResolveCache();
    const resolved = [{ id: 'el-1', type: 'rectangle' } as Element];

    cache.set('inst-1', 1, [5], resolved);
    const hit = cache.get('inst-1', 1, [5]);
    expect(hit).toEqual(resolved);
  });

  it('should return null on cache miss (version changed)', () => {
    const cache = new InstanceResolveCache();
    const resolved = [{ id: 'el-1', type: 'rectangle' } as Element];

    cache.set('inst-1', 1, [5], resolved);
    const miss = cache.get('inst-1', 2, [5]); // version changed
    expect(miss).toBeNull();
  });

  it('should return null on cache miss (master version changed)', () => {
    const cache = new InstanceResolveCache();
    const resolved = [{ id: 'el-1', type: 'rectangle' } as Element];

    cache.set('inst-1', 1, [5], resolved);
    const miss = cache.get('inst-1', 1, [6]); // master version changed
    expect(miss).toBeNull();
  });

  it('should invalidate specific instance', () => {
    const cache = new InstanceResolveCache();
    cache.set('inst-1', 1, [5], []);
    cache.invalidate('inst-1');
    expect(cache.get('inst-1', 1, [5])).toBeNull();
  });

  it('should invalidate all entries', () => {
    const cache = new InstanceResolveCache();
    cache.set('inst-1', 1, [5], []);
    cache.set('inst-2', 1, [5], []);
    cache.invalidateAll();
    expect(cache.size).toBe(0);
  });
});
