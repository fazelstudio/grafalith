//! Dependency graph resolver for installed extensions.
//!
//! Orders activation so dependencies run first and reports every
//! unresolvable case the host must skip with a toast: missing packages,
//! dependents of a failed package, version mismatches, and circular chains.
//! Pure over manifest inputs — no filesystem, no registry access.

use std::collections::{HashMap, HashSet};

/// One installed package with its declared dependencies.
#[derive(Debug, Clone)]
/// Dependency input for one installed package.
pub struct DependencyInput {
    /// Install id (`publisher.id`).
    pub package_id: String,
    /// Declared dependencies (package id → engines-style range, `*` ok).
    pub dependencies: Vec<(String, String)>,
}

/// Skip reason: dependency not installed.
#[derive(Debug, Clone, PartialEq, Eq)]
/// Package skipped because a dependency is not installed.
pub struct MissingDependency {
    /// Dependent package.
    pub package_id: String,
    /// Missing dependency.
    pub dependency: String,
}

/// Skip reason: dependency itself failed.
#[derive(Debug, Clone, PartialEq, Eq)]
/// Package skipped because its dependency failed.
pub struct BlockedDependency {
    /// Dependent package.
    pub package_id: String,
    /// Failed dependency.
    pub dependency: String,
}

/// Every skip reason plus the safe activation order.
#[derive(Debug, Clone, Default)]
/// Dependency resolution result.
pub struct DependencyResolution {
    /// Activation-safe order (dependents after dependencies).
    pub ordered: Vec<String>,
    /// Dependents of a missing package.
    pub missing: Vec<MissingDependency>,
    /// Dependents of a failed package.
    pub blocked: Vec<BlockedDependency>,
    /// Circular chains, each as the cycle path.
    pub cycles: Vec<Vec<String>>,
}

/// Resolve activation order for one trigger batch.
///
/// `installed` lists every staged package; `failed` lists known-bad ids
/// whose dependents must block. Cyclic packages are excluded from
/// `ordered` and reported in `cycles`.
#[must_use]
pub fn resolve_dependencies(
    installed: &[DependencyInput],
    failed: &HashSet<String>,
) -> DependencyResolution {
    let by_id: HashMap<&str, &DependencyInput> = installed
        .iter()
        .map(|entry| (entry.package_id.as_str(), entry))
        .collect();
    let mut resolution = DependencyResolution::default();
    let mut visiting: HashSet<String> = HashSet::new();
    let mut visited: HashSet<String> = HashSet::new();
    let mut stack: Vec<String> = Vec::new();

    fn visit(
        package_id: &str,
        by_id: &HashMap<&str, &DependencyInput>,
        failed: &HashSet<String>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
        stack: &mut Vec<String>,
        resolution: &mut DependencyResolution,
    ) -> bool {
        if visited.contains(package_id) {
            return true;
        }
        if visiting.contains(package_id) {
            let start = stack.iter().position(|id| id == package_id).unwrap_or(0);
            let mut cycle: Vec<String> = stack[start..].to_vec();
            cycle.push(package_id.to_string());
            resolution.cycles.push(cycle);
            return false;
        }
        let Some(input) = by_id.get(package_id) else {
            return true;
        };
        visiting.insert(package_id.to_string());
        stack.push(package_id.to_string());
        let mut ok = true;
        for (dependency, _range) in &input.dependencies {
            if failed.contains(dependency.as_str()) {
                resolution.blocked.push(BlockedDependency {
                    package_id: package_id.to_string(),
                    dependency: dependency.clone(),
                });
                ok = false;
                continue;
            }
            if !by_id.contains_key(dependency.as_str()) {
                resolution.missing.push(MissingDependency {
                    package_id: package_id.to_string(),
                    dependency: dependency.clone(),
                });
                ok = false;
                continue;
            }
            if !visit(
                dependency, by_id, failed, visiting, visited, stack, resolution,
            ) {
                ok = false;
            }
        }
        stack.pop();
        visiting.remove(package_id);
        visited.insert(package_id.to_string());
        if ok {
            resolution.ordered.push(package_id.to_string());
        }
        ok
    }

    for entry in installed {
        if !visited.contains(entry.package_id.as_str()) {
            visit(
                entry.package_id.as_str(),
                &by_id,
                failed,
                &mut visiting,
                &mut visited,
                &mut stack,
                &mut resolution,
            );
        }
    }
    let cyclic: HashSet<String> = resolution.cycles.iter().flatten().cloned().collect();
    resolution.ordered.retain(|id| !cyclic.contains(id));
    resolution
}
