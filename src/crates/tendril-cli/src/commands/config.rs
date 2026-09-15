use clap::Subcommand;
use std::path::Path;
use tendril_core::config::{get_config_path, load_config, save_config};

#[derive(Subcommand)]
pub enum ConfigCommands {
    #[command(about = "Print a top-level config value")]
    Get { key: String },

    #[command(about = "Set a top-level config value")]
    Set { key: String, value: String },
}

/// Lowercased names of every scalar/JSON-ish `TendrilSettings` field that `config get`/`config
/// set` explicitly handle below. Used to strip a stale `extra` entry when (re-)setting one of
/// these fields, so a config corrupted by a pre-fix `set` doesn't stay corrupted.
const MODELED_PRIMITIVE_KEYS: &[&str] = &[
    "codingagent",
    "jobtimeout",
    "staleoutputtimeout",
    "gittimeout",
    "daemonrequesttimeout",
    "maxconcurrentjobs",
    "plantemplate",
    "planfolder",
    "promptwareoverlay",
    "telemetry",
    "beta",
    "desktopnotifications",
    "theme",
    "worktreereaperinterval",
    "worktreereapergrace",
    "worktreebranchdeletemode",
    "enrichmodels",
    "modelenrichmentintervalhours",
    "modelcachewarnagedays",
    "modelcachemaxagedays",
    "llm",
];

/// Lowercased names of `TendrilSettings` fields that are modeled but structured (lists/maps of
/// nested objects), so neither `config get` nor `config set` supports them here — they are
/// managed by dedicated commands (`project`, `verification`, ...) or by editing `config.yaml`
/// directly. Listed anyway so a typo'd or forgotten key name fails loudly instead of silently
/// landing in `extra` and later corrupting the file.
const STRUCTURED_KEYS: &[&str] = &[
    "projects",
    "verifications",
    "levels",
    "onboarding",
    "codingagents",
    "promptwares",
    "inbox",
];

fn parse_bool(value: &str) -> anyhow::Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" => Ok(true),
        "false" => Ok(false),
        other => anyhow::bail!("Expected 'true' or 'false', got '{}'", other),
    }
}

pub fn handle_config_command(cmd: ConfigCommands, tendril_home: &Path) -> anyhow::Result<()> {
    let cfg_path = get_config_path(tendril_home);
    let mut settings = load_config(&cfg_path)?;

    match cmd {
        ConfigCommands::Get { key } => {
            let key_lower = key.to_ascii_lowercase();
            let val = match key_lower.as_str() {
                "codingagent" => settings.coding_agent,
                "jobtimeout" => settings.job_timeout.to_string(),
                "staleoutputtimeout" => settings.stale_output_timeout.to_string(),
                "gittimeout" => settings.git_timeout.to_string(),
                "daemonrequesttimeout" => settings.daemon_request_timeout.to_string(),
                "maxconcurrentjobs" => settings.max_concurrent_jobs.to_string(),
                "plantemplate" => settings.plan_template,
                "planfolder" => settings.plan_folder.unwrap_or_default(),
                "promptwareoverlay" => settings.promptware_overlay.unwrap_or_default(),
                "telemetry" => match settings.telemetry {
                    Some(true) => "true".to_string(),
                    Some(false) => "false".to_string(),
                    None => String::new(),
                },
                "beta" => settings.beta.to_string(),
                "desktopnotifications" => settings.desktop_notifications.to_string(),
                "theme" => settings.theme,
                "worktreereaperinterval" => settings.worktree_reaper_interval.to_string(),
                "worktreereapergrace" => settings.worktree_reaper_grace.to_string(),
                "worktreebranchdeletemode" => settings.worktree_branch_delete_mode,
                "enrichmodels" => settings.enrich_models.to_string(),
                "modelenrichmentintervalhours" => {
                    settings.model_enrichment_interval_hours.to_string()
                }
                "modelcachewarnagedays" => settings.model_cache_warn_age_days.to_string(),
                "modelcachemaxagedays" => settings.model_cache_max_age_days.to_string(),
                "llm" => match &settings.llm {
                    Some(llm) => serde_json::to_string(llm)?,
                    None => String::new(),
                },
                _ if STRUCTURED_KEYS.contains(&key_lower.as_str()) => {
                    anyhow::bail!(
                        "'{}' is a structured config key; read it directly from config.yaml instead of 'config get'",
                        key
                    )
                }
                _ => {
                    if let Some((_, v)) = settings
                        .extra
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case(&key))
                    {
                        match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        }
                    } else {
                        anyhow::bail!("Unknown config key: {}", key)
                    }
                }
            };
            println!("{}", val);
        }
        ConfigCommands::Set { key, value } => {
            let key_lower = key.to_ascii_lowercase();

            // A pre-fix `set` on any of these keys could have inserted them into `extra` instead
            // of the modeled field. Strip that stale entry now so `save_config` never emits the
            // key twice, regardless of what state the file was already in.
            if MODELED_PRIMITIVE_KEYS.contains(&key_lower.as_str()) {
                settings.extra.retain(|k, _| !k.eq_ignore_ascii_case(&key));
            }

            match key_lower.as_str() {
                "codingagent" => settings.coding_agent = value,
                "jobtimeout" => settings.job_timeout = value.parse()?,
                "staleoutputtimeout" => settings.stale_output_timeout = value.parse()?,
                "gittimeout" => settings.git_timeout = value.parse()?,
                "daemonrequesttimeout" => settings.daemon_request_timeout = value.parse()?,
                "maxconcurrentjobs" => settings.max_concurrent_jobs = value.parse()?,
                "plantemplate" => settings.plan_template = value,
                "planfolder" => {
                    settings.plan_folder = if value.trim().is_empty() {
                        None
                    } else {
                        Some(value)
                    }
                }
                "promptwareoverlay" => {
                    settings.promptware_overlay = if value.trim().is_empty() {
                        None
                    } else {
                        Some(value)
                    }
                }
                "telemetry" => {
                    settings.telemetry = if value.trim().is_empty() {
                        None
                    } else {
                        Some(parse_bool(&value)?)
                    }
                }
                "beta" => settings.beta = parse_bool(&value)?,
                "desktopnotifications" => settings.desktop_notifications = parse_bool(&value)?,
                "theme" => settings.theme = value,
                "worktreereaperinterval" => settings.worktree_reaper_interval = value.parse()?,
                "worktreereapergrace" => settings.worktree_reaper_grace = value.parse()?,
                "worktreebranchdeletemode" => settings.worktree_branch_delete_mode = value,
                "enrichmodels" => settings.enrich_models = parse_bool(&value)?,
                "modelenrichmentintervalhours" => {
                    settings.model_enrichment_interval_hours = value.parse()?
                }
                "modelcachewarnagedays" => settings.model_cache_warn_age_days = value.parse()?,
                "modelcachemaxagedays" => settings.model_cache_max_age_days = value.parse()?,
                "llm" => {
                    // Merge rather than replace, so `config set llm '{"model":"gpt-4"}'` doesn't
                    // wipe an already-configured endpoint/apiKey.
                    let mut merged =
                        serde_json::to_value(settings.llm.clone().unwrap_or_default())?;
                    let incoming: serde_json::Value =
                        serde_json::from_str(&value).map_err(|e| {
                            anyhow::anyhow!(
                                "llm value must be valid JSON, e.g. '{{\"model\":\"gpt-4\"}}': {}",
                                e
                            )
                        })?;
                    match (merged.as_object_mut(), incoming.as_object()) {
                        (Some(merged_map), Some(incoming_map)) => {
                            for (k, v) in incoming_map {
                                merged_map.insert(k.clone(), v.clone());
                            }
                        }
                        _ => merged = incoming,
                    }
                    settings.llm = Some(serde_json::from_value(merged)?);
                }
                _ if STRUCTURED_KEYS.contains(&key_lower.as_str()) => {
                    anyhow::bail!(
                        "'{}' is a structured config key and cannot be set via 'config set'; use the dedicated command for it or edit config.yaml directly",
                        key
                    )
                }
                _ => {
                    if let Some(existing_key) = settings
                        .extra
                        .keys()
                        .find(|k| k.eq_ignore_ascii_case(&key))
                        .cloned()
                    {
                        let parsed: serde_json::Value = serde_json::from_str(&value)
                            .unwrap_or(serde_json::Value::String(value));
                        settings.extra.insert(existing_key, parsed);
                    } else {
                        let parsed: serde_json::Value = serde_json::from_str(&value)
                            .unwrap_or(serde_json::Value::String(value));
                        settings.extra.insert(key, parsed);
                    }
                }
            };
            save_config(&cfg_path, &settings)?;
            println!("Config updated.");
        }
    }

    Ok(())
}
