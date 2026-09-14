use chrono::{DateTime, Utc};
use std::collections::HashSet;
use std::path::Path;
use tendril_core::config::{
    expand_variables, get_config_path, get_database_path, get_plans_dir, load_config,
    TendrilSettings,
};
use tendril_core::db::{
    check_plan_search, get_last_sync_time, open_database, rebuild_search_index, PlanSearchHealth,
};
use tendril_core::promptware::{
    configured_overlay_root, overlay_promptware_names, read_provenance, resolve_overlay,
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

/// Reports where the promptware overlay is, whether it resolves, and whether what is deployed still
/// matches it. Split out from [`handle_doctor`] so the wording is unit-testable, the way
/// [`repo_path_warning`] and [`plan_search_lines`] already are.
///
/// A configured-but-missing overlay is the failure mode the original mechanism could not report at
/// all: it had no notion of an overlay path, only a git-tracked deploy target.
pub(crate) fn overlay_doctor_lines(
    tendril_home: &Path,
    settings: &TendrilSettings,
) -> Vec<String> {
    let Some(configured) = configured_overlay_root(tendril_home, settings) else {
        return vec!["[OK] Promptware overlay: not configured".to_string()];
    };

    let Some(overlay) = resolve_overlay(tendril_home, settings) else {
        return vec![format!(
            "[WARN] Promptware overlay configured but not found: {}",
            configured.display()
        )];
    };

    let overridden = overlay_promptware_names(&overlay.root).len();
    let mut detail = Vec::new();
    if let Some(version) = &overlay.version {
        detail.push(format!(".version {}", version));
    }
    detail.push(format!(
        "{} promptware{} overridden",
        overridden,
        if overridden == 1 { "" } else { "s" }
    ));

    let mut lines = vec![format!(
        "[OK] Promptware overlay: {} ({})",
        overlay.root.display(),
        detail.join(", ")
    )];

    match read_provenance(&tendril_home.join("Promptwares")) {
        None => lines.push(
            "[WARN] Promptware overlay has not been deployed yet — run 'tendril promptware deploy'"
                .to_string(),
        ),
        Some(deployed) if deployed.overlay_root.as_deref() != Some(overlay.root.as_path()) => {
            lines.push(format!(
                "[WARN] Promptware overlay root changed (deployed {}, configured {}) — run 'tendril promptware deploy'",
                deployed
                    .overlay_root
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| "none".to_string()),
                overlay.root.display()
            ));
        }
        Some(deployed) if deployed.overlay_version != overlay.version => {
            lines.push(format!(
                "[WARN] Promptware overlay is stale (deployed .version {}, overlay .version {}) — run 'tendril promptware deploy'",
                deployed.overlay_version.as_deref().unwrap_or("none"),
                overlay.version.as_deref().unwrap_or("none")
            ));
        }
        Some(_) => {}
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

    for line in overlay_doctor_lines(tendril_home, &load_config(&cfg_path).unwrap_or_default()) {
        println!("{}", line);
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

    /// A `TENDRIL_HOME` plus an overlay root beside it, so overlay wording can be asserted without a
    /// live installation.
    struct OverlayFixture {
        root: std::path::PathBuf,
        home: std::path::PathBuf,
        overlay: std::path::PathBuf,
    }

    impl OverlayFixture {
        fn new() -> Self {
            let root = scratch_dir("tendril-doctor-overlay");
            let home = root.join("home");
            let overlay = root.join("team").join("Promptwares");
            std::fs::create_dir_all(&home).unwrap();
            std::fs::create_dir_all(overlay.join("CreatePlan")).unwrap();
            std::fs::write(overlay.join("CreatePlan").join("Program.md"), "team plan").unwrap();
            OverlayFixture {
                root,
                home,
                overlay,
            }
        }

        fn settings(&self, overlay: Option<&std::path::Path>) -> TendrilSettings {
            TendrilSettings {
                promptware_overlay: overlay.map(|p| p.to_string_lossy().to_string()),
                ..Default::default()
            }
        }

        /// Deploys into the fixture's home so `read_provenance` has something to compare against.
        fn deploy(&self, overlay: Option<&tendril_core::promptware::OverlayLayer>) {
            let shipped = self.root.join("shipped");
            std::fs::create_dir_all(shipped.join("CreatePlan")).unwrap();
            std::fs::write(shipped.join("CreatePlan").join("Program.md"), "shipped").unwrap();
            tendril_core::promptware::deploy_promptwares(
                &self.home.join("Promptwares"),
                tendril_core::promptware::DeployOptions {
                    shipped_root: Some(&shipped),
                    overlay,
                },
            )
            .unwrap();
        }
    }

    impl Drop for OverlayFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn overlay_doctor_lines_report_not_configured() {
        let fx = OverlayFixture::new();

        let lines = overlay_doctor_lines(&fx.home, &fx.settings(None));

        assert_eq!(lines, vec!["[OK] Promptware overlay: not configured"]);
    }

    #[test]
    fn overlay_doctor_lines_warn_when_configured_but_missing() {
        let fx = OverlayFixture::new();
        let missing = fx.root.join("does-not-exist");

        let lines = overlay_doctor_lines(&fx.home, &fx.settings(Some(&missing)));

        assert_eq!(
            lines,
            vec![format!(
                "[WARN] Promptware overlay configured but not found: {}",
                missing.display()
            )]
        );
    }

    #[test]
    fn overlay_doctor_lines_report_a_healthy_overlay() {
        let fx = OverlayFixture::new();
        std::fs::write(fx.overlay.join(".version"), "1.0.45\n").unwrap();
        let settings = fx.settings(Some(&fx.overlay));
        let overlay = resolve_overlay(&fx.home, &settings).unwrap();
        fx.deploy(Some(&overlay));

        let lines = overlay_doctor_lines(&fx.home, &settings);

        assert_eq!(
            lines,
            vec![format!(
                "[OK] Promptware overlay: {} (.version 1.0.45, 1 promptware overridden)",
                fx.overlay.display()
            )]
        );
    }

    #[test]
    fn overlay_doctor_lines_warn_when_never_deployed() {
        let fx = OverlayFixture::new();
        let settings = fx.settings(Some(&fx.overlay));

        let lines = overlay_doctor_lines(&fx.home, &settings);

        assert!(lines[0].starts_with("[OK] Promptware overlay:"));
        assert_eq!(
            lines[1],
            "[WARN] Promptware overlay has not been deployed yet — run 'tendril promptware deploy'"
        );
    }

    #[test]
    fn overlay_doctor_lines_warn_when_stale() {
        let fx = OverlayFixture::new();
        std::fs::write(fx.overlay.join(".version"), "1.0.44").unwrap();
        let settings = fx.settings(Some(&fx.overlay));
        fx.deploy(Some(&resolve_overlay(&fx.home, &settings).unwrap()));

        // The team bumps its revision; nothing has re-deployed yet.
        std::fs::write(fx.overlay.join(".version"), "1.0.45").unwrap();

        let lines = overlay_doctor_lines(&fx.home, &settings);

        assert_eq!(
            lines[1],
            "[WARN] Promptware overlay is stale (deployed .version 1.0.44, overlay .version 1.0.45) — run 'tendril promptware deploy'"
        );
    }

    #[test]
    fn overlay_doctor_lines_warn_when_the_root_changed() {
        let fx = OverlayFixture::new();
        let settings = fx.settings(Some(&fx.overlay));
        // Deployed shipped-only, then an overlay was configured.
        fx.deploy(None);

        let lines = overlay_doctor_lines(&fx.home, &settings);

        assert_eq!(
            lines[1],
            format!(
                "[WARN] Promptware overlay root changed (deployed none, configured {}) — run 'tendril promptware deploy'",
                fx.overlay.display()
            )
        );
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
