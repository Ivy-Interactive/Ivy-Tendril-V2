use crate::error::Result;
use crate::git::github::{block_on_gh, fetch_pr_status, PrInfo};
use crate::models::{canonical_pr_url, PrState};
use crate::plans::reader::read_plan_yaml;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct PlanDoctorIssue {
    pub plan_folder: String,
    pub severity: String, // "Error", "Warning"
    pub message: String,
}

pub fn check_plan_health(plan_folder: &Path) -> Vec<PlanDoctorIssue> {
    let mut issues = Vec::new();
    let folder_name = plan_folder
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let yaml_path = plan_folder.join("plan.yaml");
    if !yaml_path.exists() {
        issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Error".to_string(),
            message: "Missing plan.yaml".to_string(),
        });
        return issues;
    }

    let (plan, raw) = match read_plan_yaml(plan_folder) {
        Ok((p, r)) => (p, r),
        Err(e) => {
            issues.push(PlanDoctorIssue {
                plan_folder: folder_name.clone(),
                severity: "Error".to_string(),
                message: format!("Invalid plan.yaml: {}", e),
            });
            return issues;
        }
    };

    let schema_ver = crate::plans::migrations::PlanSchemaVersion::read(&raw);
    if schema_ver < crate::models::CURRENT_SCHEMA_VERSION
        && !plan.state.eq_ignore_ascii_case("Completed")
        && !plan.state.eq_ignore_ascii_case("Skipped")
    {
        issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Warning".to_string(),
            message: format!(
                "Outdated schema version {} (current is {})",
                schema_ver,
                crate::models::CURRENT_SCHEMA_VERSION
            ),
        });
    }

    if plan.title.trim().is_empty() {
        issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Warning".to_string(),
            message: "Plan has empty title".to_string(),
        });
    }

    let rev_dir = plan_folder.join("Revisions");
    if !rev_dir.exists() {
        issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Warning".to_string(),
            message: "Missing Revisions directory".to_string(),
        });
    }

    // A plan's `repos` are consumed verbatim: `ExecutePlan` creates one worktree per entry, so a path
    // that is not there is a plan that cannot run — an Error, not a note. Without this,
    // `tendril plan validate` printed "Plan is valid." for a plan pointing at a directory that does
    // not exist, which is a failure to *detect* rather than only a failure to signal.
    //
    // Completed and Skipped plans are exempt, as they are for the schema check above: they are
    // archives, they will never be executed again, and a repository that has since been moved or
    // deleted must not make an operator's whole history unhealthy.
    let archived =
        plan.state.eq_ignore_ascii_case("Completed") || plan.state.eq_ignore_ascii_case("Skipped");
    if !archived {
        for repo in &plan.repos {
            if repo.trim().is_empty() {
                issues.push(PlanDoctorIssue {
                    plan_folder: folder_name.clone(),
                    severity: "Error".to_string(),
                    message: "Empty repository path in repos".to_string(),
                });
            } else if !Path::new(repo.trim()).is_dir() {
                issues.push(PlanDoctorIssue {
                    plan_folder: folder_name.clone(),
                    severity: "Error".to_string(),
                    message: format!("Repository path does not exist: {}", repo.trim()),
                });
            }
        }
    }

    issues
}

pub fn check_all_plans_health(plans_dir: &Path) -> Result<Vec<PlanDoctorIssue>> {
    let mut all_issues = Vec::new();

    if plans_dir.exists() {
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let issues = check_plan_health(&entry.path());
                all_issues.extend(issues);
            }
        }
    }

    Ok(all_issues)
}

// ---------------------------------------------------------------------------
// Pull request health
// ---------------------------------------------------------------------------

/// Resolves one PR URL. Injectable so the check can be tested without `gh` or the network.
pub type PrHeadResolver<'a> = &'a dyn Fn(&str) -> Result<PrInfo>;

/// Checks every PR recorded on every plan against GitHub.
///
/// Deliberately **not** part of [`check_all_plans_health`]: that runs on every `tendril plan doctor`
/// and must stay offline and free. This one is opt-in (`--prs`) because it costs one `gh` call per
/// distinct PR.
///
/// Resolution is per-URL rather than through `gh pr list --limit 100`. On a busy repository that
/// window omits most PRs, and anything missing from it would be reported as phantom.
pub fn check_pr_health(plans_dir: &Path) -> Result<Vec<PlanDoctorIssue>> {
    check_pr_health_with(plans_dir, &resolve_pr_head_via_gh)
}

/// [`check_pr_health`] with an injectable resolver.
pub fn check_pr_health_with(
    plans_dir: &Path,
    resolve: PrHeadResolver,
) -> Result<Vec<PlanDoctorIssue>> {
    check_pr_health_with_progress(plans_dir, resolve, &|_| {})
}

/// [`check_pr_health_with`] plus a callback fired once with the number of PRs about to be resolved,
/// so a long pass is not silent on the CLI.
pub fn check_pr_health_with_progress(
    plans_dir: &Path,
    resolve: PrHeadResolver,
    on_begin: &dyn Fn(usize),
) -> Result<Vec<PlanDoctorIssue>> {
    let mut issues = Vec::new();
    let mut plans: Vec<(String, String, Vec<String>)> = Vec::new(); // folder, state, canonical URLs
                                                                    // Canonical URL -> the plan folders that record it, for the cross-plan duplicate check.
    let mut owners: BTreeMap<String, Vec<String>> = BTreeMap::new();

    if !plans_dir.exists() {
        return Ok(issues);
    }

    for entry in std::fs::read_dir(plans_dir)?.flatten() {
        let folder = entry.path();
        if !folder.is_dir() || !folder.join("plan.yaml").exists() {
            continue;
        }
        let name = folder
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let Ok((plan, _)) = read_plan_yaml(&folder) else {
            continue;
        };

        let mut urls = Vec::new();
        for raw in &plan.prs {
            match canonical_pr_url(raw) {
                Some(key) => {
                    if !urls.contains(&key) {
                        urls.push(key.clone());
                    }
                    let recorders = owners.entry(key).or_default();
                    if !recorders.contains(&name) {
                        recorders.push(name.clone());
                    }
                }
                None => issues.push(PlanDoctorIssue {
                    plan_folder: name.clone(),
                    severity: "Warning".to_string(),
                    message: format!(
                        "Malformed PR URL '{}' (expected https://github.com/{{owner}}/{{repo}}/pull/{{n}})",
                        raw
                    ),
                }),
            }
        }
        if !urls.is_empty() {
            plans.push((name, plan.state.clone(), urls));
        }
    }

    on_begin(owners.len());

    // One resolution per distinct URL, shared by every plan that records it.
    let mut resolved: BTreeMap<String, std::result::Result<PrInfo, String>> = BTreeMap::new();
    for url in owners.keys() {
        let outcome = resolve(url).map_err(|e| e.to_string());
        resolved.insert(url.clone(), outcome);
    }

    for (folder, state, urls) in &plans {
        for url in urls {
            if let Some(others) = owners.get(url) {
                for other in others.iter().filter(|o| *o != folder) {
                    issues.push(PlanDoctorIssue {
                        plan_folder: folder.clone(),
                        severity: "Warning".to_string(),
                        message: format!("PR {} is also recorded on plan {}", url, other),
                    });
                }
            }

            match resolved.get(url) {
                Some(Ok(info)) => {
                    let terminal = state.eq_ignore_ascii_case("Completed")
                        || state.eq_ignore_ascii_case("Skipped");
                    if info.status == PrState::Merged && !terminal {
                        issues.push(PlanDoctorIssue {
                            plan_folder: folder.clone(),
                            severity: "Warning".to_string(),
                            message: format!("PR {} is merged but plan state is '{}'", url, state),
                        });
                    }
                }
                Some(Err(err)) if looks_unresolvable(err) => issues.push(PlanDoctorIssue {
                    plan_folder: folder.clone(),
                    severity: "Error".to_string(),
                    message: format!("PR {} is recorded but no longer resolvable on GitHub", url),
                }),
                // Auth, network, gh-not-installed: a Warning, never an Error. An offline run must not
                // report every healthy PR as unresolvable.
                Some(Err(err)) => issues.push(PlanDoctorIssue {
                    plan_folder: folder.clone(),
                    severity: "Warning".to_string(),
                    message: format!("Could not verify PR {}: {}", url, err),
                }),
                None => {}
            }
        }
    }

    Ok(issues)
}

/// The production [`PrHeadResolver`].
pub fn resolve_pr_head_via_gh(pr_url: &str) -> Result<PrInfo> {
    block_on_gh(fetch_pr_status(pr_url))
}

/// Whether a `gh` failure means "this PR does not exist" as opposed to "GitHub could not be reached".
fn looks_unresolvable(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("no pull requests found")
        || lower.contains("could not resolve to a pullrequest")
        || lower.contains("404")
        || lower.contains("not found")
}
