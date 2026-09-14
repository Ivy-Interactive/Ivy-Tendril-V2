pub fn handle_models() -> anyhow::Result<()> {
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
    Ok(())
}
