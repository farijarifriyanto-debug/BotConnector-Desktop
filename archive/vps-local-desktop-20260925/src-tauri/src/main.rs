use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_llamacpp::state::LlamacppState;

const DEFAULT_IDLE_SECS: u64 = 300;

struct ControllerState {
    activity_generation: AtomicU64,
    idle_secs: AtomicU64,
}

impl Default for ControllerState {
    fn default() -> Self {
        Self {
            activity_generation: AtomicU64::new(0),
            idle_secs: AtomicU64::new(DEFAULT_IDLE_SECS),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelFile {
    id: String,
    name: String,
    path: String,
    size_bytes: u64,
    is_mmproj: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    running: bool,
    pid: Option<u32>,
    registered_models: Vec<String>,
    loaded_models: Vec<String>,
    idle_seconds: u64,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data directory: {e}"))
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create models directory: {e}"))?;
    Ok(dir)
}

fn safe_model_id(path: &Path, root: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    let raw = relative.with_extension("").to_string_lossy();
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '-'
            }
        })
        .collect()
}

fn path_for_ini(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn scan_models_inner(app: &AppHandle) -> Result<Vec<ModelFile>, String> {
    let root = models_dir(app)?;
    let mut models = Vec::new();

    for entry in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let is_gguf = path
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| v.eq_ignore_ascii_case("gguf"))
            .unwrap_or(false);
        if !is_gguf {
            continue;
        }

        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);

        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("model.gguf")
            .to_string();
        let lower = name.to_ascii_lowercase();
        let is_mmproj = lower.contains("mmproj");

        models.push(ModelFile {
            id: safe_model_id(path, &root),
            name,
            path: path_for_ini(path),
            size_bytes,
            is_mmproj,
        });
    }

    models.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(models)
}

#[tauri::command]
fn list_models(app: AppHandle) -> Result<Vec<ModelFile>, String> {
    scan_models_inner(&app)
}

fn write_preset(app: &AppHandle, models: &[ModelFile]) -> Result<PathBuf, String> {
    let root = data_dir(app)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("Cannot create app data directory: {e}"))?;
    let preset_path = root.join("router.preset.ini");

    let mut preset = String::from("[*]\nparallel = 1\nkv-unified = true\nctx-size = 4096\n\n");
    let mut count = 0usize;

    for model in models.iter().filter(|m| !m.is_mmproj) {
        preset.push_str(&format!(
            "[{}]\nmodel = {}\nload-on-startup = false\n\n",
            model.id, model.path
        ));
        count += 1;
    }

    if count == 0 {
        return Err("No chat GGUF model is installed yet.".into());
    }

    std::fs::write(&preset_path, preset).map_err(|e| format!("Cannot write router preset: {e}"))?;
    Ok(preset_path)
}

async fn worker_snapshot(
    state: &Arc<LlamacppState>,
) -> Result<Option<(u16, String, u32, Vec<String>)>, String> {
    let mut guard = state.engine.lock().await;
    let Some(handle) = guard.as_mut() else {
        return Ok(None);
    };

    if handle.exited().is_some() {
        *guard = None;
        return Ok(None);
    }

    Ok(Some((
        handle.port,
        handle.api_key.clone(),
        handle.pid,
        handle.models.clone(),
    )))
}

async fn loaded_models(port: u16, api_key: &str) -> Result<Vec<String>, String> {
    let response = reqwest::Client::new()
        .get(format!("http://127.0.0.1:{port}/models"))
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| format!("Cannot query local engine: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Local engine returned HTTP {}", response.status()));
    }

    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid engine model response: {e}"))?;

    let mut loaded = Vec::new();
    if let Some(items) = body.get("data").and_then(Value::as_array) {
        for item in items {
            let status = item.get("status").and_then(Value::as_str).unwrap_or("");

            if status == "loaded" {
                if let Some(id) = item.get("id").and_then(Value::as_str) {
                    loaded.push(id.to_string());
                }
            }
        }
    }
    Ok(loaded)
}

#[tauri::command]
async fn runtime_status(
    state: State<'_, Arc<LlamacppState>>,
    controller: State<'_, ControllerState>,
) -> Result<RuntimeStatus, String> {
    let Some((port, key, pid, registered)) = worker_snapshot(state.inner()).await? else {
        return Ok(RuntimeStatus {
            running: false,
            pid: None,
            registered_models: Vec::new(),
            loaded_models: Vec::new(),
            idle_seconds: controller.idle_secs.load(Ordering::Relaxed),
        });
    };

    let loaded = loaded_models(port, &key).await.unwrap_or_default();
    Ok(RuntimeStatus {
        running: true,
        pid: Some(pid),
        registered_models: registered,
        loaded_models: loaded,
        idle_seconds: controller.idle_secs.load(Ordering::Relaxed),
    })
}

#[tauri::command]
async fn start_runtime(
    app: AppHandle,
    state: State<'_, Arc<LlamacppState>>,
) -> Result<RuntimeStatus, String> {
    let models = scan_models_inner(&app)?;
    let preset = write_preset(&app, &models)?;

    let info = tauri_plugin_llamacpp::engine::commands::start_engine(
        app.clone(),
        state,
        preset.to_string_lossy().into_owned(),
        1,
        0,
        HashMap::new(),
    )
    .await?;

    let controller = app.state::<ControllerState>();
    Ok(RuntimeStatus {
        running: true,
        pid: Some(info.pid),
        registered_models: info.models,
        loaded_models: Vec::new(),
        idle_seconds: controller.idle_secs.load(Ordering::Relaxed),
    })
}

#[tauri::command]
async fn stop_runtime(state: State<'_, Arc<LlamacppState>>) -> Result<(), String> {
    tauri_plugin_llamacpp::engine::commands::stop_engine(state).await
}

async fn unload_all_inner(state: &Arc<LlamacppState>) -> Result<Vec<String>, String> {
    let Some((port, key, _, _)) = worker_snapshot(state).await? else {
        return Ok(Vec::new());
    };

    let loaded = loaded_models(port, &key).await?;
    let client = reqwest::Client::new();
    let mut unloaded = Vec::new();

    for model in loaded {
        let response = client
            .post(format!("http://127.0.0.1:{port}/models/unload"))
            .bearer_auth(&key)
            .json(&serde_json::json!({ "model": model }))
            .send()
            .await
            .map_err(|e| format!("Cannot unload local model: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Unload failed with HTTP {status}: {body}"));
        }
        unloaded.push(model);
    }

    Ok(unloaded)
}

#[tauri::command]
async fn unload_all(
    state: State<'_, Arc<LlamacppState>>,
    controller: State<'_, ControllerState>,
) -> Result<Vec<String>, String> {
    controller
        .activity_generation
        .fetch_add(1, Ordering::SeqCst);
    unload_all_inner(state.inner()).await
}

#[tauri::command]
fn set_idle_minutes(controller: State<'_, ControllerState>, minutes: u64) -> u64 {
    let clamped = minutes.clamp(1, 60);
    let seconds = clamped * 60;
    controller.idle_secs.store(seconds, Ordering::SeqCst);
    controller
        .activity_generation
        .fetch_add(1, Ordering::SeqCst);
    seconds
}

fn schedule_idle_unload(app: AppHandle, ticket: u64, seconds: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(seconds)).await;

        let controller = app.state::<ControllerState>();
        if controller.activity_generation.load(Ordering::SeqCst) != ticket {
            return;
        }

        let state = app.state::<Arc<LlamacppState>>();
        let _ = unload_all_inner(state.inner()).await;
    });
}

async fn ensure_runtime(app: &AppHandle) -> Result<(u16, String, u32, Vec<String>), String> {
    let state = app.state::<Arc<LlamacppState>>();
    if let Some(snapshot) = worker_snapshot(state.inner()).await? {
        return Ok(snapshot);
    }

    let models = scan_models_inner(app)?;
    let preset = write_preset(app, &models)?;
    let info = tauri_plugin_llamacpp::engine::commands::start_engine(
        app.clone(),
        app.state::<Arc<LlamacppState>>(),
        preset.to_string_lossy().into_owned(),
        1,
        0,
        HashMap::new(),
    )
    .await?;

    let state = app.state::<Arc<LlamacppState>>();
    worker_snapshot(state.inner())
        .await?
        .ok_or_else(|| format!("Local engine process {} did not stay running.", info.pid))
}

#[tauri::command]
async fn chat_completion(
    app: AppHandle,
    controller: State<'_, ControllerState>,
    mut payload: Value,
) -> Result<Value, String> {
    let (port, key, _, registered) = ensure_runtime(&app).await?;

    let object = payload
        .as_object_mut()
        .ok_or_else(|| "Chat payload must be a JSON object.".to_string())?;

    let selected = object
        .get("model")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| registered.first().cloned())
        .ok_or_else(|| "No local model is registered.".to_string())?;

    if !registered.iter().any(|id| id == &selected) {
        return Err(format!("Model '{selected}' is not installed."));
    }

    object.insert("model".into(), Value::String(selected));
    object.insert("stream".into(), Value::Bool(false));

    let ticket = controller
        .activity_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let idle_secs = controller.idle_secs.load(Ordering::SeqCst);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("Cannot initialize local HTTP client: {e}"))?;

    let response = client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .bearer_auth(&key)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Local inference request failed: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Cannot read local inference response: {e}"))?;

    if !status.is_success() {
        return Err(format!("Local inference returned HTTP {status}: {body}"));
    }

    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Local inference returned invalid JSON: {e}"))?;

    schedule_idle_unload(app, ticket, idle_secs);
    Ok(json)
}

#[tauri::command]
fn models_path(app: AppHandle) -> Result<String, String> {
    models_dir(&app).map(|p| p.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .manage(ControllerState::default())
        .plugin(tauri_plugin_hardware::init())
        .plugin(tauri_plugin_llamacpp::init())
        .invoke_handler(tauri::generate_handler![
            list_models,
            models_path,
            runtime_status,
            start_runtime,
            stop_runtime,
            unload_all,
            set_idle_minutes,
            chat_completion
        ])
        .run(tauri::generate_context!())
        .expect("error while running BotConnector Local");
}
