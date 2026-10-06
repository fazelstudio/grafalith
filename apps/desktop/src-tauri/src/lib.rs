//! Nary desktop application layer (Tauri host).
//!
//! Thin native host over the Rust engine: owns one instance-scoped
//! [`Engine`](nary_bindings::Engine) behind Tauri managed state and
//! exposes it through Tauri commands. No domain logic lives here — hit
//! testing, selection, transforms, history, geometry, and rendering rules
//! all stay in `nary-core` behind `nary-bindings`.
//!
//! Project files live beside the engine state: one directory per project
//! holding a small metadata file and the full scene payload, so the home
//! list reads metadata only and never parses scene documents.

mod projects;

use nary_bindings::tauri as engine_ipc;
use nary_bindings::Engine;
use std::sync::Mutex;

/// Tauri managed state: the single instance-scoped engine handle.
///
/// One engine per application instance (no shared globals), shared
/// across commands behind a lock. Tauri commands are short JSON-string
/// crossings; the lock is never held across `.await` points.
pub struct AppState {
    engine: Mutex<Engine>,
}

/// Resolves the base directory owning the `projects/` folder.
fn projects_base(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| {
        projects::ProjectError {
            code: "storage-unavailable".to_string(),
            message_key: "projects.errors.storageUnavailable".to_string(),
            details: Some(e.to_string()),
            recoverable: true,
        }
        .to_json()
    })
}

#[tauri::command]
fn apply_batch(state: tauri::State<'_, AppState>, batch: String) -> String {
    let mut engine = state.engine.lock().unwrap();
    engine_ipc::tauri_apply_batch(&mut engine, &batch)
}

#[tauri::command]
fn status(state: tauri::State<'_, AppState>) -> String {
    let engine = state.engine.lock().unwrap();
    engine_ipc::tauri_status(&engine)
}

#[tauri::command]
fn export_scene(state: tauri::State<'_, AppState>) -> String {
    let engine = state.engine.lock().unwrap();
    engine_ipc::tauri_export_scene(&engine)
}

#[tauri::command]
fn import_scene(state: tauri::State<'_, AppState>, scene_json: String, tracked: bool) -> String {
    let mut engine = state.engine.lock().unwrap();
    engine_ipc::tauri_import_scene(&mut engine, &scene_json, tracked)
}

#[tauri::command]
fn create_engine(state: tauri::State<'_, AppState>) {
    let mut engine = state.engine.lock().unwrap();
    *engine = engine_ipc::create_engine();
}

#[tauri::command]
fn project_list(app: tauri::AppHandle) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::list_projects(&base)
        .map(|summaries| serde_json::to_string(&summaries).unwrap_or_else(|_| "[]".to_string()))
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_trash_list(app: tauri::AppHandle) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::list_trash_projects(&base)
        .map(|summaries| serde_json::to_string(&summaries).unwrap_or_else(|_| "[]".to_string()))
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_purge_expired(app: tauri::AppHandle) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::purge_expired_projects(&base)
        .map(|()| "{\"purged\":true}".to_string())
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_create(
    app: tauri::AppHandle,
    name: String,
    scene_json: String,
) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::create_project(&base, &name, &scene_json)
        .and_then(|summary| {
            serde_json::to_string(&summary).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_open(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::open_project(&base, &id)
        .and_then(|result| {
            serde_json::to_string(&result).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_rename(app: tauri::AppHandle, id: String, name: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::rename_project(&base, &id, &name)
        .and_then(|summary| {
            serde_json::to_string(&summary).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_duplicate(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::duplicate_project(&base, &id)
        .and_then(|summary| {
            serde_json::to_string(&summary).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_delete(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::delete_project(&base, &id)
        .map(|()| "{\"deleted\":true}".to_string())
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_restore(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::restore_project(&base, &id)
        .and_then(|summary| {
            serde_json::to_string(&summary).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_delete_permanently(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::delete_project_permanently(&base, &id)
        .map(|()| "{\"deleted\":true}".to_string())
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_save(app: tauri::AppHandle, id: String, scene_json: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::save_project(&base, &id, &scene_json)
        .and_then(|summary| {
            serde_json::to_string(&summary).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_favorite(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::favorite_project(&base, &id)
        .and_then(|summary| {
            serde_json::to_string(&summary).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

#[tauri::command]
fn project_unfavorite(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let base = projects_base(&app)?;
    projects::unfavorite_project(&base, &id)
        .and_then(|summary| {
            serde_json::to_string(&summary).map_err(|e| projects::ProjectError {
                code: "storage-unavailable".to_string(),
                message_key: "projects.errors.storageUnavailable".to_string(),
                details: Some(e.to_string()),
                recoverable: true,
            })
        })
        .map_err(|e| e.to_json())
}

/// Starts the Tauri application with a fresh engine instance.
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_snap_layout::init()
                .button_id("restore-btn")
                .build(),
        )
        .manage(AppState {
            engine: Mutex::new(Engine::new()),
        })
        .setup(|app| {
            use tauri::Manager;
            if let Some(win) = app.get_webview_window("main") {
                // Relative resize floor: 60% of the monitor the window is on,
                // recomputed per device so no fixed pixel floor is needed.
                // Creation stays hidden and unmaximized on purpose: the
                // frontend maximizes while hidden and shows only once content
                // is painted, which avoids the maximized-creation flash.
                let fraction = 0.6_f64;
                let monitor = win
                    .current_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| win.primary_monitor().ok().flatten());
                if let Some(monitor) = monitor {
                    let size = monitor.size();
                    let width = (size.width as f64 * fraction).round() as u32;
                    let height = (size.height as f64 * fraction).round() as u32;
                    let _ = win.set_min_size(Some(tauri::Size::Physical(tauri::PhysicalSize {
                        width,
                        height,
                    })));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            apply_batch,
            status,
            export_scene,
            import_scene,
            create_engine,
            project_list,
            project_trash_list,
            project_purge_expired,
            project_create,
            project_open,
            project_rename,
            project_duplicate,
            project_delete,
            project_restore,
            project_delete_permanently,
            project_save,
            project_favorite,
            project_unfavorite,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
