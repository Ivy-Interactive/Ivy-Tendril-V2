pub mod commands;
pub mod daemon;
pub mod error;
pub mod models;
pub mod service;
pub mod verification_reports;

pub use commands::agents::*;
pub use commands::chat::*;
pub use commands::config::*;
pub use commands::github::*;
pub use commands::inbox::*;
pub use commands::jobs::*;
pub use commands::plans::*;
pub use commands::pull_requests::*;
pub use commands::state::*;
pub use commands::*;

use service::{MasterDiscovery, WsBridge};

pub fn run() {
    use tauri::Manager;

    let ui_store = commands::state::init_ui_state_store();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ui_store)
        .setup(|app| {
            // Connect the WebSocket bridge, which re-emits daemon events to the frontend as
            // `plan-event` / `job-event` / `chat-event`. Without this the UI only ever sees state it
            // fetched itself.
            //
            // The bearer secret is read here and stays in the native side; it is never handed to the
            // webview. `WsBridge` reconnects with backoff on its own, so a daemon that is not up yet
            // is fine. A missing `.master` at startup is not: discovery happens once, so the app has
            // to be restarted after the daemon first writes it. Live re-discovery would need a
            // watcher on the file, which is out of scope here.
            match MasterDiscovery::new().read_master() {
                Ok(master) => {
                    let ws_scheme = if master.scheme == "https" {
                        "wss"
                    } else {
                        "ws"
                    };
                    let ws_url = format!("{}://{}:{}/api/ws", ws_scheme, master.host, master.port);
                    let bridge = WsBridge::new(app.handle().clone(), ws_url, Some(master.secret));
                    app.manage(bridge);
                }
                Err(err) => {
                    eprintln!("WebSocket bridge not started: {err}");
                }
            }

            // The daemon origin comes from `.master`, which may not exist yet: the app can easily
            // start before the daemon. The bridge spawns either way and re-reads `.master` on each
            // attempt, so an absent daemon costs nothing but a retry.
            //
            // The bearer secret is read here, natively, and stays inside the bridge — the same rule
            // `get_client_from_master` follows, and the reason the stream is bridged at all instead
            // of being consumed by the webview.
            let (base_url, secret) = match service::MasterDiscovery::new().read_master() {
                Ok(master) => (
                    format!("{}://{}:{}", master.scheme, master.host, master.port),
                    Some(master.secret),
                ),
                Err(e) => {
                    tracing::info!("No daemon metadata yet ({e}); the change stream will retry");
                    (String::new(), None)
                }
            };

            let bridge = service::ChangeBridge::new(app.handle().clone(), base_url, secret);
            app.manage(bridge);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_daemon_status,
            get_tendril_home,
            cmd_check_service_health,
            cmd_get_service_info,
            cmd_list_plans,
            cmd_get_plan,
            cmd_update_plan_field,
            cmd_delete_plan,
            cmd_reset_plan,
            cmd_get_repo_status,
            cmd_get_revision,
            cmd_write_revision,
            cmd_get_verification_report,
            cmd_list_verification_reports,
            cmd_list_recommendations,
            cmd_set_recommendation_state,
            cmd_set_verification_status,
            cmd_list_diff_comments,
            cmd_upsert_diff_comment,
            cmd_delete_diff_comment,
            cmd_clear_diff_comments,
            cmd_list_jobs,
            cmd_get_job,
            cmd_start_job,
            cmd_cancel_job,
            cmd_list_projects,
            cmd_create_project,
            cmd_get_config,
            cmd_put_config,
            cmd_get_onboarding_status,
            cmd_complete_onboarding,
            cmd_dismiss_onboarding,
            cmd_run_doctor,
            cmd_get_models_status,
            cmd_refresh_models,
            cmd_get_version_info,
            cmd_check_version_now,
            cmd_execute_review_action,
            cmd_save_ui_state,
            cmd_load_ui_state,
            cmd_get_service_logs,
            cmd_restart_service,
            cmd_repair_service,
            cmd_switch_service_mode,
            cmd_list_chat_sessions,
            cmd_create_chat_session,
            cmd_get_chat_session,
            cmd_update_chat_session,
            cmd_delete_chat_session,
            cmd_post_chat_message,
            cmd_execute_chat_turn,
            cmd_cancel_chat_turn,
            cmd_answer_chat_questions,
            cmd_get_chat_queue,
            cmd_enqueue_chat_message,
            cmd_clear_chat_queue,
            cmd_delete_queued_chat_item,
            cmd_update_queued_chat_item,
            cmd_list_agents,
            cmd_list_github_issues,
            cmd_check_inbox,
            cmd_list_inbox_proposals,
            cmd_accept_inbox_proposal,
            cmd_dismiss_inbox_proposal,
            cmd_list_pull_requests,
            cmd_sync_pull_requests,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
