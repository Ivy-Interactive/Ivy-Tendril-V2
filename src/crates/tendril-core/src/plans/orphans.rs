//! What a plan folder *is*, and how a half-made one is recognised and cleaned up.
//!
//! Three things live here because three separate subsystems need exactly the same judgement and had
//! been making it independently:
//!
//!   * [`is_plan_folder_under`] — the safety predicate guarding every automated `remove_dir_all` of a
//!     plan folder. It used to be a private regex inside [`crate::jobs::deliverable`]; the scope guard
//!     below needs the identical rule, and two copies of a predicate that authorises deletion is the
//!     kind of duplication that eventually diverges in the dangerous direction.
//!   * [`PlanFolderGuard`] — removes a plan folder that was created and then not finished, so a
//!     failed create leaves nothing behind.
//!   * [`CREATED_BY_JOB_KEY`] and [`find_plan_folder_created_by_job`] — the breadcrumb that lets a job
//!     find the plan it created even when it was killed before it could report the id.
//!
//! The breadcrumb is the load-bearing one. `CreatePlan` makes a plan in two steps — `tendril plan
//! create` writes the folder, a later `tendril plan write-revision` writes `001.md` — and the job only
//! learns which plan is its own when the agent runs `tendril job status --plan-id` *between* them.
//! Kill the agent in that window (a stop-all does exactly this, to every job at once) and the folder
//! is on disk with nothing in the job's row pointing at it. [`crate::jobs::deliverable::
//! resolve_created_plan_folder`] then finds nothing, the cleanup no-ops, and the operator is left with
//! a revision-less husk that renders as an empty plan.
//!
//! Writing the job id into `plan.yaml` at creation time inverts that: the association exists before
//! the agent can be killed, because the same command that makes the folder records who asked for it.

use crate::models::PlanYaml;
use crate::plans::reader::read_plan_yaml;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use regex::Regex;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// Plan folders are `NNNNN-Title`. Nothing else under `Plans/` is one.
static PLAN_FOLDER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{5}-").unwrap());

/// The `plan.yaml` key naming the job whose run created this plan.
///
/// It rides in [`PlanYaml::extra`], which is `#[serde(flatten)]`, so it round-trips through every
/// read-modify-write without needing a schema bump and is simply absent on a plan created by hand.
pub const CREATED_BY_JOB_KEY: &str = "createdByJob";

/// Whether `name` is shaped like a plan folder name.
pub fn is_plan_folder_name(name: &str) -> bool {
    PLAN_FOLDER_RE.is_match(name)
}

/// Whether `folder` is a plan folder directly under `plans_dir`.
///
/// **This is the authorisation check for deleting a plan folder.** A resolve that went wrong upstream
/// must not be able to hand a deletion path something outside the plans directory, so the check is on
/// the shape of the path rather than on the caller's confidence: a direct child of `plans_dir`, named
/// `NNNNN-`. `..` cannot slip through, because a parent of `plans_dir/..` is not `plans_dir`.
pub fn is_plan_folder_under(plans_dir: &Path, folder: &Path) -> bool {
    folder
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|name| folder.parent() == Some(plans_dir) && is_plan_folder_name(name))
}

/// The job id recorded on a plan at creation, if any.
pub fn created_by_job(plan: &PlanYaml) -> Option<String> {
    plan.extra
        .get(CREATED_BY_JOB_KEY)?
        .as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The plan folder under `plans_dir` that `job_id`'s run created, found by its breadcrumb.
///
/// Exact correlation, not a heuristic: the id came out of the job's own environment and was written
/// by the command that made the folder, so a match cannot be a plan the operator created by hand in
/// the same window. That distinction matters because the caller deletes what this returns.
///
/// Folders are walked in sorted order so that a (should-be-impossible) double match is at least
/// resolved deterministically to the lower id.
pub fn find_plan_folder_created_by_job(plans_dir: &Path, job_id: &str) -> Option<PathBuf> {
    let job_id = job_id.trim();
    if job_id.is_empty() {
        return None;
    }

    let mut folders: Vec<PathBuf> = std::fs::read_dir(plans_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(is_plan_folder_name)
        })
        .collect();
    folders.sort();

    folders.into_iter().find(|folder| {
        read_plan_yaml(folder)
            .ok()
            .and_then(|(plan, _)| created_by_job(&plan))
            .is_some_and(|recorded| recorded == job_id)
    })
}

/// Removes a plan folder unless it is explicitly [`disarm`](Self::disarm)ed first.
///
/// The point is coverage of `?`. `create_plan` creates the folder and then does several more things
/// that can each fail — serialising the yaml, taking the file lock, the atomic write, reading the
/// result back — and every one of those was an early return that left the folder on disk. Handling
/// them one at a time means the next `?` added to that function silently reopens the hole; a guard
/// whose `Drop` runs on every exit path cannot be forgotten.
///
/// The deletion is gated on [`is_plan_folder_under`], the same predicate that guards the job-side
/// cleanup, so an armed guard over an unexpected path declines rather than deleting.
///
/// `Drop` cannot report, so a failed removal is logged and the folder is left alone. That is the
/// right trade: the alternative to a leaked folder here is panicking inside a cleanup path.
pub struct PlanFolderGuard {
    plans_dir: PathBuf,
    folder: Option<PathBuf>,
}

impl PlanFolderGuard {
    /// Arms a guard over `folder`, which is expected to be a plan folder directly under `plans_dir`.
    pub fn arm(plans_dir: &Path, folder: &Path) -> Self {
        Self {
            plans_dir: plans_dir.to_path_buf(),
            folder: Some(folder.to_path_buf()),
        }
    }

    /// The create succeeded; keep the folder.
    pub fn disarm(&mut self) {
        self.folder = None;
    }
}

impl Drop for PlanFolderGuard {
    fn drop(&mut self) {
        let Some(folder) = self.folder.take() else {
            return;
        };
        if !is_plan_folder_under(&self.plans_dir, &folder) {
            tracing::warn!(
                "Refusing to roll back {}: not a plan folder directly under {}",
                folder.display(),
                self.plans_dir.display()
            );
            return;
        }
        match std::fs::remove_dir_all(&folder) {
            Ok(()) => tracing::info!(
                "Rolled back partially created plan folder {}",
                folder.display()
            ),
            Err(e) => tracing::warn!(
                "Failed to roll back partially created plan folder {}: {}",
                folder.display(),
                e
            ),
        }
    }
}

/// The directories `create_plan` lays down. A husk holds these and nothing else.
const SCAFFOLD_DIRS: &[&str] = &["Revisions", "Worktrees", "Artifacts"];

/// Why a revision-less plan is, or is not, safe to remove automatically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HuskVerdict {
    /// Not a husk: it has a revision, or it reached a state that means something happened to it.
    NotAHusk,
    /// Revision-less, but it holds work that deleting would destroy. `reason` names what.
    HasContent(String),
    /// Revision-less and holding nothing but the empty scaffold.
    Prunable,
}

/// Classifies a plan folder as a husk — a plan whose body was never written.
///
/// A husk is a plan folder with a valid `plan.yaml` and an empty `Revisions/`. The UI keys its
/// "undrafted" empty state off `revisionCount == 0`, so this is exactly the shape that renders as a
/// plan with nothing in it.
///
/// Terminal plans are exempt. A `Completed` or `Skipped` plan with no revision is an archive of a
/// decision, not an accident, and `Failed` is what [`crate::jobs::manager`] marks an abandoned create
/// *on purpose* so the operator can see it — reporting those back as problems would make the marking
/// self-defeating.
///
/// The [`HuskVerdict::HasContent`] arm is the safety valve, and it is not hypothetical: the two husks
/// this was written for differ precisely here. One holds nothing; the other holds a `Wireframes/`
/// directory with a built wireframe and a screenshot in it, produced by the agent before it was
/// killed. Both render as empty plans, but only one can be deleted without losing work, so the
/// classifier reports the difference rather than averaging over it.
///
/// **This judgement is structural only, and on its own it cannot tell a husk from a plan that is
/// about to be drafted into** — the two are byte-for-byte identical on disk. Callers that already
/// know the run is over (the job-side cleanup, which runs from a job's own terminal handler) can use
/// this directly. Callers sweeping the plans directory with no such knowledge must use
/// [`classify_settled_husk`] instead.
pub fn classify_husk(plan_folder: &Path) -> HuskVerdict {
    let Ok((plan, _)) = read_plan_yaml(plan_folder) else {
        return HuskVerdict::NotAHusk;
    };

    for terminal in ["Completed", "Skipped", "Failed"] {
        if plan.state.eq_ignore_ascii_case(terminal) {
            return HuskVerdict::NotAHusk;
        }
    }

    if revision_files(plan_folder) > 0 {
        return HuskVerdict::NotAHusk;
    }

    if !plan.prs.is_empty() {
        return HuskVerdict::HasContent(format!("{} recorded pull request(s)", plan.prs.len()));
    }
    if !plan.commits.is_empty() {
        return HuskVerdict::HasContent(format!("{} recorded commit(s)", plan.commits.len()));
    }

    // Anything on disk beyond the scaffold is work. `Wireframes/`, an attachment dropped into
    // `Artifacts/`, a worktree still checked out — all of it is the agent's output, and none of it is
    // ours to throw away because the revision never arrived.
    match unexpected_content(plan_folder) {
        Some(what) => HuskVerdict::HasContent(what),
        None => HuskVerdict::Prunable,
    }
}

/// How long a revision-less plan must sit untouched before a sweep will call it abandoned.
///
/// A `CreatePlan` run is force-terminated at `jobTimeout`, 30 minutes by default, so an hour is past
/// the point where any run that made a folder could still be alive to draft into it. Overshooting is
/// the cheap direction: the cost of waiting too long is that an operator sees a husk reported an hour
/// later than they might have, and the cost of not waiting long enough is that `--prune-husks` offers
/// to delete the plan a colleague created ninety seconds ago.
pub const HUSK_QUIET_PERIOD_MINUTES: i64 = 60;

/// [`classify_husk`], but only for a plan nothing has touched for `quiet_for`.
///
/// **The distinction this draws is the whole difference between a husk and a new plan.** A plan
/// created five seconds ago by a job that is still running has no revision, holds no work, and is in
/// `Draft` — structurally indistinguishable from plan 00004 in the operator's install, which has sat
/// in exactly that shape since its run was killed. The folder cannot tell them apart because the
/// difference is not in the folder: it is that one of them has a live run still coming back to write
/// its body, and the other does not.
///
/// Time is the available proxy for that. A sweep has no handle on the job table — `plan doctor` runs
/// from the CLI against a plans directory, with no daemon and possibly no database — so it asks
/// instead whether anything has happened here recently enough that a run could still be in flight.
/// Past [`HUSK_QUIET_PERIOD_MINUTES`], nothing can be: the job that would have drafted this plan was
/// force-terminated at `jobTimeout` long ago.
///
/// Recency is the *later* of the plan's own `updated` stamp and the folder's modification time. The
/// yaml stamp alone misses a plan whose agent is writing files into it without having saved the yaml
/// yet; the folder mtime alone misses a plan whose yaml was rewritten in place. Taking the maximum
/// means either kind of activity defers the verdict, and anything unreadable defers it too — every
/// uncertainty resolves towards leaving the plan alone.
pub fn classify_settled_husk(
    plan_folder: &Path,
    now: DateTime<Utc>,
    quiet_for: ChronoDuration,
) -> HuskVerdict {
    match classify_husk(plan_folder) {
        HuskVerdict::NotAHusk => HuskVerdict::NotAHusk,
        verdict => {
            if last_activity(plan_folder).is_some_and(|at| now - at >= quiet_for) {
                verdict
            } else {
                // Recent, or unknowable. Either way a run could still be working here.
                HuskVerdict::NotAHusk
            }
        }
    }
}

/// [`classify_settled_husk`] with the standard quiet period, evaluated now.
pub fn classify_abandoned_husk(plan_folder: &Path) -> HuskVerdict {
    classify_settled_husk(
        plan_folder,
        Utc::now(),
        ChronoDuration::minutes(HUSK_QUIET_PERIOD_MINUTES),
    )
}

/// The most recent moment anything is known to have happened to this plan.
///
/// `None` when neither source can be read, which callers treat as "too recent to judge".
fn last_activity(plan_folder: &Path) -> Option<DateTime<Utc>> {
    let from_yaml = read_plan_yaml(plan_folder)
        .ok()
        .map(|(plan, _)| plan.updated);
    let from_disk = std::fs::metadata(plan_folder)
        .and_then(|m| m.modified())
        .ok()
        .map(DateTime::<Utc>::from);

    match (from_yaml, from_disk) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

/// `.md` files under `Revisions/`, under either capitalisation.
fn revision_files(plan_folder: &Path) -> usize {
    let mut count = 0;
    for sub in ["Revisions", "revisions"] {
        let dir = plan_folder.join(sub);
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            count += entries
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("md"))
                .count();
        }
    }
    count
}

/// Describes the first thing in `plan_folder` that is not part of the empty scaffold.
///
/// Errs towards reporting content: a directory that cannot be read is reported as content rather
/// than assumed empty, because the consequence of guessing wrong is a deletion.
fn unexpected_content(plan_folder: &Path) -> Option<String> {
    let Ok(entries) = std::fs::read_dir(plan_folder) else {
        return Some("its contents could not be listed".to_string());
    };

    let mut names: Vec<(String, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.path()))
        .collect();
    names.sort();

    for (name, path) in names {
        if name == "plan.yaml" {
            continue;
        }
        if SCAFFOLD_DIRS.contains(&name.as_str()) {
            match std::fs::read_dir(&path) {
                Ok(mut inner) => {
                    if inner.next().is_some() {
                        return Some(format!("{}/ is not empty", name));
                    }
                }
                Err(_) => return Some(format!("{}/ could not be listed", name)),
            }
            continue;
        }
        return Some(format!("it contains {}", name));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tendril-orphans-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn husk(plans_dir: &Path, name: &str, state: &str) -> PathBuf {
        let folder = plans_dir.join(name);
        for d in SCAFFOLD_DIRS {
            std::fs::create_dir_all(folder.join(d)).unwrap();
        }
        let plan = PlanYaml {
            state: state.to_string(),
            title: name.to_string(),
            ..Default::default()
        };
        crate::plans::writer::write_plan_yaml(&folder, &plan).unwrap();
        folder
    }

    #[test]
    fn the_safety_predicate_only_admits_a_direct_plan_child() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();

        assert!(is_plan_folder_under(&plans, &plans.join("00001-Fine")));
        // Not a plan name.
        assert!(!is_plan_folder_under(&plans, &plans.join("scratch")));
        // Not a direct child.
        assert!(!is_plan_folder_under(
            &plans,
            &plans.join("00001-Fine").join("00002-Nested")
        ));
        // Outside the plans directory entirely.
        assert!(!is_plan_folder_under(&plans, &root.join("00001-Fine")));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn an_armed_guard_removes_the_folder_and_a_disarmed_one_does_not() {
        let root = temp();
        let plans = root.join("Plans");
        let folder = plans.join("00001-Rollback");
        std::fs::create_dir_all(&folder).unwrap();

        {
            let _guard = PlanFolderGuard::arm(&plans, &folder);
        }
        assert!(!folder.exists(), "an armed guard must remove the folder");

        std::fs::create_dir_all(&folder).unwrap();
        {
            let mut guard = PlanFolderGuard::arm(&plans, &folder);
            guard.disarm();
        }
        assert!(folder.is_dir(), "a disarmed guard must keep the folder");

        std::fs::remove_dir_all(&root).ok();
    }

    /// The guard authorises a deletion, so it has to refuse the same paths the job-side cleanup does.
    #[test]
    fn a_guard_over_a_path_outside_the_plans_dir_refuses_to_delete() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();
        let outside = root.join("00001-NotAPlan");
        std::fs::create_dir_all(&outside).unwrap();

        {
            let _guard = PlanFolderGuard::arm(&plans, &outside);
        }
        assert!(outside.is_dir(), "the folder must be left alone");

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_breadcrumb_finds_the_plan_its_job_created() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();

        let mine = husk(&plans, "00007-Mine", "Draft");
        let (mut plan, _) = read_plan_yaml(&mine).unwrap();
        plan.extra.insert(
            CREATED_BY_JOB_KEY.to_string(),
            serde_yaml::Value::String("00013".to_string()),
        );
        crate::plans::writer::write_plan_yaml(&mine, &plan).unwrap();

        // A plan the operator made by hand in the same window carries no breadcrumb.
        husk(&plans, "00008-Theirs", "Draft");

        assert_eq!(
            find_plan_folder_created_by_job(&plans, "00013"),
            Some(mine.clone())
        );
        assert_eq!(find_plan_folder_created_by_job(&plans, "00099"), None);
        assert_eq!(find_plan_folder_created_by_job(&plans, ""), None);

        std::fs::remove_dir_all(&root).ok();
    }

    /// **A husk and a brand-new plan are the same bytes on disk.** The only thing that separates them
    /// is whether a run is still coming back to draft into it, so anything sweeping the plans
    /// directory has to wait before it calls one abandoned. Plan 00002 in the operator's install --
    /// legitimate, and the negative control for this whole feature -- is what gets destroyed if this
    /// condition is missing.
    #[test]
    fn a_plan_a_live_job_just_created_is_not_yet_a_husk() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();
        let fresh = husk(&plans, "00001-JustCreated", "Draft");

        // Structurally a husk, and that is exactly the problem.
        assert_eq!(classify_husk(&fresh), HuskVerdict::Prunable);

        let now = Utc::now();
        let quiet = ChronoDuration::minutes(HUSK_QUIET_PERIOD_MINUTES);
        assert_eq!(
            classify_settled_husk(&fresh, now, quiet),
            HuskVerdict::NotAHusk,
            "a plan created seconds ago may still be drafted into"
        );
        // Still inside the window a `CreatePlan` could run for.
        assert_eq!(
            classify_settled_husk(&fresh, now + ChronoDuration::minutes(29), quiet),
            HuskVerdict::NotAHusk
        );
        // Past `jobTimeout` by a wide margin: no run can still be working here.
        assert_eq!(
            classify_settled_husk(&fresh, now + ChronoDuration::hours(3), quiet),
            HuskVerdict::Prunable
        );

        std::fs::remove_dir_all(&root).ok();
    }

    /// The quiet period defers a verdict; it never manufactures one. A plan that is not a husk does
    /// not become one by sitting there, and a plan holding work stays `HasContent`.
    #[test]
    fn waiting_does_not_turn_a_real_plan_into_a_husk() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();
        let quiet = ChronoDuration::minutes(HUSK_QUIET_PERIOD_MINUTES);
        let long_ago = Utc::now() + ChronoDuration::days(30);

        let drafted = husk(&plans, "00001-Drafted", "Draft");
        std::fs::write(drafted.join("Revisions/001.md"), b"# Body").unwrap();
        assert_eq!(
            classify_settled_husk(&drafted, long_ago, quiet),
            HuskVerdict::NotAHusk
        );

        let done = husk(&plans, "00002-Completed", "Completed");
        assert_eq!(
            classify_settled_husk(&done, long_ago, quiet),
            HuskVerdict::NotAHusk,
            "the operator's 00002 is the negative control and must never be prunable"
        );

        let with_work = husk(&plans, "00003-HasWork", "Draft");
        std::fs::create_dir_all(with_work.join("Wireframes")).unwrap();
        std::fs::write(with_work.join("Wireframes/App.tsx"), b"export {}").unwrap();
        assert!(matches!(
            classify_settled_husk(&with_work, long_ago, quiet),
            HuskVerdict::HasContent(_)
        ));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_bare_revisionless_draft_is_prunable_but_a_terminal_one_is_not() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();

        assert_eq!(
            classify_husk(&husk(&plans, "00001-Bare", "Draft")),
            HuskVerdict::Prunable
        );
        for state in ["Completed", "Skipped", "Failed"] {
            assert_eq!(
                classify_husk(&husk(&plans, &format!("00002-{}", state), state)),
                HuskVerdict::NotAHusk,
                "{} is not an accident",
                state
            );
        }

        std::fs::remove_dir_all(&root).ok();
    }

    /// The real 00003: revision-less, and holding a built wireframe nobody should lose.
    #[test]
    fn a_revisionless_plan_holding_work_is_reported_but_not_prunable() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();

        let folder = husk(&plans, "00003-HasWireframes", "Draft");
        std::fs::create_dir_all(folder.join("Wireframes").join("editor")).unwrap();
        std::fs::write(folder.join("Wireframes/editor/App.tsx"), b"export {}").unwrap();

        assert_eq!(
            classify_husk(&folder),
            HuskVerdict::HasContent("it contains Wireframes".to_string())
        );

        // Same shape, but the work is inside a scaffold directory.
        let artifacts = husk(&plans, "00004-HasArtifact", "Draft");
        std::fs::write(artifacts.join("Artifacts/note.txt"), b"hi").unwrap();
        assert_eq!(
            classify_husk(&artifacts),
            HuskVerdict::HasContent("Artifacts/ is not empty".to_string())
        );

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_plan_with_a_revision_is_never_a_husk() {
        let root = temp();
        let plans = root.join("Plans");
        std::fs::create_dir_all(&plans).unwrap();

        let folder = husk(&plans, "00002-Real", "Draft");
        std::fs::write(folder.join("Revisions/001.md"), b"# Body\n").unwrap();
        assert_eq!(classify_husk(&folder), HuskVerdict::NotAHusk);

        std::fs::remove_dir_all(&root).ok();
    }
}
