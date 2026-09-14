use std::path::Path;
use std::time::Duration;
use tendril_core::agents::model_cache::{self, CacheFreshness};
use tendril_core::config::{get_config_path, load_config};

fn format_age(age_days: Option<i64>) -> String {
    match age_days {
        Some(0) => "today".to_string(),
        Some(1) => "1 day ago".to_string(),
        Some(d) => format!("{d} days ago"),
        None => "no recorded fetch time".to_string(),
    }
}

pub async fn handle_models(refresh: bool, tendril_home: &Path) -> anyhow::Result<()> {
    let settings = load_config(&get_config_path(tendril_home)).unwrap_or_default();
    let warn_age_days = settings.model_cache_warn_age_days;
    let max_age_days = settings.model_cache_max_age_days;

    let mut source_line = "Source: static ModelSpecs offline fallback".to_string();

    if refresh {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;
        match model_cache::fetch_live_models(&client, tendril_home).await {
            Ok(count) => {
                println!("Refreshed models.dev cache: {count} models\n");
                source_line = format!("Source: models.dev cache ({count} models, fetched today)");
            }
            Err(err) => println!("Failed to refresh from models.dev: {err}\n"),
        }
    } else if let Ok(catalog) = model_cache::load_disk_cache(tendril_home) {
        if !catalog.is_empty() {
            let count = catalog.specs.len();
            match model_cache::classify(&catalog, warn_age_days, max_age_days) {
                CacheFreshness::Fresh { age_days } => {
                    tendril_core::agents::model_specs::register_dynamic_specs(catalog.specs);
                    source_line = format!(
                        "Source: models.dev cache ({count} models, fetched {})",
                        format_age(age_days)
                    );
                }
                CacheFreshness::Stale { age_days } => {
                    tendril_core::agents::model_specs::register_dynamic_specs(catalog.specs);
                    let age = format_age(age_days);
                    source_line =
                        format!("Source: models.dev cache ({count} models, fetched {age})");
                    eprintln!("warning: cache is {age}; run 'tendril models --refresh' to update");
                }
                CacheFreshness::Expired { age_days } => {
                    let age = age_days.map_or("no recorded fetch time".to_string(), |d| {
                        format!("{d} days old")
                    });
                    source_line =
                        format!("Source: static ModelSpecs offline fallback (models.dev cache ignored: {age})");
                }
            }
        }
    }

    println!(
        "{:<28} {:<12} {:<12} {:<12} {:<12} {:<12} {:<12}",
        "MODEL", "CONTEXT", "MAX OUTPUT", "INPUT/1M", "OUTPUT/1M", "CACHE READ", "CACHE WRITE"
    );
    println!("{}", "-".repeat(104));
    for spec in tendril_core::agents::model_specs::all_specs() {
        println!(
            "{:<28} {:<12} {:<12} ${:<11.2} ${:<11.2} ${:<11.2} ${:<11.2}",
            spec.model_id,
            spec.context_window,
            spec.max_output_tokens,
            spec.input_per_million,
            spec.output_per_million,
            spec.cache_read_per_million,
            spec.cache_write_per_million
        );
    }

    println!("\n{source_line}");

    Ok(())
}
