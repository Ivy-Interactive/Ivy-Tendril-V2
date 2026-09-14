use std::path::Path;
use std::time::Duration;

pub async fn handle_models(refresh: bool, tendril_home: &Path) -> anyhow::Result<()> {
    if refresh {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;
        match tendril_core::agents::model_cache::fetch_live_models(&client, tendril_home).await {
            Ok(count) => println!("Refreshed models.dev cache: {count} models\n"),
            Err(err) => println!("Failed to refresh from models.dev: {err}\n"),
        }
    } else if let Ok(cached) = tendril_core::agents::model_cache::load_disk_cache(tendril_home) {
        if !cached.is_empty() {
            tendril_core::agents::model_specs::register_dynamic_specs(cached);
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

    let dynamic_count = tendril_core::agents::model_specs::dynamic_specs_count();
    if dynamic_count > 0 {
        println!("\nSource: models.dev cache ({dynamic_count} models)");
    } else {
        println!("\nSource: static ModelSpecs offline fallback");
    }

    Ok(())
}
