import { Scene } from '../scene/scene';
import type { Element, InstanceElement } from '../scene/types';
import { getElementBounds } from '../shapes';
import type { ComponentDefinition, ComponentRegistry } from './component-registry';
import { defaultComponentRegistry } from './component-registry';
import { resolveInstance } from './instance-sync';

function generateId(): string {
  return crypto.randomUUID();
}

function randomNonce(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000);
}

/**
 * Create a new instance of a component and add it to the scene.
 * The instance starts with no overrides (identical to master).
 *
 * @param scene - Scene to add the instance to
 * @param componentId - ID of the component to instantiate
 * @param x - X position in scene coordinates
 * @param y - Y position in scene coordinates
 * @param registry - ComponentRegistry to look up the definition
 * @returns The created InstanceElement
 */
export function createInstance(
  scene: Scene,
  componentId: string,
  x: number,
  y: number,
  registry: ComponentRegistry = defaultComponentRegistry,
): InstanceElement {
  const def = registry.get(componentId);
  if (!def) {
    throw new Error(`Component "${componentId}" not found.`);
  }

  // Compute bounds from master root elements to get width/height
  let totalMinX = Infinity;
  let totalMinY = Infinity;
  let totalMaxX = -Infinity;
  let totalMaxY = -Infinity;

  for (const rootId of def.rootElementIds) {
    const rootEl = scene.getElement(rootId);
    if (!rootEl || rootEl.isDeleted) continue;
    const bounds = getElementBounds(rootEl);
    totalMinX = Math.min(totalMinX, bounds.minX);
    totalMinY = Math.min(totalMinY, bounds.minY);
    totalMaxX = Math.max(totalMaxX, bounds.maxX);
    totalMaxY = Math.max(totalMaxY, bounds.maxY);
  }

  const width = totalMaxX - totalMinX;
  const height = totalMaxY - totalMinY;

  const instance: InstanceElement = {
    id: generateId(),
    type: 'instance',
    x,
    y,
    width,
    height,
    rotation: 0,
    strokeColor: '#000000',
    backgroundColor: { type: 'solid', color: 'transparent' },
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    opacity: 100,
    seed: randomSeed(),
    version: 0,
    versionNonce: randomNonce(),
    isDeleted: false,
    groupIds: [],
    locked: false,
    hidden: false,
    frameId: null,
    componentId,
    overrides: {},
  };

  scene.upsertElement(instance);
  return instance;
}

/**
 * Reset a specific override on an instance, making that property
 * sync back to the master component value.
 *
 * @param scene - Scene containing the instance
 * @param instanceId - ID of the instance
 * @param propertyPath - Override key to remove (e.g., "0" or "1/0")
 */
export function resetInstanceOverride(
  scene: Scene,
  instanceId: string,
  propertyPath: string,
): void {
  const el = scene.getElement(instanceId);
  if (!el || el.isDeleted || el.type !== 'instance') {
    throw new Error(`Instance "${instanceId}" not found.`);
  }

  const instance = el as InstanceElement;
  const newOverrides = { ...instance.overrides };
  delete newOverrides[propertyPath];

  scene.upsertElement({
    ...instance,
    overrides: newOverrides,
    version: instance.version + 1,
    versionNonce: randomNonce(),
  });
}

/**
 * Detach an instance from its component, materializing the resolved
 * elements as independent scene elements. The instance is soft-deleted.
 *
 * After detach, the resulting elements are completely independent —
 * changes to the master component will NOT affect them.
 *
 * @param scene - Scene containing the instance
 * @param instanceId - ID of the instance to detach
 * @param getComponent - Function to look up ComponentDefinition by ID
 * @returns The materialized elements (formerly the instance's visual)
 */
export function detachInstance(
  scene: Scene,
  instanceId: string,
  getComponent: (id: string) => ComponentDefinition | undefined,
): Element[] {
  const el = scene.getElement(instanceId);
  if (!el || el.isDeleted || el.type !== 'instance') {
    throw new Error(`Instance "${instanceId}" not found.`);
  }

  const instance = el as InstanceElement;
  const component = getComponent(instance.componentId);
  if (!component) {
    throw new Error(`Component "${instance.componentId}" not found.`);
  }

  // Resolve the instance to get its final visual elements
  const resolved = resolveInstance(instance, component, scene);

  // Materialize each resolved element into the scene as independent elements
  const materialized: Element[] = [];
  for (const resolvedEl of resolved) {
    const newElement: Element = {
      ...resolvedEl,
      id: generateId(), // new unique ID — not sharing with master
      version: 0,
      versionNonce: randomNonce(),
    } as Element;
    scene.upsertElement(newElement);
    materialized.push(newElement);
  }

  // Soft-delete the instance
  scene.deleteElement(instanceId);

  return materialized;
}

/**
 * Set an override on a specific property path of an instance.
 * This is the low-level function — prefer using Editor.setStyle which
 * calls this internally for instance elements.
 *
 * @param scene - Scene containing the instance
 * @param instanceId - ID of the instance
 * @param propertyPath - Override key (e.g., "0" for first root element)
 * @param patch - Partial element properties to override
 */
export function setInstanceOverride(
  scene: Scene,
  instanceId: string,
  propertyPath: string,
  patch: Partial<Element>,
): void {
  const el = scene.getElement(instanceId);
  if (!el || el.isDeleted || el.type !== 'instance') {
    throw new Error(`Instance "${instanceId}" not found.`);
  }

  const instance = el as InstanceElement;
  const currentOverride = instance.overrides[propertyPath] || {};
  const newOverrides = {
    ...instance.overrides,
    [propertyPath]: { ...currentOverride, ...patch },
  };

  scene.upsertElement({
    ...instance,
    overrides: newOverrides,
    version: instance.version + 1,
    versionNonce: randomNonce(),
  });
}

/**
 * Get the resolved elements for an instance (for rendering or hit-testing).
 * Does NOT cache — call resolveInstance directly with cache for production use.
 *
 * @param scene - Scene containing the instance
 * @param instanceId - ID of the instance
 * @param getComponent - Function to look up ComponentDefinition by ID
 * @returns Resolved elements, or empty array if instance/component not found
 */
export function getInstanceElements(
  scene: Scene,
  instanceId: string,
  getComponent: (id: string) => ComponentDefinition | undefined,
): Element[] {
  const el = scene.getElement(instanceId);
  if (!el || el.isDeleted || el.type !== 'instance') return [];

  const instance = el as InstanceElement;
  const component = getComponent(instance.componentId);
  if (!component) return [];

  return resolveInstance(instance, component, scene);
}
