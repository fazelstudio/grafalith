import { Scene } from '../scene/scene';
import type { Element, InstanceElement } from '../scene/types';
import type { ComponentDefinition } from './component-registry';

/**
 * Cache entry for resolved instance elements.
 * Invalidated when master version or instance version changes.
 */
interface ResolveCache {
  masterVersions: number[];
  instanceVersion: number;
  resolved: Element[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyElement = any;

/**
 * Resolve an InstanceElement into its final visual elements.
 *
 * For each root element in the master component:
 * 1. Copy the master element's properties
 * 2. Apply overrides from the instance (per-property, not full-snapshot)
 * 3. Reposition relative to the instance's position
 *
 * The result is an array of elements ready for rendering.
 *
 * @param instance - The InstanceElement to resolve
 * @param component - The ComponentDefinition this instance references
 * @param scene - Scene to look up master elements
 * @returns Array of resolved elements (copies, not originals)
 */
export function resolveInstance(
  instance: InstanceElement,
  component: ComponentDefinition,
  scene: Scene,
): Element[] {
  const resolved: Element[] = [];

  for (let i = 0; i < component.rootElementIds.length; i++) {
    const masterEl = scene.getElement(component.rootElementIds[i]);
    if (!masterEl || masterEl.isDeleted) continue;

    const pathKey = String(i);
    const override = instance.overrides[pathKey];

    // Deep copy master element properties
    const copy = deepCopyElement(masterEl) as AnyElement;

    // Apply overrides — only the properties that are explicitly overridden
    if (override) {
      for (const [key, value] of Object.entries(override)) {
        if (key === 'id' || key === 'type') continue; // never override identity
        copy[key] = value;
      }
    }

    // Reposition: master children are positioned in master's coordinate space.
    // Instance acts as anchor — translate children so instance.x/y is the origin.
    const masterRoot = scene.getElement(component.rootElementIds[0]);
    if (masterRoot) {
      const offsetX = instance.x - masterRoot.x;
      const offsetY = instance.y - masterRoot.y;

      // Only apply offset if not overridden on this specific child
      if (!override?.x) {
        copy.x = copy.x + offsetX;
      }
      if (!override?.y) {
        copy.y = copy.y + offsetY;
      }
    }

    // Preserve instance-level properties that apply to the resolved element
    copy.groupIds = instance.groupIds;
    copy.frameId = instance.frameId;
    copy.locked = instance.locked;
    copy.hidden = instance.hidden;

    // Copy rotation if not overridden
    if (!override?.rotation) {
      copy.rotation = instance.rotation;
    }

    resolved.push(copy as Element);
  }

  return resolved;
}

/**
 * Resolve an instance with nested children (groups within the component).
 * For grouped children, recursively resolves the group's members.
 *
 * @param instance - The InstanceElement to resolve
 * @param component - The ComponentDefinition
 * @param scene - Scene to look up master elements
 * @returns Flat array of resolved elements
 */
export function resolveInstanceDeep(
  instance: InstanceElement,
  component: ComponentDefinition,
  scene: Scene,
): Element[] {
  const resolved: Element[] = [];

  for (let i = 0; i < component.rootElementIds.length; i++) {
    const masterEl = scene.getElement(component.rootElementIds[i]);
    if (!masterEl || masterEl.isDeleted) continue;

    const pathKey = String(i);
    resolveElementTree(instance, pathKey, masterEl, component, scene, resolved);
  }

  return resolved;
}

/**
 * Recursively resolve an element tree, applying overrides at each level.
 */
function resolveElementTree(
  instance: InstanceElement,
  pathPrefix: string,
  masterEl: Element,
  component: ComponentDefinition,
  scene: Scene,
  resolved: Element[],
): void {
  const override = instance.overrides[pathPrefix];
  const copy = deepCopyElement(masterEl) as AnyElement;

  // Apply overrides at this level
  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (key === 'id' || key === 'type') continue;
      copy[key] = value;
    }
  }

  // Reposition relative to instance anchor
  const masterRoot = scene.getElement(component.rootElementIds[0]);
  if (masterRoot) {
    const offsetX = instance.x - masterRoot.x;
    const offsetY = instance.y - masterRoot.y;

    if (!override?.x) {
      copy.x = copy.x + offsetX;
    }
    if (!override?.y) {
      copy.y = copy.y + offsetY;
    }
  }

  // Preserve instance-level metadata
  copy.groupIds = instance.groupIds;
  copy.frameId = instance.frameId;
  copy.locked = instance.locked;
  copy.hidden = instance.hidden;

  if (!override?.rotation) {
    copy.rotation = instance.rotation;
  }

  resolved.push(copy as Element);

  // If this element has children (via frameId), recurse
  if (masterEl.type === 'frame') {
    const children = scene.getAllElements().filter(
      (el) => !el.isDeleted && el.frameId === masterEl.id,
    );
    for (let ci = 0; ci < children.length; ci++) {
      const childPath = `${pathPrefix}/${ci}`;
      resolveElementTree(instance, childPath, children[ci], component, scene, resolved);
    }
  }
}

/**
 * Deep copy an element, preserving only JSON-serializable properties.
 */
function deepCopyElement(el: Element): Element {
  return JSON.parse(JSON.stringify(el)) as Element;
}

/**
 * Result of resolving all instances in a scene.
 */
export interface ResolvedInstances {
  /** Map from instanceId -> resolved elements. */
  resolved: Map<string, Element[]>;
  /** Instance IDs that could not be resolved (missing component). */
  unresolved: string[];
}

/**
 * Resolve all instance elements in a scene.
 * This is called when the scene changes (master or override mutation).
 *
 * @param scene - Scene containing instances
 * @param getComponent - Function to look up ComponentDefinition by ID
 * @returns Map of instanceId -> resolved elements
 */
export function resolveAllInstances(
  scene: Scene,
  getComponent: (id: string) => ComponentDefinition | undefined,
): ResolvedInstances {
  const resolved = new Map<string, Element[]>();
  const unresolved: string[] = [];

  for (const el of scene.getAllElements()) {
    if (el.type === 'instance' && !el.isDeleted) {
      const instance = el as InstanceElement;
      const component = getComponent(instance.componentId);
      if (!component) {
        unresolved.push(instance.id);
        continue;
      }
      resolved.set(instance.id, resolveInstance(instance, component, scene));
    }
  }

  return { resolved, unresolved };
}

// ─── Cache ────────────────────────────────────────────────────

/**
 * Cache for resolved instance results.
 * Invalidated when master element versions or instance versions change.
 */
export class InstanceResolveCache {
  private cache: Map<string, ResolveCache> = new Map();

  /**
   * Get cached resolution for an instance, or null if cache miss.
   */
  get(
    instanceId: string,
    instanceVersion: number,
    masterVersions: number[],
  ): Element[] | null {
    const entry = this.cache.get(instanceId);
    if (!entry) return null;
    if (entry.instanceVersion !== instanceVersion) return null;
    if (entry.masterVersions.length !== masterVersions.length) return null;
    for (let i = 0; i < masterVersions.length; i++) {
      if (entry.masterVersions[i] !== masterVersions[i]) return null;
    }
    return entry.resolved;
  }

  /**
   * Store resolved results in the cache.
   */
  set(
    instanceId: string,
    instanceVersion: number,
    masterVersions: number[],
    resolved: Element[],
  ): void {
    this.cache.set(instanceId, {
      masterVersions: [...masterVersions],
      instanceVersion,
      resolved,
    });
  }

  /**
   * Invalidate cache for a specific instance.
   */
  invalidate(instanceId: string): void {
    this.cache.delete(instanceId);
  }

  /**
   * Invalidate all caches (e.g., when a master element changes).
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entries (for debugging/profiling).
   */
  get size(): number {
    return this.cache.size;
  }
}
