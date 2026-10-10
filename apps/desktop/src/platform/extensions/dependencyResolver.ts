// Dependency graph resolver for installed extensions.
//
// Orders activation so dependencies run first (topological), and reports
// every unresolvable case the lifecycle must toast and skip: missing
// dependencies, dependents of a failed package, and circular chains.
// Pure function over manifests: no registry access, no side effects.
import { satisfiesEngines } from './extensionContributions';

export interface DependencyInput {
  packageId: string;
  dependencies?: Readonly<Record<string, string>>;
}

export interface DependencyResolution {
  /** Activation-safe order (dependents after their dependencies). */
  ordered: string[];
  /** Package ids skipped because a dependency is not installed. */
  missing: { packageId: string; dependency: string }[];
  /** Package ids skipped because a dependency itself failed. */
  blocked: { packageId: string; dependency: string }[];
  /** Circular chains, each as the cycle path (A -> B -> A). */
  cycles: string[][];
  /** Package ids skipped by version mismatch on a declared dependency. */
  versionMismatch: { packageId: string; dependency: string; range: string; installed: string }[];
}

/**
 * Resolve activation order for one trigger batch.
 *
 * @param inputs - Installed packages with their declared dependencies.
 * @param installedVersions - Version per package id (for range checks).
 * @param failed - Package ids already known-bad (their dependents block).
 * @returns Ordered ids plus every skip reason; callers toast and mark
 *   statuses per entry instead of half-loading.
 */
export function resolveDependencies(
  inputs: readonly DependencyInput[],
  installedVersions: ReadonlyMap<string, string> = new Map(),
  failed: ReadonlySet<string> = new Set(),
): DependencyResolution {
  const byId = new Map(inputs.map((entry) => [entry.packageId, entry]));
  const missing: DependencyResolution['missing'] = [];
  const blocked: DependencyResolution['blocked'] = [];
  const versionMismatch: DependencyResolution['versionMismatch'] = [];
  const cycles: string[][] = [];
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(packageId: string): boolean {
    if (visited.has(packageId)) return true;
    if (visiting.has(packageId)) {
      const cycleStart = stack.indexOf(packageId);
      cycles.push([...stack.slice(cycleStart), packageId]);
      return false;
    }
    const input = byId.get(packageId);
    if (!input) return true;
    visiting.add(packageId);
    stack.push(packageId);
    let ok = true;
    for (const [dependency, range] of Object.entries(input.dependencies ?? {})) {
      if (failed.has(dependency)) {
        blocked.push({ packageId, dependency });
        ok = false;
        continue;
      }
      if (!byId.has(dependency)) {
        missing.push({ packageId, dependency });
        ok = false;
        continue;
      }
      const installed = installedVersions.get(dependency);
      if (installed && !satisfiesEngines(range, installed)) {
        versionMismatch.push({ packageId, dependency, range, installed });
        ok = false;
        continue;
      }
      if (!visit(dependency)) ok = false;
    }
    stack.pop();
    visiting.delete(packageId);
    if (ok) {
      visited.add(packageId);
      ordered.push(packageId);
      return true;
    }
    visited.add(packageId);
    return false;
  }

  for (const input of inputs) {
    if (!visited.has(input.packageId)) visit(input.packageId);
  }
  const cyclic = new Set(cycles.flat());
  return {
    ordered: ordered.filter((id) => !cyclic.has(id)),
    missing,
    blocked,
    cycles,
    versionMismatch,
  };
}
