use crate::error::Result;
use crate::git::github::{block_on_gh, fetch_pr_status, PrInfo};
use crate::models::{canonical_pr_url, PrState};
use crate::plans::orphans::{classify_abandoned_husk, is_plan_folder_under, HuskVerdict};
use crate::plans::reader::read_plan_yaml;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

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

    // A plan whose body was never written. The plan list renders this as a real plan and the plan view
    // shows an empty state, so without a report the operator meets a plan that looks merely unread and
    // has no way to find out that the run which was going to write it died.
    //
    // `classify_abandoned_husk`, not `classify_husk`: a plan created seconds ago by a job still
    // drafting into it is byte-for-byte identical to an abandoned one, and warning about it would mean
    // `tendril plan validate` reporting a problem with every plan during the minute after it is
    // created. The quiet period is what separates the two.
    //
    // A Warning, not an Error: the folder is well-formed and `plan doctor` exits non-zero only on
    // Errors, so calling this one would make an interrupted run fail every subsequent health check.
    // The message says what to do about it, because `--fix` deliberately will not do it unasked.
    match classify_abandoned_husk(plan_folder) {
        HuskVerdict::Prunable => issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Warning".to_string(),
            message: "Plan has no revision and holds no work — its run was interrupted before the \
                      plan was drafted. Remove it with `tendril plan doctor --prune-husks`, or draft \
                      into it with `tendril plan write-revision`."
                .to_string(),
        }),
        HuskVerdict::HasContent(what) => issues.push(PlanDoctorIssue {
            plan_folder: folder_name.clone(),
            severity: "Warning".to_string(),
            message: format!(
                "Plan has no revision but {} — its run was interrupted after it had produced \
                 something. Not removable automatically; draft into it or delete it by hand.",
                what
            ),
        }),
        HuskVerdict::NotAHusk => {}
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
        let mut folders: Vec<PathBuf> = Vec::new();
        for entry in std::fs::read_dir(plans_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                folders.push(entry.path());
            }
        }

        // `read_dir` yields whatever order the filesystem happens to hand back - APFS returns these
        // sorted, ext4 does not - and `tendril plan doctor` prints these issues verbatim, so without
        // an order imposed here the same home reports the same problems in a different sequence on
        // every machine. Plan folders are `NNNNN-Title`, so sorting by name is sorting by plan id.
        folders.sort();

        for folder in &folders {
            all_issues.extend(check_plan_health(folder));
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

    let mut folders: Vec<PathBuf> = std::fs::read_dir(plans_dir)?
        .flatten()
        .map(|e| e.path())
        .collect();
    // Same reason as `check_all_plans_health`, whose issue list these are appended to: filesystem
    // order is not guaranteed, and both the malformed-URL warnings raised below and the per-plan
    // findings that follow are printed in the order they are pushed.
    folders.sort();

    for folder in folders {
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

// ---------------------------------------------------------------------------
// Husk removal (`tendril plan doctor --prune-husks`)
// ---------------------------------------------------------------------------

/// What a husk prune did, or would do.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HuskPruneOutcome {
    /// Folder names removed (or, in a dry run, that would be removed).
    pub pruned: Vec<String>,
    /// Revision-less plans left alone because they hold work, as `(folder name, what)`.
    pub kept: Vec<(String, String)>,
}

/// Removes every revision-less plan folder that holds nothing but the empty scaffold.
///
/// **Opt-in and never part of an ordinary `plan doctor` run.** This deletes plan folders, so the
/// decision is the operator's, taken with the report from [`check_all_plans_health`] in front of
/// them. `dry_run` produces the same report and removes nothing.
///
/// Only plans that have been quiet for [`crate::plans::orphans::HUSK_QUIET_PERIOD_MINUTES`] are
/// considered, because an interrupted run's husk is byte-for-byte identical to a plan created a
/// moment ago that a live job has not drafted into yet. Without that condition, running this while
/// any `CreatePlan` was in flight would delete the plan it was in the middle of making.
///
/// Refuses on the same two conditions as the job-side cleanup, for the same reasons: the folder must
/// be a direct `NNNNN-` child of `plans_dir`, and it must hold no work. A plan with a `Wireframes/`
/// directory, an artifact or a recorded PR is reported in `kept` rather than removed, whatever the
/// operator asked for — a flag is consent to tidy up empty folders, not to discard an agent's output.
///
/// The database row is not touched here. A husk that reached the database is a row pointing at a
/// folder that no longer exists, which `sync_plans_from_disk` reconciles; doing it here would mean
/// this function needed a connection and a `tendril_home`, and the job-side cleanup already covers
/// the path where both are to hand.
pub fn prune_husk_plans(plans_dir: &Path, dry_run: bool) -> Result<HuskPruneOutcome> {
    let mut outcome = HuskPruneOutcome::default();
    if !plans_dir.exists() {
        return Ok(outcome);
    }

    let mut folders: Vec<PathBuf> = std::fs::read_dir(plans_dir)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    folders.sort();

    for folder in folders {
        let name = folder
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        // The same quiet period the report uses, and for a stronger reason: this one deletes.
        match classify_abandoned_husk(&folder) {
            HuskVerdict::NotAHusk => {}
            HuskVerdict::HasContent(what) => outcome.kept.push((name, what)),
            HuskVerdict::Prunable => {
                if !is_plan_folder_under(plans_dir, &folder) {
                    continue;
                }
                if dry_run {
                    outcome.pruned.push(name);
                    continue;
                }
                match std::fs::remove_dir_all(&folder) {
                    Ok(()) => outcome.pruned.push(name),
                    Err(e) => outcome
                        .kept
                        .push((name, format!("could not be removed: {}", e))),
                }
            }
        }
    }

    Ok(outcome)
}
