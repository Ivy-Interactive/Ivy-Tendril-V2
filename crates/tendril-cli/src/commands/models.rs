use tendril_core::agents::pricing::get_model_price;

pub fn handle_models() -> anyhow::Result<()> {
    let models = [
        "claude-3-7-sonnet",
        "claude-3-5-sonnet",
        "claude-3-5-haiku",
        "gpt-4o",
        "gpt-4o-mini",
        "gemini-2.5-pro",
        "gemini-2.5-flash",
    ];

    println!(
        "{:<20} {:<12} {:<12} {:<12} {:<12}",
        "MODEL", "INPUT/1M", "OUTPUT/1M", "CACHE READ", "CACHE WRITE"
    );
    println!("{}", "-".repeat(70));
    for m in models {
        let p = get_model_price(m);
        println!(
            "{:<20} ${:<11.2} ${:<11.2} ${:<11.2} ${:<11.2}",
            m,
            p.input_per_million,
            p.output_per_million,
            p.cache_read_per_million,
            p.cache_write_per_million
        );
    }
    Ok(())
}
