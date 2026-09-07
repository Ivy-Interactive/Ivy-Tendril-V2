use std::collections::HashSet;
use std::path::Path;
use tendril_core::config::{
    expand_variables, get_config_path, get_database_path, get_plans_dir, load_config,
};
use tendril_core::db::open_database;

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

pub fn handle_doctor(tendril_home: &Path) -> anyhow::Result<()> {
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
        Ok(_) => println!(
            "[OK] Database accessible and migrated: {}",
            db_path.display()
        ),
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
