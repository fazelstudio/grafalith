//! Local project storage for the desktop host.
//!
//! Each project is a directory holding a small metadata file beside the
//! full scene payload, so the home list reads metadata only and never
//! parses scene documents. Writes go through a temporary file followed
//! by an fsync and a rename, keeping the previous valid payload until
//! the new one is fully written.
//!
//! Versioning: the scene payload envelope follows the engine interchange
//! (`schemaVersion ?? version ?? 1`, currently v1 only). The metadata
//! envelope carries its own `format_version` for host-side migrations.
//! Migration policy: detect the envelope version first, migrate in memory,
//! validate the migrated result, persist only after validation, and retain
//! the previous payload (plus a best-effort backup copy) when migration
//! fails. Only v1 scenes are readable today; newer envelopes are rejected
//! with `unsupported-version` instead of being silently overwritten.

use opennary_core::document::SCHEMA_VERSION;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Version of the metadata envelope written beside each scene payload.
pub const PROJECT_FORMAT_VERSION: u32 = 1;

/// Maximum display-name length enforced by storage.
pub const MAX_NAME_LEN: usize = 50;
/// Trash retention period in milliseconds.
pub const TRASH_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Editor family a project belongs to; new kinds must extend this list
/// together with the desktop `ProjectKind` union
/// (`apps/desktop/src/platform/projects/types.ts`) and the kind registry
/// (`apps/desktop/src/features/projects/projectKinds.ts`).
pub const PROJECT_KINDS: &[&str] = &["design", "whiteboard", "diagram"];

/// Fallback kind for metadata written before kinds existed.
pub fn default_project_kind() -> String {
    "design".to_string()
}

/// Trims and checks the project kind; unknown values are rejected so hosts
/// share one validation instead of reimplementing it per platform.
pub fn validate_kind(kind: &str) -> Result<String, ProjectError> {
    let trimmed = kind.trim();
    if PROJECT_KINDS.contains(&trimmed) {
        Ok(trimmed.to_string())
    } else {
        Err(ProjectError::new(
            "invalid-kind",
            "projects.errors.invalidKind",
            Some(kind.to_string()),
            false,
        ))
    }
}

/// Small metadata record stored per project, separate from the scene payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    /// Filesystem-safe project identifier (directory name).
    pub id: String,
    /// User-visible display name; ids stay stable across renames.
    pub name: String,
    /// Editor family selecting the workspace layout; defaults for metadata
    /// written before kinds existed.
    #[serde(default = "default_project_kind")]
    pub kind: String,
    /// Creation time as millis since the Unix epoch.
    pub created_at_ms: u64,
    /// Last metadata or document write as millis since the Unix epoch.
    pub updated_at_ms: u64,
    /// Last successful open as millis since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at_ms: Option<u64>,
    /// Time the project entered Trash; absent for active projects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ms: Option<u64>,
    /// Engine schema version captured when the payload was last written.
    pub schema_version: u32,
    /// Metadata envelope version for future migrations.
    pub format_version: u32,
    /// Time the project was favorited; absent for unfavorited projects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorite_at_ms: Option<u64>,
}

/// Lightweight list entry; the scene payload is never included here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    /// Filesystem-safe project identifier (directory name).
    pub id: String,
    /// User-visible display name.
    pub name: String,
    /// Editor family selecting the workspace layout.
    #[serde(default = "default_project_kind")]
    pub kind: String,
    /// Creation time as millis since the Unix epoch.
    pub created_at_ms: u64,
    /// Last metadata or document write as millis since the Unix epoch.
    pub updated_at_ms: u64,
    /// Last successful open as millis since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_opened_at_ms: Option<u64>,
    /// Time the project entered Trash; absent for active projects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at_ms: Option<u64>,
    /// Engine schema version captured when the payload was last written.
    pub schema_version: u32,
    /// Whether the scene payload file is present beside the metadata.
    pub document_exists: bool,
    /// Storage backend identifier consumed by the offline affordance.
    pub storage: String,
    /// Time the project was favorited; absent for unfavorited projects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorite_at_ms: Option<u64>,
}

/// Successful open payload: refreshed summary plus the stored scene JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenResult {
    /// Refreshed summary with the new last-opened timestamp.
    pub summary: ProjectSummary,
    /// Stored scene envelope verbatim, ready for engine import.
    pub scene_json: String,
}

/// Typed error envelope; `message_key` resolves through locale resources.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectError {
    /// Stable code such as `not-found` or `invalid-name`.
    pub code: String,
    /// Locale key for the user-facing message.
    pub message_key: String,
    /// Optional extra detail (project name or path, never a raw OS dump).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// Whether retrying or an alternative action may succeed.
    pub recoverable: bool,
}

impl ProjectError {
    fn new(code: &str, message_key: &str, details: Option<String>, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message_key: message_key.to_string(),
            details,
            recoverable,
        }
    }

    /// Serialized form crossing the Tauri command boundary.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            "{\"code\":\"io-error\",\"messageKey\":\"projects.errors.storageUnavailable\",\"recoverable\":true}".to_string()
        })
    }
}

impl std::fmt::Display for ProjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message_key)
    }
}

impl std::error::Error for ProjectError {}

/// Milliseconds since the Unix epoch; zero when the clock is unavailable.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn projects_root(base: &Path) -> PathBuf {
    base.join("projects")
}

fn project_dir(base: &Path, id: &str) -> PathBuf {
    projects_root(base).join(id)
}

fn meta_path(base: &Path, id: &str) -> PathBuf {
    project_dir(base, id).join("meta.json")
}

fn document_path(base: &Path, id: &str) -> PathBuf {
    project_dir(base, id).join("document.json")
}

/// Best-effort backup of the last known-good payload, kept beside the
/// live document so a failed migration never leaves only a corrupt file.
fn document_backup_path(base: &Path, id: &str) -> PathBuf {
    project_dir(base, id).join("document.backup.json")
}

/// Generates a filesystem-safe id without extra dependencies.
///
/// Time plus process id separates processes; the atomic counter separates
/// rapid creates inside one process.
pub fn generate_id() -> String {
    let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("p-{:x}-{:x}-{:x}", now_ms(), std::process::id(), counter)
}

/// Rejects separators and non-portable characters so ids stay usable as
/// single directory names on every desktop platform.
pub fn validate_id(id: &str) -> Result<(), ProjectError> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ProjectError::new(
            "invalid-id",
            "projects.errors.invalidName",
            Some(id.to_string()),
            false,
        ));
    }
    Ok(())
}

/// Trims and checks the display name; the backend owns this rule so hosts
/// share one validation instead of reimplementing it per platform.
pub fn validate_name(name: &str) -> Result<String, ProjectError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ProjectError::new(
            "invalid-name",
            "projects.errors.invalidName",
            None,
            false,
        ));
    }
    let len = trimmed.chars().count();
    if len > MAX_NAME_LEN {
        return Err(ProjectError::new(
            "invalid-name",
            "projects.errors.nameTooLong",
            Some(MAX_NAME_LEN.to_string()),
            false,
        ));
    }
    Ok(trimmed.to_string())
}

/// Extracts the envelope version with the same leniency as the import
/// pipeline (`schemaVersion ?? version ?? 1`). Malformed JSON and
/// non-object roots are `invalid-data`, never a version guess.
fn envelope_version(scene_json: &str) -> Result<u32, ProjectError> {
    let value: serde_json::Value = serde_json::from_str(scene_json).map_err(|_| {
        ProjectError::new("invalid-data", "projects.errors.unreadable", None, false)
    })?;
    if !value.is_object() {
        return Err(ProjectError::new(
            "invalid-data",
            "projects.errors.unreadable",
            None,
            false,
        ));
    }
    let version = value
        .get("schemaVersion")
        .or_else(|| value.get("version"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1) as u32;
    Ok(version)
}

/// Validates a scene payload before it is committed: valid JSON object,
/// supported envelope version, and an `elements` array when present.
/// Runs before every create/save so a bad payload never replaces the
/// previous valid file.
fn validate_scene_payload(scene_json: &str) -> Result<u32, ProjectError> {
    let version = envelope_version(scene_json)?;
    if version != SCHEMA_VERSION {
        return Err(ProjectError::new(
            "unsupported-version",
            "projects.errors.migrationRequired",
            Some(version.to_string()),
            true,
        ));
    }
    let value: serde_json::Value = serde_json::from_str(scene_json).map_err(|_| {
        ProjectError::new("invalid-data", "projects.errors.unreadable", None, false)
    })?;
    match value.get("elements") {
        Some(elements) if !elements.is_array() => {
            return Err(ProjectError::new(
                "invalid-data",
                "projects.errors.unreadable",
                None,
                false,
            ));
        }
        _ => {}
    }
    Ok(version)
}

fn check_scene_version(scene_json: &str) -> Result<u32, ProjectError> {
    validate_scene_payload(scene_json)
}

/// Migration decision for a stored payload: v1 loads as-is, anything
/// else needs a migration pipeline that does not exist yet. Callers
/// must not overwrite the stored payload when migration is required.
fn migration_status(version: u32) -> Result<(), ProjectError> {
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    Err(ProjectError::new(
        "unsupported-version",
        "projects.errors.migrationRequired",
        Some(version.to_string()),
        true,
    ))
}

fn storage_error(details: String) -> ProjectError {
    ProjectError::new(
        "storage-unavailable",
        "projects.errors.storageUnavailable",
        Some(details),
        true,
    )
}

/// Writes through a temporary sibling file so a crash mid-write keeps the
/// previous valid payload instead of a truncated one. The temp file is
/// fsynced before replacement. Unix replaces the destination atomically;
/// Windows requires removing the existing destination before `rename`, since
/// the standard library does not expose an overwrite form there.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), ProjectError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| storage_error(format!("{}: {e}", parent.display())))?;
    }
    let tmp = path.with_extension("json.tmp");
    let mut file =
        File::create(&tmp).map_err(|e| storage_error(format!("{}: {e}", tmp.display())))?;
    file.write_all(bytes)
        .map_err(|e| storage_error(format!("{}: {e}", tmp.display())))?;
    file.sync_all()
        .map_err(|e| storage_error(format!("{}: {e}", tmp.display())))?;
    drop(file);
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|e| storage_error(format!("{}: {e}", path.display())))?;
    }
    fs::rename(&tmp, path).map_err(|e| storage_error(format!("{}: {e}", path.display())))?;
    Ok(())
}

/// Retains the previous valid payload beside the live document before it
/// is replaced. Best-effort: backup failure never blocks the save itself.
fn retain_backup(base: &Path, id: &str) {
    let live = document_path(base, id);
    if !live.exists() {
        return;
    }
    if let Ok(bytes) = fs::read(&live) {
        let _ = atomic_write(&document_backup_path(base, id), &bytes);
    }
}

fn write_meta(base: &Path, meta: &ProjectMeta) -> Result<(), ProjectError> {
    let bytes =
        serde_json::to_vec_pretty(meta).map_err(|e| storage_error(format!("meta encode: {e}")))?;
    atomic_write(&meta_path(base, &meta.id), &bytes)
}

fn read_meta(base: &Path, id: &str) -> Result<ProjectMeta, ProjectError> {
    validate_id(id)?;
    let raw = fs::read_to_string(meta_path(base, id)).map_err(|_| {
        ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        )
    })?;
    serde_json::from_str::<ProjectMeta>(&raw).map_err(|_| {
        ProjectError::new(
            "unreadable",
            "projects.errors.unreadable",
            Some(id.to_string()),
            false,
        )
    })
}

fn to_summary(meta: &ProjectMeta, document_exists: bool) -> ProjectSummary {
    ProjectSummary {
        id: meta.id.clone(),
        name: meta.name.clone(),
        kind: meta.kind.clone(),
        created_at_ms: meta.created_at_ms,
        updated_at_ms: meta.updated_at_ms,
        last_opened_at_ms: meta.last_opened_at_ms,
        deleted_at_ms: meta.deleted_at_ms,
        schema_version: meta.schema_version,
        document_exists,
        storage: "local".to_string(),
        favorite_at_ms: meta.favorite_at_ms,
    }
}

/// Lists lightweight summaries without parsing scene payloads.
pub fn list_projects(base: &Path) -> Result<Vec<ProjectSummary>, ProjectError> {
    purge_expired_projects(base)?;
    let root = projects_root(base);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries =
        fs::read_dir(&root).map_err(|e| storage_error(format!("{}: {e}", root.display())))?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| storage_error(e.to_string()))?;
        let id = entry.file_name().to_string_lossy().to_string();
        if validate_id(&id).is_err() {
            continue;
        }
        let meta = match read_meta(base, &id) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.deleted_at_ms.is_none() {
            let document_exists = document_path(base, &id).exists();
            out.push(to_summary(&meta, document_exists));
        }
    }
    out.sort_by(|a, b| {
        let a_fav = a.favorite_at_ms;
        let b_fav = b.favorite_at_ms;
        match (a_fav, b_fav) {
            (Some(a_fav_ms), Some(b_fav_ms)) => b_fav_ms
                .cmp(&a_fav_ms)
                .then_with(|| b.updated_at_ms.cmp(&a.updated_at_ms)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b
                .last_opened_at_ms
                .unwrap_or(b.updated_at_ms)
                .cmp(&a.last_opened_at_ms.unwrap_or(a.updated_at_ms)),
        }
    });
    Ok(out)
}

/// Lists recoverable projects in Trash after purging entries past retention.
pub fn list_trash_projects(base: &Path) -> Result<Vec<ProjectSummary>, ProjectError> {
    purge_expired_projects(base)?;
    let root = projects_root(base);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let entries =
        fs::read_dir(&root).map_err(|e| storage_error(format!("{}: {e}", root.display())))?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| storage_error(e.to_string()))?;
        let id = entry.file_name().to_string_lossy().to_string();
        if validate_id(&id).is_err() {
            continue;
        }
        let meta = match read_meta(base, &id) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta.deleted_at_ms.is_some() {
            let document_exists = document_path(base, &id).exists();
            out.push(to_summary(&meta, document_exists));
        }
    }
    out.sort_by_key(|entry| std::cmp::Reverse(entry.deleted_at_ms));
    Ok(out)
}

/// Permanently removes projects whose Trash retention period has elapsed.
pub fn purge_expired_projects(base: &Path) -> Result<(), ProjectError> {
    let root = projects_root(base);
    if !root.exists() {
        return Ok(());
    }
    let now = now_ms();
    let entries =
        fs::read_dir(&root).map_err(|e| storage_error(format!("{}: {e}", root.display())))?;
    for entry in entries {
        let entry = entry.map_err(|e| storage_error(e.to_string()))?;
        let id = entry.file_name().to_string_lossy().to_string();
        if validate_id(&id).is_err() {
            continue;
        }
        let meta = match read_meta(base, &id) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        if meta
            .deleted_at_ms
            .is_some_and(|deleted| now.saturating_sub(deleted) >= TRASH_RETENTION_MS)
        {
            fs::remove_dir_all(project_dir(base, &id))
                .map_err(|e| storage_error(format!("{id}: {e}")))?;
        }
    }
    Ok(())
}

/// Creates metadata plus the initial scene payload supplied by the caller.
pub fn create_project(
    base: &Path,
    name: &str,
    scene_json: &str,
    kind: Option<&str>,
) -> Result<ProjectSummary, ProjectError> {
    let name = validate_name(name)?;
    let kind = match kind {
        Some(raw) => validate_kind(raw)?,
        None => default_project_kind(),
    };
    let version = check_scene_version(scene_json)?;
    let now = now_ms();
    let meta = ProjectMeta {
        id: generate_id(),
        name,
        kind,
        created_at_ms: now,
        updated_at_ms: now,
        last_opened_at_ms: Some(now),
        deleted_at_ms: None,
        schema_version: version,
        format_version: PROJECT_FORMAT_VERSION,
        favorite_at_ms: None,
    };
    fs::create_dir_all(project_dir(base, &meta.id)).map_err(|e| storage_error(e.to_string()))?;
    atomic_write(&document_path(base, &meta.id), scene_json.as_bytes())?;
    write_meta(base, &meta)?;
    Ok(to_summary(&meta, true))
}

/// Reads metadata plus the stored scene, refreshing the last-opened stamp.
/// Pipeline: resolve reference -> read metadata -> read document ->
/// validate envelope/schema -> migration gate -> return payload. The
/// engine import (which validates element data) runs on top of this in
/// the caller; malformed payloads and unsupported versions never reach
/// the live document.
pub fn open_project(base: &Path, id: &str) -> Result<ProjectOpenResult, ProjectError> {
    let mut meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    if meta.format_version > PROJECT_FORMAT_VERSION {
        return Err(ProjectError::new(
            "unsupported-version",
            "projects.errors.migrationRequired",
            Some(meta.format_version.to_string()),
            true,
        ));
    }
    let scene_json = fs::read_to_string(document_path(base, id)).map_err(|_| {
        ProjectError::new(
            "missing-document",
            "projects.errors.missing",
            Some(meta.name.clone()),
            false,
        )
    })?;
    let version = envelope_version(&scene_json)?;
    migration_status(version)?;
    validate_scene_payload(&scene_json)?;
    meta.last_opened_at_ms = Some(now_ms());
    // Opening is read-first: a telemetry stamp must not make a valid
    // document unavailable when another open/save is replacing metadata.
    if let Err(error) = write_meta(base, &meta) {
        eprintln!("project open metadata refresh skipped: {error}");
    }
    let summary = to_summary(&meta, true);
    Ok(ProjectOpenResult {
        summary,
        scene_json,
    })
}

/// Reads a project for a Home thumbnail without changing open metadata.
pub fn preview_project(base: &Path, id: &str) -> Result<ProjectOpenResult, ProjectError> {
    let meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    if meta.format_version > PROJECT_FORMAT_VERSION {
        return Err(ProjectError::new(
            "unsupported-version",
            "projects.errors.migrationRequired",
            Some(meta.format_version.to_string()),
            true,
        ));
    }
    let scene_json = fs::read_to_string(document_path(base, id)).map_err(|_| {
        ProjectError::new(
            "missing-document",
            "projects.errors.missing",
            Some(meta.name.clone()),
            false,
        )
    })?;
    let version = envelope_version(&scene_json)?;
    migration_status(version)?;
    validate_scene_payload(&scene_json)?;
    Ok(ProjectOpenResult {
        summary: to_summary(&meta, true),
        scene_json,
    })
}

/// Renames the display name; the directory id stays stable.
pub fn rename_project(base: &Path, id: &str, name: &str) -> Result<ProjectSummary, ProjectError> {
    let mut meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    meta.name = validate_name(name)?;
    meta.updated_at_ms = now_ms();
    write_meta(base, &meta)?;
    let document_exists = document_path(base, id).exists();
    Ok(to_summary(&meta, document_exists))
}

/// Copies metadata and payload under a fresh id with an independent path.
pub fn duplicate_project(base: &Path, id: &str) -> Result<ProjectSummary, ProjectError> {
    let source = read_meta(base, id)?;
    if source.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    let scene_json = fs::read_to_string(document_path(base, id)).map_err(|_| {
        ProjectError::new(
            "missing-document",
            "projects.errors.missing",
            Some(source.name.clone()),
            false,
        )
    })?;
    check_scene_version(&scene_json)?;
    let base_name = format!("{} copy", source.name);
    let name = validate_name(&base_name)
        .unwrap_or_else(|_| base_name.chars().take(MAX_NAME_LEN).collect::<String>());
    let now = now_ms();
    let meta = ProjectMeta {
        id: generate_id(),
        name,
        kind: source.kind.clone(),
        created_at_ms: now,
        updated_at_ms: now,
        last_opened_at_ms: Some(now),
        deleted_at_ms: None,
        schema_version: source.schema_version,
        format_version: PROJECT_FORMAT_VERSION,
        favorite_at_ms: None,
    };
    fs::create_dir_all(project_dir(base, &meta.id)).map_err(|e| storage_error(e.to_string()))?;
    atomic_write(&document_path(base, &meta.id), scene_json.as_bytes())?;
    write_meta(base, &meta)?;
    Ok(to_summary(&meta, true))
}

/// Moves a project into Trash without removing its metadata or document.
pub fn delete_project(base: &Path, id: &str) -> Result<(), ProjectError> {
    let mut meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    meta.deleted_at_ms = Some(now_ms());
    write_meta(base, &meta)
}

/// Restores a project from Trash before its retention period expires.
pub fn restore_project(base: &Path, id: &str) -> Result<ProjectSummary, ProjectError> {
    purge_expired_projects(base)?;
    let mut meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_none() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    meta.deleted_at_ms = None;
    write_meta(base, &meta)?;
    let document_exists = document_path(base, id).exists();
    Ok(to_summary(&meta, document_exists))
}

/// Permanently removes a project's metadata and document.
pub fn delete_project_permanently(base: &Path, id: &str) -> Result<(), ProjectError> {
    validate_id(id)?;
    let meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_none() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    fs::remove_dir_all(project_dir(base, id)).map_err(|e| storage_error(format!("{id}: {e}")))?;
    Ok(())
}

/// Replaces the stored payload after validation. Validation runs before
/// any write, so a bad payload never replaces the previous valid file;
/// the previous payload is also retained as a backup beside the live
/// document before the commit.
pub fn save_project(
    base: &Path,
    id: &str,
    scene_json: &str,
) -> Result<ProjectSummary, ProjectError> {
    let mut meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    let version = validate_scene_payload(scene_json)?;
    retain_backup(base, id);
    atomic_write(&document_path(base, id), scene_json.as_bytes())?;
    meta.schema_version = version;
    meta.updated_at_ms = now_ms();
    write_meta(base, &meta)?;
    Ok(to_summary(&meta, true))
}

/// Marks a project as a favorite.
pub fn favorite_project(base: &Path, id: &str) -> Result<ProjectSummary, ProjectError> {
    let mut meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    meta.favorite_at_ms = Some(now_ms());
    write_meta(base, &meta)?;
    let document_exists = document_path(base, id).exists();
    Ok(to_summary(&meta, document_exists))
}

/// Removes a project from favorites.
pub fn unfavorite_project(base: &Path, id: &str) -> Result<ProjectSummary, ProjectError> {
    let mut meta = read_meta(base, id)?;
    if meta.deleted_at_ms.is_some() {
        return Err(ProjectError::new(
            "not-found",
            "projects.errors.missing",
            Some(id.to_string()),
            false,
        ));
    }
    meta.favorite_at_ms = None;
    write_meta(base, &meta)?;
    let document_exists = document_path(base, id).exists();
    Ok(to_summary(&meta, document_exists))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn blank_scene() -> String {
        serde_json::json!({
            "schemaVersion": SCHEMA_VERSION,
            "version": SCHEMA_VERSION,
            "elements": [],
            "elementOrder": []
        })
        .to_string()
    }

    fn test_base() -> PathBuf {
        let n = TEST_DIR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "opennary-projects-test-{}-{}-{n}",
            std::process::id(),
            now_ms()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_and_list_roundtrip() {
        let base = test_base();
        let created = create_project(&base, "First", &blank_scene(), None).unwrap();
        assert_eq!(created.name, "First");
        assert!(created.document_exists);
        let listed = list_projects(&base).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn list_never_parses_scene_payloads() {
        let base = test_base();
        let created = create_project(&base, "Heavy", &blank_scene(), None).unwrap();
        fs::write(
            document_path(&base, &created.id),
            r#"{"schemaVersion":1,"version":1,"not":"a scene"}"#,
        )
        .unwrap();
        let listed = list_projects(&base).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Heavy");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn open_refreshes_last_opened() {
        let base = test_base();
        let created = create_project(&base, "Open me", &blank_scene(), None).unwrap();
        let opened = open_project(&base, &created.id).unwrap();
        assert_eq!(opened.summary.id, created.id);
        assert!(opened.summary.last_opened_at_ms.is_some());
        assert!(opened.scene_json.contains("elementOrder"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rename_trims_and_keeps_id_stable() {
        let base = test_base();
        let created = create_project(&base, "Before", &blank_scene(), None).unwrap();
        let renamed = rename_project(&base, &created.id, "  After  ").unwrap();
        assert_eq!(renamed.id, created.id);
        assert_eq!(renamed.name, "After");
        assert!(rename_project(&base, &created.id, "   ").is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn project_names_are_limited_to_fifty_characters() {
        assert_eq!(
            validate_name(&"a".repeat(MAX_NAME_LEN)).unwrap().len(),
            MAX_NAME_LEN
        );
        assert_eq!(
            validate_name(&"a".repeat(MAX_NAME_LEN + 1))
                .unwrap_err()
                .message_key,
            "projects.errors.nameTooLong"
        );
    }

    #[test]
    fn duplicate_gets_independent_identity() {
        let base = test_base();
        let created = create_project(&base, "Original", &blank_scene(), None).unwrap();
        let copy = duplicate_project(&base, &created.id).unwrap();
        assert_ne!(copy.id, created.id);
        assert!(copy.name.contains("Original"));
        assert_eq!(list_projects(&base).unwrap().len(), 2);
        delete_project(&base, &created.id).unwrap();
        assert_eq!(list_projects(&base).unwrap().len(), 1);
        assert_eq!(list_trash_projects(&base).unwrap().len(), 1);
        restore_project(&base, &created.id).unwrap();
        assert!(open_project(&base, &copy.id).is_ok());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn trash_restore_permanent_delete_and_expiration() {
        let base = test_base();
        let project = create_project(&base, "Recoverable", &blank_scene(), None).unwrap();

        delete_project(&base, &project.id).unwrap();
        assert!(list_projects(&base).unwrap().is_empty());
        let trashed = list_trash_projects(&base).unwrap();
        assert_eq!(trashed.len(), 1);
        assert!(trashed[0].deleted_at_ms.is_some());
        assert_eq!(
            open_project(&base, &project.id).unwrap_err().code,
            "not-found"
        );

        restore_project(&base, &project.id).unwrap();
        assert_eq!(list_projects(&base).unwrap().len(), 1);
        assert!(list_trash_projects(&base).unwrap().is_empty());

        delete_project(&base, &project.id).unwrap();
        delete_project_permanently(&base, &project.id).unwrap();
        assert!(list_trash_projects(&base).unwrap().is_empty());
        assert!(!project_dir(&base, &project.id).exists());

        let expired = create_project(&base, "Expired", &blank_scene(), None).unwrap();
        let mut meta = read_meta(&base, &expired.id).unwrap();
        meta.deleted_at_ms = Some(now_ms().saturating_sub(TRASH_RETENTION_MS + 1));
        write_meta(&base, &meta).unwrap();
        assert!(list_trash_projects(&base).unwrap().is_empty());
        assert!(!project_dir(&base, &expired.id).exists());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_document_reports_missing() {
        let base = test_base();
        let created = create_project(&base, "Ghost", &blank_scene(), None).unwrap();
        fs::remove_file(document_path(&base, &created.id)).unwrap();
        let listed = list_projects(&base).unwrap();
        assert!(!listed[0].document_exists);
        let err = open_project(&base, &created.id).unwrap_err();
        assert_eq!(err.code, "missing-document");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn unsupported_scene_version_requires_migration() {
        let base = test_base();
        let future = r#"{"schemaVersion":999,"version":999,"elements":[],"elementOrder":[]}"#;
        let err = create_project(&base, "Future", future, None).unwrap_err();
        assert_eq!(err.code, "unsupported-version");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rejects_path_traversal_ids() {
        let base = test_base();
        assert!(validate_id("../evil").is_err());
        assert!(validate_id("a/b").is_err());
        assert!(open_project(&base, "../evil").is_err());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn malformed_document_is_invalid_data() {
        let base = test_base();
        let created = create_project(&base, "Broken", &blank_scene(), None).unwrap();
        fs::write(document_path(&base, &created.id), "{not json").unwrap();
        let err = open_project(&base, &created.id).unwrap_err();
        assert_eq!(err.code, "invalid-data");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn non_object_root_is_invalid_data() {
        let base = test_base();
        let err = create_project(&base, "Array", "[1,2,3]", None).unwrap_err();
        assert_eq!(err.code, "invalid-data");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn non_array_elements_are_invalid_data() {
        let base = test_base();
        let bad = r#"{"schemaVersion":1,"version":1,"elements":{},"elementOrder":[]}"#;
        let err = create_project(&base, "Bad shape", bad, None).unwrap_err();
        assert_eq!(err.code, "invalid-data");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn missing_project_reports_not_found() {
        let base = test_base();
        let err = open_project(&base, "p-does-not-exist").unwrap_err();
        assert_eq!(err.code, "not-found");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn failed_save_keeps_previous_payload() {
        let base = test_base();
        let created = create_project(&base, "Keep me", &blank_scene(), None).unwrap();
        let before = fs::read_to_string(document_path(&base, &created.id)).unwrap();
        let future = r#"{"schemaVersion":999,"version":999,"elements":[],"elementOrder":[]}"#;
        let err = save_project(&base, &created.id, future).unwrap_err();
        assert_eq!(err.code, "unsupported-version");
        let after = fs::read_to_string(document_path(&base, &created.id)).unwrap();
        assert_eq!(before, after);
        assert!(open_project(&base, &created.id).is_ok());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn successful_save_retains_backup() {
        let base = test_base();
        let created = create_project(&base, "Backup", &blank_scene(), None).unwrap();
        save_project(&base, &created.id, &blank_scene()).unwrap();
        assert!(document_backup_path(&base, &created.id).exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn create_defaults_to_design_kind() {
        let base = test_base();
        let created = create_project(&base, "Kindless", &blank_scene(), None).unwrap();
        assert_eq!(created.kind, "design");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn create_accepts_whiteboard_and_diagram_kinds() {
        let base = test_base();
        let board = create_project(&base, "Board", &blank_scene(), Some("whiteboard")).unwrap();
        assert_eq!(board.kind, "whiteboard");
        let diagram = create_project(&base, "Flow", &blank_scene(), Some("diagram")).unwrap();
        assert_eq!(diagram.kind, "diagram");
        let kinds: Vec<String> = list_projects(&base)
            .unwrap()
            .iter()
            .map(|entry| entry.kind.clone())
            .collect();
        assert!(kinds.contains(&"whiteboard".to_string()));
        assert!(kinds.contains(&"diagram".to_string()));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn create_rejects_unknown_kinds() {
        let base = test_base();
        let err = create_project(&base, "Weird", &blank_scene(), Some("spreadsheet")).unwrap_err();
        assert_eq!(err.code, "invalid-kind");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn duplicate_preserves_project_kind() {
        let base = test_base();
        let created = create_project(&base, "Board", &blank_scene(), Some("whiteboard")).unwrap();
        let copy = duplicate_project(&base, &created.id).unwrap();
        assert_eq!(copy.kind, "whiteboard");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn metadata_without_kind_still_reads_as_design() {
        let base = test_base();
        let created = create_project(&base, "Legacy", &blank_scene(), None).unwrap();
        let raw = fs::read_to_string(meta_path(&base, &created.id)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(value.get("kind").is_some());
        let mut legacy = value;
        legacy.as_object_mut().unwrap().remove("kind");
        fs::write(
            meta_path(&base, &created.id),
            serde_json::to_vec_pretty(&legacy).unwrap(),
        )
        .unwrap();
        let listed = list_projects(&base).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].kind, "design");
        let _ = fs::remove_dir_all(&base);
    }
}
