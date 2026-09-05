use std::path::Path;
use tendril_core::config::{get_database_path, get_plans_dir, load_config, get_config_path};
use tendril_core::db::open_database;

pub fn handle_doctor(tendril_home: &Path) -> anyhow::Result<()> {
    println!("Checking Tendril system health...");

    println!("[OK] Tendril Home: {}", tendril_home.display());

    let cfg_path = get_config_path(tendril_home);
    if cfg_path.exists() {
        match load_config(&cfg_path) {
            Ok(_) => println!("[OK] Config file valid: {}", cfg_path.display()),
            Err(e) => println!("[FAIL] Config file error: {}", e),
        }
    } else {
        println!("[WARN] Config file does not exist: {}", cfg_path.display());
    }

    let db_path = get_database_path(tendril_home);
    match open_database(&db_path) {
        Ok(_) => println!("[OK] Database accessible and migrated: {}", db_path.display()),
        Err(e) => println!("[FAIL] Database error: {}", e),
    }

    let plans_dir = get_plans_dir(tendril_home);
    if plans_dir.exists() {
        println!("[OK] Plans directory: {}", plans_dir.display());
    } else {
        println!("[WARN] Plans directory not found: {}", plans_dir.display());
    }

    // Git check
    match std::process::Command::new("git").arg("--version").output() {
        Ok(out) => println!("[OK] Git installed: {}", String::from_utf8_lossy(&out.stdout).trim()),
        Err(_) => println!("[FAIL] Git not found on PATH"),
    }

    // GitHub CLI check
    match std::process::Command::new("gh").arg("--version").output() {
        Ok(out) => println!("[OK] GitHub CLI installed: {}", String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("")),
        Err(_) => println!("[WARN] GitHub CLI ('gh') not found on PATH"),
    }

    Ok(())
}
