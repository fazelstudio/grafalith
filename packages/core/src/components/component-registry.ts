import { Scene } from '../scene/scene';

/**
 * A component definition — metadata for a "master" component.
 * Stores which scene elements serve as the master template.
 *
 * Not an element in the scene itself; lives in the ComponentRegistry.
 */
export interface ComponentDefinition {
  /** Unique component ID. */
  id: string;
  /** Human-readable name for the component. */
  name: string;
  /** IDs of root elements in the scene that form this component's master. */
  rootElementIds: string[];
}

/**
 * Registry for component definitions.
 * Maps component IDs to their definitions, and provides lookup by root element.
 */
export class ComponentRegistry {
  private definitions: Map<string, ComponentDefinition> = new Map();
  /** Reverse index: rootElementId -> componentId for fast lookup. */
  private rootToComponent: Map<string, string> = new Map();

  /**
   * Register a new component definition.
   * @throws If a component with the same ID already exists.
   */
  register(def: ComponentDefinition): void {
    if (this.definitions.has(def.id)) {
      throw new Error(`Component with id "${def.id}" already exists.`);
    }
    this.definitions.set(def.id, def);
    for (const rootId of def.rootElementIds) {
      this.rootToComponent.set(rootId, def.id);
    }
  }

  /**
   * Get a component definition by ID.
   */
  get(id: string): ComponentDefinition | undefined {
    return this.definitions.get(id);
  }

  /**
   * Check if a component exists.
   */
  has(id: string): boolean {
    return this.definitions.has(id);
  }

  /**
   * Remove a component definition.
   * Does NOT remove root elements from the scene — only the registry entry.
   */
  remove(id: string): boolean {
    const def = this.definitions.get(id);
    if (!def) return false;
    for (const rootId of def.rootElementIds) {
      this.rootToComponent.delete(rootId);
    }
    this.definitions.delete(id);
    return true;
  }

  /**
   * Get all component definitions.
   */
  getAll(): ComponentDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Find which component a root element belongs to.
   * @returns ComponentDefinition or undefined if the element is not a master root.
   */
  getByRootElement(elementId: string): ComponentDefinition | undefined {
    const compId = this.rootToComponent.get(elementId);
    if (!compId) return undefined;
    return this.definitions.get(compId);
  }

  /**
   * Check if an element is a master root of any component.
   */
  isMasterRoot(elementId: string): boolean {
    return this.rootToComponent.has(elementId);
  }
}

/** Default singleton registry instance. */
export const defaultComponentRegistry = new ComponentRegistry();

/**
 * Promote existing scene elements into a master component definition.
 * The elements remain in the scene (they are the master visual).
 *
 * @param scene - Scene containing the elements
 * @param elementIds - Element IDs to promote (must exist and not be deleted)
 * @param name - Human-readable component name
 * @param registry - Registry to store the definition (defaults to singleton)
 * @returns The created ComponentDefinition
 */
export function defineComponent(
  scene: Scene,
  elementIds: string[],
  name: string,
  registry: ComponentRegistry = defaultComponentRegistry,
): ComponentDefinition {
  if (elementIds.length === 0) {
    throw new Error('Component must have at least one root element.');
  }

  // Validate all elements exist and are not deleted
  for (const id of elementIds) {
    const el = scene.getElement(id);
    if (!el || el.isDeleted) {
      throw new Error(`Element "${id}" not found or is deleted.`);
    }
  }

  // Check none of these elements are already master roots of another component
  for (const id of elementIds) {
    if (registry.isMasterRoot(id)) {
      throw new Error(`Element "${id}" is already a master root of another component.`);
    }
  }

  const id = `component-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const def: ComponentDefinition = { id, name, rootElementIds: [...elementIds] };
  registry.register(def);
  return def;
}
