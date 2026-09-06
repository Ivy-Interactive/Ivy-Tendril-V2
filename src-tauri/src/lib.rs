pub mod commands;
pub mod daemon;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_daemon_status,
            commands::get_tendril_home,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
