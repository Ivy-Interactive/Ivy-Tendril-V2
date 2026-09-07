pub mod commands;
pub mod daemon;
pub mod error;
pub mod models;
pub mod service;
pub mod verification_reports;

pub use commands::config::*;
pub use commands::jobs::*;
pub use commands::plans::*;
pub use commands::state::*;
pub use commands::*;

pub fn run() {
    let ui_store = commands::state::init_ui_state_store();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ui_store)
        .invoke_handler(tauri::generate_handler![
            get_daemon_status,
            get_tendril_home,
            cmd_check_service_health,
            cmd_get_service_info,
            cmd_list_plans,
            cmd_get_plan,
            cmd_update_plan_field,
            cmd_get_revision,
            cmd_write_revision,
            cmd_get_verification_report,
            cmd_list_verification_reports,
            cmd_list_recommendations,
            cmd_set_recommendation_state,
            cmd_list_jobs,
            cmd_get_job,
            cmd_start_job,
            cmd_cancel_job,
            cmd_list_projects,
            cmd_get_config,
            cmd_save_ui_state,
            cmd_load_ui_state,
            cmd_get_service_logs,
            cmd_restart_service,
            cmd_repair_service,
            cmd_switch_service_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
