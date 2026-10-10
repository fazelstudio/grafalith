//! Extension lifecycle vocabulary: statuses plus dependency resolution.
//!
//! The desktop persists failure/disabled states so known-bad extensions
//! skip on the next startup; these tests pin the skip rule and the
//! activation order the host relies on.

use grafalith_sdk::dependency::{resolve_dependencies, DependencyInput};
use grafalith_sdk::status::ExtensionStatus;
use std::collections::HashSet;

#[test]
fn failure_statuses_skip_future_startups() {
    assert!(ExtensionStatus::InvalidManifest.is_failure());
    assert!(ExtensionStatus::IncompatibleVersion.is_failure());
    assert!(ExtensionStatus::MissingDependency.is_failure());
    assert!(ExtensionStatus::CircularDependency.is_failure());
    assert!(ExtensionStatus::LoadFailed.is_failure());
    assert!(ExtensionStatus::InvalidEntry.is_failure());
    assert!(ExtensionStatus::ActivationFailed.is_failure());
    assert!(ExtensionStatus::ActivationTimeout.is_failure());
    assert!(!ExtensionStatus::Active.is_failure());
    assert!(!ExtensionStatus::Disabled.is_failure());
    assert!(!ExtensionStatus::Deactivated.is_failure());
    assert!(ExtensionStatus::Active.is_active());
    assert!(ExtensionStatus::Disabled.is_disabled());
}

#[test]
fn dependents_activate_after_dependencies() {
    let installed = vec![
        DependencyInput {
            package_id: "acme.app".to_string(),
            dependencies: vec![("acme.lib".to_string(), "*".to_string())],
        },
        DependencyInput {
            package_id: "acme.lib".to_string(),
            dependencies: Vec::new(),
        },
    ];
    let resolution = resolve_dependencies(&installed, &HashSet::new());
    assert_eq!(resolution.ordered, vec!["acme.lib", "acme.app"]);
    assert!(resolution.missing.is_empty());
    assert!(resolution.cycles.is_empty());
}

#[test]
fn missing_and_failed_dependencies_skip_only_dependents() {
    let installed = vec![DependencyInput {
        package_id: "acme.app".to_string(),
        dependencies: vec![("acme.ghost".to_string(), "*".to_string())],
    }];
    let resolution = resolve_dependencies(&installed, &HashSet::new());
    assert!(resolution.ordered.is_empty());
    assert_eq!(resolution.missing.len(), 1);

    let installed = vec![
        DependencyInput {
            package_id: "acme.app".to_string(),
            dependencies: vec![("acme.lib".to_string(), "*".to_string())],
        },
        DependencyInput {
            package_id: "acme.lib".to_string(),
            dependencies: Vec::new(),
        },
    ];
    let failed: HashSet<String> = ["acme.lib".to_string()].into_iter().collect();
    let resolution = resolve_dependencies(&installed, &failed);
    assert_eq!(resolution.blocked.len(), 1);
    assert!(!resolution.ordered.contains(&"acme.app".to_string()));
}

#[test]
fn circular_chains_are_reported_and_excluded() {
    let installed = vec![
        DependencyInput {
            package_id: "a".to_string(),
            dependencies: vec![("b".to_string(), "*".to_string())],
        },
        DependencyInput {
            package_id: "b".to_string(),
            dependencies: vec![("a".to_string(), "*".to_string())],
        },
    ];
    let resolution = resolve_dependencies(&installed, &HashSet::new());
    assert_eq!(resolution.cycles.len(), 1);
    assert!(resolution.ordered.is_empty());
}
