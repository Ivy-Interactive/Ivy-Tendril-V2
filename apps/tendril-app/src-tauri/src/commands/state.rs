use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub type UiStateStore = Arc<RwLock<HashMap<String, String>>>;

pub fn init_ui_state_store() -> UiStateStore {
    let mut map = HashMap::new();
    let home = crate::daemon::resolve_tendril_home();
    let file = home.join("ui_state.json");
    if file.exists() {
        if let Ok(content) = std::fs::read_to_string(&file) {
            if let Ok(deserialized) = serde_json::from_str::<HashMap<String, String>>(&content) {
                map = deserialized;
            }
        }
    }
    Arc::new(RwLock::new(map))
}

#[tauri::command]
pub async fn cmd_save_ui_state(
    state: tauri::State<'_, UiStateStore>,
    key: String,
    value: String,
) -> Result<(), String> {
    let mut lock = state.write().await;
    lock.insert(key, value);

    let home = crate::daemon::resolve_tendril_home();
    let file = home.join("ui_state.json");
    if let Ok(serialized) = serde_json::to_string_pretty(&*lock) {
        let _ = std::fs::write(file, serialized);
    }

    Ok(())
}

#[tauri::command]
pub async fn cmd_load_ui_state(
    state: tauri::State<'_, UiStateStore>,
    key: String,
) -> Result<Option<String>, String> {
    let lock = state.read().await;
    Ok(lock.get(&key).cloned())
}
