//! `.grlt` host modules: manifest rules, discovery, storage paths, notifications.

use grafalith_sdk::discovery::list_installed;
use grafalith_sdk::manifest::{
    grlt_package_id, satisfies_engines, validate_manifest, ManifestInput,
};
use grafalith_sdk::notification::{Notification, NotificationAction, NotificationLevel};
use grafalith_sdk::storage::{storage_path, valid_storage_key};

fn valid_input() -> ManifestInput<'static> {
    ManifestInput {
        format_version: 1,
        id: "sticker",
        publisher: "acme",
        name: "Sticker Pack",
        version: "1.2.3",
        engines_grafalith: Some("^0.1.0"),
        activation_events: &[
            "onStartup",
            "onHome",
            "onEditor:diagram",
            "onCommand:acme.run",
        ],
        permissions: &["clipboard", "notifications"],
    }
}

#[test]
fn manifest_accepts_full_home_editor_contract() {
    assert!(validate_manifest(&valid_input()).is_empty());
}

#[test]
fn manifest_rejects_bad_identity_and_unknown_surfaces() {
    let input = ManifestInput {
        format_version: 99,
        id: "BAD ID",
        publisher: "",
        name: "",
        version: "1.0",
        engines_grafalith: None,
        activation_events: &["onLaunch"],
        permissions: &["root"],
    };
    let problems = validate_manifest(&input);
    assert!(problems.len() >= 7, "problems: {problems:?}");
}

#[test]
fn manifest_package_id_and_engines_gate() {
    assert_eq!(grlt_package_id("acme", "sticker"), "acme.sticker");
    assert!(satisfies_engines("^0.1.0", "0.1.5"));
    assert!(!satisfies_engines("^0.1.0", "0.2.0"));
    assert!(satisfies_engines("*", "0.3.0"));
}

#[test]
fn discovery_lists_only_grlt_packages_sorted() {
    let base = std::env::temp_dir().join(format!("grafalith-discovery-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).expect("temp dir");
    for name in ["b.grlt", "a.grlt", "notes.txt"] {
        std::fs::write(base.join(name), "x").expect("fixture");
    }
    assert_eq!(
        list_installed(&base),
        vec!["a.grlt".to_string(), "b.grlt".to_string()]
    );
    assert!(list_installed(&base.join("missing")).is_empty());
    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn storage_paths_and_keys_follow_the_layout() {
    let base = std::path::Path::new("/data/extension-storage");
    assert_eq!(
        storage_path(base, "acme.sticker"),
        base.join("acme.sticker.json")
    );
    assert!(valid_storage_key("theme"));
    assert!(!valid_storage_key(""));
    assert!(!valid_storage_key("../escape"));
}

#[test]
fn notification_serializes_for_toast_routing() {
    let mut note = Notification::info("Installed \"pack\"");
    note.level = NotificationLevel::Warning;
    note.duration = Some(0);
    note.source = Some("acme.sticker".to_string());
    note.actions.push(NotificationAction {
        label: "Open".to_string(),
        command_id: "acme.open".to_string(),
    });
    let json = note.to_json();
    assert!(json.contains("Installed \\\"pack\\\""), "json: {json}");
    assert!(json.contains("\"level\":\"warning\""), "json: {json}");
    assert!(json.contains("\"commandId\":\"acme.open\""), "json: {json}");
}
