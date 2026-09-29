export { ComponentRegistry, defaultComponentRegistry, defineComponent } from './component-registry';
export type { ComponentDefinition } from './component-registry';

export {
  resolveInstance,
  resolveInstanceDeep,
  resolveAllInstances,
  InstanceResolveCache,
} from './instance-sync';
export type { ResolvedInstances } from './instance-sync';

export {
  createInstance,
  resetInstanceOverride,
  detachInstance,
  setInstanceOverride,
  getInstanceElements,
} from './component-actions';
