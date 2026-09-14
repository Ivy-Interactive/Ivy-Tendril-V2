use chrono::{DateTime, Utc};
use std::collections::HashSet;
use std::path::Path;
use tendril_core::config::{
    expand_variables, get_config_path, get_database_path, get_plans_dir, load_config,
};
use tendril_core::db::{
    check_plan_search, get_last_sync_time, open_database, rebuild_search_index, PlanSearchHealth,
};

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RepoPathStatus {
    Missing,
    NotADirectory,
    NotAGitRepo,
    Ok,
}

pub(crate) fn classify_repo_path(path: &Path) -> RepoPathStatus {
    if !path.exists() {
        return RepoPathStatus::Missing;
    }
    if !path.is_dir() {
        return RepoPathStatus::NotADirectory;
    }
    if path.join(".git").exists() {
        return RepoPathStatus::Ok;
    }
    if path.join("HEAD").is_file() && path.join("objects").is_dir() && path.join("refs").is_dir() {
        return RepoPathStatus::Ok;
    }
    RepoPathStatus::NotAGitRepo
}

pub(crate) fn repo_path_warning(
    project_name: &str,
    kind: &str,
    raw_path: &str,
    tendril_home: &Path,
) -> Option<String> {
    let expanded = expand_variables(raw_path, &tendril_home.to_string_lossy());
    let resolved_suffix = if expanded != raw_path {
        format!(" (resolved: {})", expanded)
    } else {
        String::new()
    };
    match classify_repo_path(Path::new(&expanded)) {
        RepoPathStatus::Missing => Some(format!(
            "[WARN] Project '{}' {} does not exist: {}{}",
            project_name, kind, raw_path, resolved_suffix
        )),
        RepoPathStatus::NotADirectory => Some(format!(
            "[WARN] Project '{}' {} is not a directory: {}{}",
            project_name, kind, raw_path, resolved_suffix
        )),
        RepoPathStatus::NotAGitRepo => Some(format!(
            "[WARN] Project '{}' {} is not a git repository (no .git found): {}{}",
            project_name, kind, raw_path, resolved_suffix
        )),
        RepoPathStatus::Ok => None,
    }
}

/// Formats the plan-search and sync-bookkeeping health lines. Split out from [`handle_doctor`] so it
/// can be tested without a live `TendrilHome`, the way [`repo_path_warning`] already is.
pub(crate) fn plan_search_lines(
    health: &PlanSearchHealth,
    last_sync: Option<DateTime<Utc>>,
) -> Vec<String> {
    let mut lines = Vec::new();

    if health.index_present {
        lines.push("[OK] Plan search index present".to_string());
    } else {
        lines.push(
            "[WARN] Plan search index missing (run: tendril doctor --rebuild-search-index)"
                .to_string(),
        );
    }

    if !health.missing_triggers.is_empty() {
        lines.push(format!(
            "[WARN] Plan search triggers missing: {} (run: tendril doctor --rebuild-search-index)",
            health.missing_triggers.join(", ")
        ));
    }

    if health.index_present {
        if health.integrity_ok {
            lines.push("[OK] Plan search index integrity verified".to_string());
        } else {
            lines.push(
                "[WARN] Plan search index corrupt (run: tendril doctor --rebuild-search-index)"
                    .to_string(),
            );
        }
    }

    match last_sync {
        Some(time) => lines.push(format!("[OK] Last plan sync: {}", time.to_rfc3339())),
        None => lines.push("[WARN] Plans have never been synced".to_string()),
    }

    lines
}

pub fn handle_doctor(tendril_home: &Path, rebuild_search_index_flag: bool) -> anyhow::Result<()> {
    println!("Checking Tendril system health...");

    println!("[OK] Tendril Home: {}", tendril_home.display());

    let cfg_path = get_config_path(tendril_home);
    if cfg_path.exists() {
        match load_config(&cfg_path) {
            Ok(settings) => {
                println!("[OK] Config file valid: {}", cfg_path.display());
                for project in &settings.projects {
                    for v in &project.verifications {
                        if !settings
                            .verifications
                            .iter()
                            .any(|def| def.name.eq_ignore_ascii_case(&v.name))
                        {
                            println!(
                                "[WARN] Project '{}' references non-existent verification '{}'",
                                project.name, v.name
                            );
                        }
                    }

                    let mut expanded_repo_paths: HashSet<String> = HashSet::new();
                    for r in &project.repos {
                        expanded_repo_paths
                            .insert(expand_variables(&r.path, &tendril_home.to_string_lossy()));
                        if let Some(warning) = repo_path_warning(
                            &project.name,
                            "repository path",
                            &r.path,
                            tendril_home,
                        ) {
                            println!("{}", warning);
                        }
                    }

                    for dep_path in &project.build_dependencies {
                        let expanded_dep =
                            expand_variables(dep_path, &tendril_home.to_string_lossy());
                        if expanded_repo_paths.contains(&expanded_dep) {
                            continue;
                        }
                        if let Some(warning) = repo_path_warning(
                            &project.name,
                            "build dependency path",
                            dep_path,
                            tendril_home,
                        ) {
                            println!("{}", warning);
                        }
                    }
                }
            }
            Err(e) => println!("[FAIL] Config file error: {}", e),
        }
    } else {
        println!("[WARN] Config file does not exist: {}", cfg_path.display());
    }

    let db_path = get_database_path(tendril_home);
    match open_database(&db_path) {
        Ok(conn) => {
            println!(
                "[OK] Database accessible and migrated: {}",
                db_path.display()
            );

            if rebuild_search_index_flag {
                match rebuild_search_index(&conn) {
                    Ok(indexed) => println!("Rebuilt plan search index ({} plans).", indexed),
                    Err(e) => println!("[FAIL] Could not rebuild plan search index: {}", e),
                }
            }

            match check_plan_search(&conn) {
                Ok(health) => {
                    let last_sync = get_last_sync_time(&conn).unwrap_or(None);
                    for line in plan_search_lines(&health, last_sync) {
                        println!("{}", line);
                    }
                }
                Err(e) => println!("[FAIL] Could not inspect plan search index: {}", e),
            }
        }
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
        Ok(out) => println!(
            "[OK] Git installed: {}",
            String::from_utf8_lossy(&out.stdout).trim()
        ),
        Err(_) => println!("[FAIL] Git not found on PATH"),
    }

    // GitHub CLI check
    match std::process::Command::new("gh").arg("--version").output() {
        Ok(out) => println!(
            "[OK] GitHub CLI installed: {}",
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
        ),
        Err(_) => println!("[WARN] GitHub CLI ('gh') not found on PATH"),
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn classify_repo_path_missing() {
        let dir = scratch_dir("tendril-doctor-classify-missing");
        let missing = dir.join("does-not-exist");
        assert_eq!(classify_repo_path(&missing), RepoPathStatus::Missing);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_not_a_directory() {
        let dir = scratch_dir("tendril-doctor-classify-file");
        let file_path = dir.join("some-file.txt");
        std::fs::write(&file_path, "not a repo").unwrap();
        assert_eq!(
            classify_repo_path(&file_path),
            RepoPathStatus::NotADirectory
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_not_a_git_repo() {
        let dir = scratch_dir("tendril-doctor-classify-empty");
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::NotAGitRepo);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_ok_for_git_dir() {
        let dir = scratch_dir("tendril-doctor-classify-git-dir");
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::Ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_ok_for_git_file() {
        let dir = scratch_dir("tendril-doctor-classify-git-file");
        std::fs::write(dir.join(".git"), "gitdir: /somewhere/else").unwrap();
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::Ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_repo_path_ok_for_bare_repo() {
        let dir = scratch_dir("tendril-doctor-classify-bare");
        std::fs::write(dir.join("HEAD"), "ref: refs/heads/main").unwrap();
        std::fs::create_dir_all(dir.join("objects")).unwrap();
        std::fs::create_dir_all(dir.join("refs")).unwrap();
        assert_eq!(classify_repo_path(&dir), RepoPathStatus::Ok);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn repo_path_warning_none_for_valid_repo() {
        let dir = scratch_dir("tendril-doctor-warning-valid");
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        let tendril_home = scratch_dir("tendril-doctor-warning-valid-home");
        assert_eq!(
            repo_path_warning(
                "Proj",
                "repository path",
                &dir.to_string_lossy(),
                &tendril_home
            ),
            None
        );
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&tendril_home);
    }

    #[test]
    fn repo_path_warning_missing_build_dependency() {
        let tendril_home = scratch_dir("tendril-doctor-warning-missing-home");
        let missing = tendril_home.join("does-not-exist");
        let warning = repo_path_warning(
            "Proj",
            "build dependency path",
            &missing.to_string_lossy(),
            &tendril_home,
        )
        .expect("expected a warning");
        assert!(warning.contains("build dependency path"));
        assert!(warning.contains("does not exist"));
        let _ = std::fs::remove_dir_all(&tendril_home);
    }

    #[test]
    fn repo_path_warning_non_git_build_dependency() {
        let dir = scratch_dir("tendril-doctor-warning-non-git");
        let tendril_home = scratch_dir("tendril-doctor-warning-non-git-home");
        let warning = repo_path_warning(
            "Proj",
            "build dependency path",
            &dir.to_string_lossy(),
            &tendril_home,
        )
        .expect("expected a warning");
        assert!(warning.contains("is not a git repository"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&tendril_home);
    }

    fn healthy() -> PlanSearchHealth {
        PlanSearchHealth {
            index_present: true,
            missing_triggers: vec![],
            integrity_ok: true,
        }
    }

    #[test]
    fn plan_search_lines_report_a_healthy_index() {
        let synced = Utc::now();
        let lines = plan_search_lines(&healthy(), Some(synced));

        assert!(lines.iter().any(|l| l == "[OK] Plan search index present"));
        assert!(lines
            .iter()
            .any(|l| l == "[OK] Plan search index integrity verified"));
        assert!(lines
            .iter()
            .any(|l| l == &format!("[OK] Last plan sync: {}", synced.to_rfc3339())));
        assert!(
            !lines.iter().any(|l| l.starts_with("[WARN]")),
            "a healthy index warns about nothing: {:?}",
            lines
        );
    }

    #[test]
    fn plan_search_lines_warn_when_index_is_missing() {
        let health = PlanSearchHealth {
            index_present: false,
            missing_triggers: vec!["plans_fts_update".to_string()],
            integrity_ok: false,
        };
        let lines = plan_search_lines(&health, None);

        assert!(lines
            .iter()
            .any(|l| l.starts_with("[WARN] Plan search index missing")));
        assert!(lines
            .iter()
            .any(|l| l.contains("Plan search triggers missing: plans_fts_update")));
        assert!(lines
            .iter()
            .any(|l| l == "[WARN] Plans have never been synced"));
        // An absent index cannot be integrity-checked, so there is nothing to say about it.
        assert!(!lines.iter().any(|l| l.contains("integrity")));
    }

    #[test]
    fn plan_search_checks_run_against_a_real_database() {
        let dir = scratch_dir("tendril-doctor-search-db");
        let conn = open_database(&dir.join("tendril.db")).expect("open database");

        // The rebuild is what `--rebuild-search-index` calls; an empty Plans table indexes nothing.
        assert_eq!(rebuild_search_index(&conn).expect("rebuild index"), 0);

        let health = check_plan_search(&conn).expect("inspect index");
        assert!(health.index_present);
        assert!(health.missing_triggers.is_empty());
        assert!(health.integrity_ok);

        let lines = plan_search_lines(&health, get_last_sync_time(&conn).expect("read sync time"));
        assert!(lines.iter().any(|l| l == "[OK] Plan search index present"));
        assert!(lines
            .iter()
            .any(|l| l == "[WARN] Plans have never been synced"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_search_lines_warn_when_index_is_corrupt() {
        let health = PlanSearchHealth {
            index_present: true,
            missing_triggers: vec![],
            integrity_ok: false,
        };
        let lines = plan_search_lines(&health, Some(Utc::now()));

        assert!(lines.iter().any(|l| l == "[OK] Plan search index present"));
        assert!(lines
            .iter()
            .any(|l| l.starts_with("[WARN] Plan search index corrupt")));
    }

    #[test]
    fn repo_path_warning_keeps_repository_wording() {
        let tendril_home = scratch_dir("tendril-doctor-warning-wording-home");
        let missing = tendril_home.join("does-not-exist");
        let warning = repo_path_warning(
            "Proj",
            "repository path",
            &missing.to_string_lossy(),
            &tendril_home,
        )
        .expect("expected a warning");
        assert_eq!(
            warning,
            format!(
                "[WARN] Project 'Proj' repository path does not exist: {}",
                missing.to_string_lossy()
            )
        );
        let _ = std::fs::remove_dir_all(&tendril_home);
    }
}
