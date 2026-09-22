//! What a finished run cost, and the telemetry event that records it.
//!
//! [`extract_and_record_usage`] reads the agent's own token and cost reporting out of the eventwire
//! log and writes it onto the job and into the costs table; [`track_job_completion`] emits the
//! analytics event. The plan-id resolvers are here because both of them need to name the plan a job
//! belonged to, and neither can trust a single field to say so.

use crate::db::open_database;
use crate::jobs::logger::find_log_file;
use crate::models::{JobItem, JobStatus};
use crate::plans::reader::read_plan_yaml;
use std::path::{Path, PathBuf};

/// `Some` only for a genuinely non-empty string. Telemetry omits a property rather than sending an
/// empty one, as the original does.
pub(super) fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The plan id to hand a telemetry context, as a string. `Telemetry` normalizes and salts it into
/// `plan_uuid`; the raw value never leaves the process.
pub(super) fn telemetry_plan_id(job: &JobItem) -> Option<String> {
    resolve_numerical_plan_id(job).map(|id| id.to_string())
}

/// The leading id of a `NNNNN-SafeTitle` folder name. Same reason as [`telemetry_plan_id`]: the
/// caller has a folder name rather than a job.
pub(super) fn plan_id_from_folder_name(folder_name: &str) -> Option<String> {
    let digits: String = folder_name
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    (!digits.is_empty()).then_some(digits)
}

fn resolve_numerical_plan_id(job: &JobItem) -> Option<i32> {
    if let Some(ref id_str) = job.reported_plan_id {
        if let Ok(id) = id_str.trim().parse::<i32>() {
            return Some(id);
        }
    }
    let file_name = std::path::Path::new(&job.plan_file)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(&job.plan_file);
    let digits: String = file_name
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if !digits.is_empty() {
        if let Ok(id) = digits.parse::<i32>() {
            return Some(id);
        }
    }
    None
}

pub fn extract_and_record_usage(tendril_home: &Path, job: &mut JobItem) {
    let mut extracted_timestamp: Option<String> = None;

    let needs_tokens = job.tokens.is_none();
    let needs_cost = job.cost.is_none();
    let needs_breakdown = job.input_tokens.is_none()
        || job.output_tokens.is_none()
        || job.cache_read_tokens.is_none()
        || job.cache_write_tokens.is_none();

    if needs_tokens || needs_cost || needs_breakdown {
        if let Some(log_path) = find_log_file(tendril_home, &job.id, ".eventwire.jsonl")
            .or_else(|| find_log_file(tendril_home, &job.id, ".raw.jsonl"))
        {
            if let Ok(file) = std::fs::File::open(&log_path) {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(file);
                for line in reader.lines().map_while(|l| l.ok()) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        let is_result = v.get("kind").and_then(|k| k.as_str()) == Some("result")
                            || v.get("type").and_then(|t| t.as_str()) == Some("result")
                            || v.get("type").and_then(|t| t.as_str()) == Some("turn.completed");

                        let usage_opt = v.get("usage");
                        if is_result || usage_opt.is_some() {
                            if let Some(ts) = v.get("timestamp").and_then(|t| t.as_str()) {
                                extracted_timestamp = Some(ts.to_string());
                            }
                            if let Some(m) = v.get("model").and_then(|m| m.as_str()) {
                                if job.model.is_none() {
                                    job.model = Some(m.to_string());
                                }
                            }
                            // Claude Code's result event carries no `model`; it reports usage keyed
                            // by model id under `modelUsage`. Without this the model column stays
                            // empty and the cost estimate falls back to a default model's pricing.
                            if job.model.is_none() {
                                if let Some(first) = v
                                    .get("modelUsage")
                                    .and_then(|m| m.as_object())
                                    .and_then(|m| m.keys().next())
                                {
                                    job.model = Some(first.to_string());
                                }
                            }
                            if let Some(usage) = usage_opt {
                                if let Some(m) = usage.get("model").and_then(|m| m.as_str()) {
                                    if job.model.is_none() {
                                        job.model = Some(m.to_string());
                                    }
                                }

                                let in_tok = usage
                                    .get("input_tokens")
                                    .or_else(|| usage.get("inputTokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                let out_tok = usage
                                    .get("output_tokens")
                                    .or_else(|| usage.get("outputTokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                // `cache_read_input_tokens` is what Claude Code's result event
                                // actually calls this, and it dominates the bill on a long run —
                                // without the alias a 227k-token cache read was recorded as 0.
                                let cache_read_tok = usage
                                    .get("cache_read_tokens")
                                    .or_else(|| usage.get("cacheReadTokens"))
                                    .or_else(|| usage.get("cached_input_tokens"))
                                    .or_else(|| usage.get("cache_read_input_tokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                // Likewise `cache_creation_input_tokens` for the write side.
                                let cache_write_tok = usage
                                    .get("cache_write_tokens")
                                    .or_else(|| usage.get("cacheWriteTokens"))
                                    .or_else(|| usage.get("cache_write_input_tokens"))
                                    .or_else(|| usage.get("cache_creation_input_tokens"))
                                    .and_then(|n| n.as_i64())
                                    .unwrap_or(0);

                                let reasoning_tok = usage
                                    .get("reasoning_tokens")
                                    .or_else(|| usage.get("reasoningTokens"))
                                    .or_else(|| usage.get("reasoning_output_tokens"))
                                    .and_then(|n| n.as_i64());

                                let total_tok = in_tok + out_tok;

                                job.input_tokens = Some(in_tok);
                                job.output_tokens = Some(out_tok);
                                job.cache_read_tokens = Some(cache_read_tok);
                                job.cache_write_tokens = Some(cache_write_tok);
                                if reasoning_tok.is_some() {
                                    job.reasoning_tokens = reasoning_tok;
                                }
                                job.tokens = Some(total_tok);

                                // `total_cost_usd` is the field Claude Code reports, and it is the
                                // agent's own figure — preferred over our estimate, which cannot know
                                // the caller's plan or tier.
                                //
                                // `usage.cost_usd` is the alias that matters most in practice, and it
                                // was the one missing. This loop reads `.eventwire.jsonl` in
                                // preference to `.raw.jsonl`, and the two files spell the figure
                                // differently: the raw frame carries a top-level `total_cost_usd`,
                                // which the chain below already caught, but the normalized eventwire
                                // frame the loop actually reaches carries `usage.cost_usd` beside
                                // `usage.cost_source: "agent"`. So the chain missed every real run --
                                // job 00012 reports `usage.cost_usd = 1.2584212500000005` and was
                                // still recorded as `estimated`, and `CostSource = 'agent'` appeared
                                // on no row in the database at all. Every job was billed at our guess
                                // while the exact figure sat one key away.
                                let provider_cost = usage
                                    .get("cost")
                                    .or_else(|| v.get("cost"))
                                    .or_else(|| v.get("total_cost"))
                                    .or_else(|| v.get("total_cost_usd"))
                                    .or_else(|| usage.get("total_cost_usd"))
                                    .or_else(|| usage.get("cost_usd"))
                                    .and_then(|c| c.as_f64());

                                if let Some(cost) = provider_cost {
                                    job.cost = Some(cost);
                                    job.cost_source = Some("agent".to_string());
                                } else if job.cost.is_none() {
                                    let default_model =
                                        crate::agents::catalog::default_model_for(&job.provider);
                                    let model_name = job
                                        .model
                                        .clone()
                                        .or(default_model)
                                        .unwrap_or_else(|| "claude-3-5-sonnet".to_string());
                                    if job.model.is_none() {
                                        job.model = Some(model_name.clone());
                                    }
                                    if let Some(calculated) =
                                        crate::agents::pricing::try_calculate_cost(
                                            &model_name,
                                            in_tok,
                                            out_tok,
                                            cache_read_tok,
                                            cache_write_tok,
                                        )
                                    {
                                        job.cost = Some(calculated);
                                        job.cost_source = Some("estimated".to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // `job.cost` stays an Option all the way to the row: a subscription-plan run reports tokens and
    // no charge, and writing 0.0 would make it read as free. Tokens is NOT NULL in both schemas, so
    // that one does get a default.
    let tokens = job.tokens.unwrap_or(0);

    if job.tokens.is_some() || job.cost.is_some() {
        if let Some(pid) = resolve_numerical_plan_id(job) {
            let db_path = crate::config::get_database_path(tendril_home);
            if let Ok(conn) = open_database(&db_path) {
                // One query gives both the plan's existence and its folder.
                let folder_path: Option<String> = conn
                    .query_row(
                        "SELECT FolderPath FROM Plans WHERE Id = ?1",
                        rusqlite::params![pid],
                        |row| row.get(0),
                    )
                    .ok();

                if let Some(folder_path) = folder_path {
                    let log_timestamp = extracted_timestamp
                        .or_else(|| job.completed_at.map(|dt| dt.to_rfc3339()))
                        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

                    let entry = crate::db::costs::CostEntry {
                        promptware: job.job_type.clone(),
                        tokens,
                        cost: job.cost,
                        model: job.model.clone(),
                        cost_source: job.cost_source.clone(),
                        agent: Some(job.provider.clone()),
                        log_timestamp: Some(log_timestamp.clone()),
                    };

                    // costs.csv is the durable record shared with the original app; the table is a
                    // projection of it. Appending and then reconciling is what keeps both apps
                    // idempotent with respect to each other. A cost-recording failure must never
                    // fail the job, hence warn-and-continue throughout.
                    let folder = std::path::Path::new(&folder_path);
                    if folder.is_dir() {
                        if let Err(e) = crate::plans::costs_csv::append_cost(folder, &entry) {
                            tracing::warn!(
                                "Failed to append cost row to costs.csv for plan {}: {}",
                                pid,
                                e
                            );
                        }
                        if let Err(e) = crate::plans::costs_csv::reconcile_plan_costs(
                            &conn,
                            folder,
                            pid,
                            Some(&log_timestamp),
                        ) {
                            tracing::warn!("Failed to reconcile costs for plan {}: {}", pid, e);
                        }
                    } else if let Err(e) = crate::db::costs::insert_cost_entry(&conn, pid, &entry) {
                        // No plan folder on disk: record the row directly rather than losing it.
                        tracing::warn!("Failed to insert cost record for plan {}: {}", pid, e);
                    }
                }
            }
        }
    }
}

/// Emits the completion events for a finished job: `job_completed` always, plus `plan_created` or
/// `pr_created` for the job type that produced one.
///
/// Returns immediately in a process with no client installed, which is every CLI invocation — and in
/// particular does no config I/O there, since `plan_created` is the only event needing the project's
/// stack hash and it would otherwise read `config.yaml` on every job completion.
pub(super) fn track_job_completion(tendril_home: &Path, job: &JobItem, deliverable_present: bool) {
    use crate::telemetry::{JobCompletedContext, PlanCreatedContext, PrCreatedContext};

    let Some(telemetry) = crate::telemetry::tracker() else {
        return;
    };

    let plan_id = telemetry_plan_id(job);
    let agent = non_empty(&job.provider);

    telemetry.track_job_completed(&JobCompletedContext {
        job_type: job.job_type.clone(),
        status: job.status.as_str().to_string(),
        duration_seconds: job.duration_seconds,
        agent: agent.clone(),
        plan_id: plan_id.clone(),
    });

    if job.status != JobStatus::Completed {
        return;
    }

    match job.job_type.as_str() {
        // A CreatePlan that produced no revision is not a plan; `verify_deliverable` has already
        // demoted it to `Failed`, and the `deliverable_present` check keeps the event honest if that
        // ever stops being true.
        "CreatePlan" if deliverable_present => {
            let plan_folder = PathBuf::from(&job.plan_file);
            let Ok((plan, _)) = read_plan_yaml(&plan_folder) else {
                return;
            };
            telemetry.track_plan_created(&PlanCreatedContext {
                level: plan.level.clone(),
                duration_seconds: job.duration_seconds,
                agent,
                stack_hash: project_stack_hash(tendril_home, &plan.project),
                plan_id,
            });
        }
        "CreatePr" => telemetry.track_pr_created(&PrCreatedContext {
            duration_seconds: job.duration_seconds,
            agent,
            plan_id,
        }),
        _ => {}
    }
}

/// A project's stack descriptor hash, or `None` for one that has not been analyzed. Carries no names,
/// paths or free text by construction — see `docs/TELEMETRY.md`.
fn project_stack_hash(tendril_home: &Path, project_name: &str) -> Option<String> {
    let config_path = crate::config::get_config_path(tendril_home);
    let settings = crate::config::load_config(&config_path).ok()?;
    settings
        .projects
        .iter()
        .find(|p| p.name == project_name)
        .and_then(|p| p.stack_hash.clone())
}
