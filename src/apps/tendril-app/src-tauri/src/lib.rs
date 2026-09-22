pub mod commands;
pub mod daemon;
pub mod error;
pub mod models;
pub mod service;
pub mod verification_reports;

pub use commands::agents::*;
pub use commands::attachments::*;
pub use commands::chat::*;
pub use commands::config::*;
pub use commands::dashboard::*;
pub use commands::github::*;
pub use commands::inbox::*;
pub use commands::jobs::*;
pub use commands::local_file::*;
pub use commands::plans::*;
pub use commands::promptwares::*;
pub use commands::pull_requests::*;
pub use commands::state::*;
pub use commands::tables::*;
pub use commands::tunnel::*;
pub use commands::vault::*;
pub use commands::*;

use service::{MasterDiscovery, WsBridge};

pub fn run() {
    use tauri::Manager;

    let ui_store = commands::state::init_ui_state_store();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Job-exit notifications route to the OS through this plugin when `desktopNotifications` is
        // on. The matching `notification:default` entry in `capabilities/default.json` is what makes
        // it reachable from the webview: without it `sendNotification` is refused at runtime, and
        // nothing about that shows up at build time.
        .plugin(tauri_plugin_notification::init())
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

            // Install the daemon the app is a client of.
            //
            // A Tendril installer puts the app on the machine and nothing else, so on first run the
            // app copies its bundled `tendril` and `opencode` sidecars into `<home>/bin` and
            // registers an autostart unit against them. That is what makes a fresh install able to
            // serve plans and run agents without the user also installing the CLI - and what makes
            // the daemon survive a reboot instead of dying with the window.
            //
            // On a background thread because it can copy ~250 MB on a version bump, and nothing
            // about showing a window depends on it. Idempotent and entirely best-effort: a machine
            // that refuses the copy or the LaunchAgent still gets the managed child the supervisor
            // has always spawned. Off in debug builds unless `TENDRIL_PROVISION_SERVICE` is set,
            // because a dev build should not copy its debug sidecars over a developer's real
            // `~/.tendril/bin`.
            if service::provision::should_provision_on_startup() {
                std::thread::spawn(|| {
                    let report = service::provision(&daemon::resolve_tendril_home());
                    for err in &report.errors {
                        tracing::warn!("Service provisioning: {err}");
                    }
                    if report.changed() {
                        tracing::info!(
                            "Service provisioning installed {:?} into {} ({:?})",
                            report.installed,
                            report.bin_dir,
                            report.autostart
                        );
                    }
                });
            }

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
            cmd_get_plan_git,
            cmd_get_plan_changes,
            cmd_get_plan_summary,
            cmd_get_plan_artifacts,
            cmd_get_plan_artifact_content,
            cmd_get_revision,
            cmd_write_revision,
            cmd_update_latest_revision,
            cmd_get_verification_report,
            cmd_list_verification_reports,
            cmd_list_recommendations,
            cmd_set_recommendation_state,
            cmd_set_verification_status,
            cmd_list_diff_comments,
            cmd_upsert_diff_comment,
            cmd_delete_diff_comment,
            cmd_clear_diff_comments,
            cmd_list_annotations,
            cmd_upsert_annotation,
            cmd_delete_annotation,
            cmd_clear_annotations,
            cmd_list_jobs,
            cmd_get_job,
            cmd_start_job,
            cmd_cancel_job,
            cmd_delete_job,
            cmd_force_start_job,
            cmd_clear_jobs,
            cmd_subscribe_job_events,
            cmd_unsubscribe_job_events,
            // The server-paged table API. Without this the Jobs table cannot reach
            // `POST /api/jobs/query` at all — the webview holds no bearer secret — so it would fall
            // back to re-reading the whole listing per window.
            cmd_query_table,
            // Attachment and screenshot previews. The webview cannot load a `file://` path, so it asks
            // the daemon's guarded `/ivy/local-file` for the bytes — see `commands::local_file`.
            cmd_get_local_file_preview,
            // The other half of the preview: a file picked from outside every local-file root is copied
            // into `<TendrilHome>/Attachments/<session>/` so that the route above will serve it back.
            cmd_upload_chat_attachment,
            cmd_list_projects,
            cmd_create_project,
            // The only way the app may add a repository to an existing project: `PUT /api/config`
            // stores what it is handed, so a remote URL added that way keeps its credentials and
            // never becomes a checkout. This route clones first.
            cmd_add_project_repo,
            cmd_rename_project,
            cmd_remove_project,
            cmd_delete_project_data,
            cmd_get_config,
            cmd_put_config,
            cmd_get_config_text,
            cmd_put_config_text,
            cmd_get_promptware_program,
            cmd_get_onboarding_status,
            cmd_complete_onboarding,
            cmd_dismiss_onboarding,
            cmd_subscribe_newsletter,
            cmd_run_doctor,
            cmd_get_models_status,
            cmd_refresh_models,
            cmd_get_version_info,
            cmd_check_version_now,
            cmd_execute_review_action,
            cmd_send_review_action_input,
            cmd_resize_review_action,
            cmd_close_review_action,
            cmd_save_ui_state,
            cmd_load_ui_state,
            cmd_get_service_logs,
            cmd_restart_service,
            cmd_repair_service,
            cmd_switch_service_mode,
            cmd_install_service,
            cmd_uninstall_service_autostart,
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
            cmd_execute_agent_terminal,
            cmd_send_agent_terminal_input,
            cmd_resize_agent_terminal,
            cmd_close_agent_terminal,
            cmd_list_agents,
            cmd_get_agent_hints,
            cmd_fetch_provider_models,
            cmd_test_agent,
            cmd_get_agent_usage,
            cmd_list_github_issues,
            cmd_vault_list,
            cmd_vault_status,
            cmd_vault_catalog,
            cmd_vault_github_accounts,
            cmd_vault_discover,
            cmd_vault_create,
            cmd_vault_connect,
            cmd_vault_disconnect,
            cmd_vault_set_always_up_to_date,
            cmd_vault_pull,
            cmd_vault_project_assets,
            cmd_vault_push,
            cmd_vault_import,
            cmd_vault_merge,
            cmd_vault_delete_project,
            cmd_check_inbox,
            cmd_list_inbox_proposals,
            cmd_accept_inbox_proposal,
            cmd_dismiss_inbox_proposal,
            cmd_list_pull_requests,
            cmd_sync_pull_requests,
            cmd_get_dashboard_activity,
            cmd_get_shipped_features,
            cmd_get_recent_merged_prs,
            cmd_get_recent_plan_costs,
            cmd_get_agent_cost_breakdown,
            // Share tunnel. Without these four the share dialog is unreachable from the running app.
            cmd_get_share_tunnel,
            cmd_start_share_tunnel,
            cmd_stop_share_tunnel,
            cmd_get_cloudflared_install_state,
            // The install itself and the way out of one. Without these the Install button in Security
            // & Tunneling cannot reach the daemon, and a fresh machine has no way to get cloudflared
            // except by hand.
            cmd_install_cloudflared,
            cmd_cancel_cloudflared_install,
            // Full-access tunnel and the session password it is gated on — Settings' "Security &
            // Tunneling" section. Same module as the share commands.
            cmd_get_full_tunnel,
            cmd_start_full_tunnel,
            cmd_stop_full_tunnel,
            cmd_get_password_status,
            cmd_set_password,
            cmd_clear_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
