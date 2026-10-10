//! `.grlt` manifest rules (mirrors `packages/grafalith-sdk/src/manifest.ts`).
//!
//! The Tauri host parses `grafalith.extension.json` with its own JSON stack
//! and checks the result against these dependency-free rules: identity
//! fields, semver, the `engines.grafalith` range gate, known activation
//! events, and known permissions. Failures return every problem at once so
//! installers show all errors instead of one at a time.

/// Manifest filename stored at the root of every `.grlt` archive.
pub const GRLT_MANIFEST_FILENAME: &str = "grafalith.extension.json";

/// Manifest format version carried inside the file content.
pub const GRLT_FORMAT_VERSION: u32 = 1;

/// File suffix for packaged Grafalith extensions.
pub const GRLT_EXTENSION: &str = ".grlt";

/// Parsed manifest fields the host hands to [`validate_manifest`].
///
/// The host owns JSON parsing (it already depends on a JSON stack); this
/// crate owns the rules, so the SDK stays dependency-free by contract (see
/// the `workspace_wiring` test: `grafalith-sdk` carries no external crates).
#[derive(Debug, Clone)]
/// Manifest fields for validation.
pub struct ManifestInput<'a> {
    /// Manifest format version (must equal [`GRLT_FORMAT_VERSION`]).
    pub format_version: u32,
    /// Extension short id (lowercase dotted identifier).
    pub id: &'a str,
    /// Publisher namespace (install folder is `publisher.id`).
    pub publisher: &'a str,
    /// Display name shown in the extension list.
    pub name: &'a str,
    /// Extension version (`x.y.z`).
    pub version: &'a str,
    /// Engine range (`^x.y.z` or `*`); `None` means the field is missing.
    pub engines_grafalith: Option<&'a str>,
    /// Declared activation events.
    pub activation_events: &'a [&'a str],
    /// Declared host permissions.
    pub permissions: &'a [&'a str],
}

/// Install-folder id for one manifest (`publisher.id`).
#[must_use]
pub fn grlt_package_id(publisher: &str, id: &str) -> String {
    format!("{publisher}.{id}")
}

/// Minimal engine-range check (`*` or `^x.y.z`; incompatible hosts refuse).
#[must_use]
pub fn satisfies_engines(range: &str, host_version: &str) -> bool {
    if range == "*" {
        return true;
    }
    let Some(required) = parse_version(range.strip_prefix('^').unwrap_or(range)) else {
        return false;
    };
    if !range.starts_with('^') {
        return false;
    }
    let Some(host) = parse_version(host_version) else {
        return false;
    };
    caret_compatible(required, host)
}

fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let mut parts = raw.trim().split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn caret_compatible(required: (u64, u64, u64), host: (u64, u64, u64)) -> bool {
    let (rmajor, rminor, rpatch) = required;
    let (hmajor, hminor, hpatch) = host;
    if rmajor > 0 {
        if hmajor != rmajor {
            return false;
        }
        if hminor < rminor {
            return false;
        }
        return hminor > rminor || hpatch >= rpatch;
    }
    if rminor > 0 {
        return hmajor == 0 && hminor == rminor && hpatch >= rpatch;
    }
    hmajor == 0 && hminor == 0 && hpatch == rpatch
}

fn is_activation_event_known(event: &str) -> bool {
    const KNOWN: &[&str] = &[
        "onStartup",
        "onHome",
        "onProject",
        "onEditor:*",
        "onEditor:design",
        "onEditor:whiteboard",
        "onEditor:diagram",
    ];
    KNOWN.contains(&event) || event.starts_with("onCommand:") || event.starts_with("onView:")
}

fn is_permission_known(permission: &str) -> bool {
    matches!(
        permission,
        "filesystem:read" | "filesystem:write" | "network" | "clipboard" | "notifications"
    )
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_' || c == '-'
        })
}

fn valid_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| p.parse::<u64>().is_ok())
}

/// Validate one manifest; returns every problem (empty means valid).
#[must_use]
pub fn validate_manifest(input: &ManifestInput) -> Vec<String> {
    let mut problems = Vec::new();
    if input.format_version != GRLT_FORMAT_VERSION {
        problems.push(format!("formatVersion must be {GRLT_FORMAT_VERSION}"));
    }
    if !valid_id(input.id) {
        problems.push("id must be a lowercase dotted identifier".to_string());
    }
    if input.publisher.is_empty() {
        problems.push("publisher is required".to_string());
    }
    if input.name.is_empty() {
        problems.push("name is required".to_string());
    }
    if !valid_version(input.version) {
        problems.push("version must be semver x.y.z".to_string());
    }
    if input.engines_grafalith.is_none() {
        problems.push("engines.grafalith is required".to_string());
    }
    for event in input.activation_events {
        if !is_activation_event_known(event) {
            problems.push(format!("unknown activationEvent \"{event}\""));
        }
    }
    for permission in input.permissions {
        if !is_permission_known(permission) {
            problems.push(format!("unknown permission \"{permission}\""));
        }
    }
    problems
}
