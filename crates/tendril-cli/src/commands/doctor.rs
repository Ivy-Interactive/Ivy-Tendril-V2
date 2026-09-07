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

                    for r in &project.repos {
                        let expanded = expand_variables(&r.path, &tendril_home.to_string_lossy());
                        let resolved_suffix = if expanded != r.path {
                            format!(" (resolved: {})", expanded)
                        } else {
                            String::new()
                        };
                        match classify_repo_path(Path::new(&expanded)) {
                            RepoPathStatus::Missing => println!(
                                "[WARN] Project '{}' repository path does not exist: {}{}",
                                project.name, r.path, resolved_suffix
                            ),
                            RepoPathStatus::NotADirectory => println!(
                                "[WARN] Project '{}' repository path is not a directory: {}{}",
                                project.name, r.path, resolved_suffix
                            ),
                            RepoPathStatus::NotAGitRepo => println!(
                                "[WARN] Project '{}' repository path is not a git repository (no .git found): {}{}",
                                project.name, r.path, resolved_suffix
                            ),
                            RepoPathStatus::Ok => {}
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
}
