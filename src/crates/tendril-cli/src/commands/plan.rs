//! `tendril plan` — the plan document and everything recorded on it: its state and revisions, the
//! repos and worktrees it is worked in, the pull requests and commits it produced, the
//! verifications it must pass and the recommendations it turned up.
//!
//! Unlike the project commands there is no daemon path here: every subcommand is filesystem-first,
//! and the daemon is only ever *told* about an edit after the fact (see [`events`]). One module per
//! kind of thing a plan holds:
//!
//! - [`cli`] is the clap surface; [`vocabulary`] the accepted values it validates against.
//! - [`lifecycle`] reads and rewrites `plan.yaml` wholesale — `list`, `create`, `update`, `get`,
//!   `set` and the revisions. [`links`] only appends to or removes from one of its arrays.
//! - [`verifications`], [`recommendations`] and [`env`] each own one subcommand subtree.
//! - [`worktrees`] owns the checkouts, [`health`] the read-only verdicts.
//! - [`events`] is how any of them reports what it did to the plan's other chat sessions.
//!
//! What stays here is the dispatcher that resolves the plans directory and database once and hands
//! an arm to its module.

mod cli;
mod env;
mod events;
mod health;
mod lifecycle;
mod links;
mod recommendations;
mod verifications;
mod vocabulary;
mod worktrees;

pub use cli::{
    PlanAddCommitArgs, PlanAddDependsOnArgs, PlanAddPrArgs, PlanAddRelatedArgs, PlanAddRepoArgs,
    PlanAddWorktreeArgs, PlanCleanupArgs, PlanCommands, PlanCreateArgs, PlanEditReasonArgs,
    PlanEnvCommands, PlanGetArgs, PlanGetRevisionArgs, PlanListArgs, PlanRecCommands,
    PlanRemoveDependsOnArgs, PlanRemovePrArgs, PlanRemoveRelatedArgs, PlanRemoveRepoArgs,
    PlanRemoveWorktreeArgs, PlanSetArgs, PlanSetVerificationArgs, PlanUpdateArgs, PlanValidateArgs,
    PlanVerificationAddArgs, PlanVerificationCommands, PlanVerificationListArgs,
    PlanVerificationRemoveArgs, PlanWriteRevisionArgs,
};
pub use events::resolve_source_chat_session;
pub use vocabulary::{
    PLAN_LIST_FORMATS, SETTABLE_PLAN_FIELDS, SUPPORTED_PLAN_STATES, TERMINAL_PLAN_STATES,
};

use tendril_core::config::{get_database_path, get_plans_dir};

pub async fn handle_plan_command(
    cmd: PlanCommands,
    tendril_home: &std::path::Path,
) -> anyhow::Result<()> {
    let plans_dir = get_plans_dir(tendril_home);
    let db_path = get_database_path(tendril_home);

    match cmd {
        PlanCommands::CheckWireframes { id } => health::handle_check_wireframes(&id, tendril_home)?,
        PlanCommands::List(args) => lifecycle::list(args, plans_dir, db_path)?,
        PlanCommands::Create(args) => lifecycle::create(args, tendril_home, plans_dir, db_path)?,
        PlanCommands::Update(args) => lifecycle::update(args, plans_dir, db_path)?,
        PlanCommands::Get(args) => lifecycle::get(args, plans_dir)?,
        PlanCommands::Set(args) => lifecycle::set(args, tendril_home, plans_dir, db_path).await?,
        PlanCommands::Validate(args) => health::validate(args, plans_dir)?,
        PlanCommands::Doctor {
            fix,
            prs,
            prune_husks,
            dry_run,
        } => health::doctor(fix, prs, prune_husks, dry_run, plans_dir)?,
        PlanCommands::Cleanup(args) => worktrees::cleanup(args, plans_dir)?,
        // Worktree creation and removal are filesystem-only: unlike the project commands there is
        // no `_daemon` variant, because the daemon has no worktree endpoints to route to. Whoever
        // adds them should keep both paths in step.
        PlanCommands::AddWorktree(args) => worktrees::add(args, plans_dir)?,
        PlanCommands::RemoveWorktree(args) => worktrees::remove(args, plans_dir)?,
        PlanCommands::WriteRevision(args) => {
            lifecycle::write_revision_command(args, tendril_home, plans_dir, db_path).await?
        }
        PlanCommands::GetRevision(args) => lifecycle::get_revision_command(args, plans_dir)?,
        PlanCommands::AddRepo(args) => links::add_repo(args, tendril_home, plans_dir).await?,
        PlanCommands::RemoveRepo(args) => links::remove_repo(args, tendril_home, plans_dir).await?,
        PlanCommands::AddPr(args) => links::add_pr(args, tendril_home, plans_dir).await?,
        PlanCommands::RemovePr(args) => links::remove_pr(args, tendril_home, plans_dir).await?,
        PlanCommands::AddCommit(args) => links::add_commit(args, tendril_home, plans_dir).await?,
        PlanCommands::AddDependsOn(args) => {
            links::add_depends_on(args, tendril_home, plans_dir).await?
        }
        PlanCommands::RemoveDependsOn(args) => {
            links::remove_depends_on(args, tendril_home, plans_dir).await?
        }
        PlanCommands::AddRelatedPlan(args) => {
            links::add_related_plan(args, tendril_home, plans_dir).await?
        }
        PlanCommands::RemoveRelatedPlan(args) => {
            links::remove_related_plan(args, tendril_home, plans_dir).await?
        }
        PlanCommands::SetVerification(args) => {
            verifications::set_verification(args, tendril_home, plans_dir).await?
        }
        PlanCommands::Verification(verification_cmd) => {
            verifications::handle(verification_cmd, tendril_home, plans_dir, db_path).await?
        }
        PlanCommands::Rec(rec_cmd) => {
            recommendations::handle(rec_cmd, tendril_home, plans_dir, db_path).await?
        }
        PlanCommands::Env(env_cmd) => env::handle(env_cmd, tendril_home, plans_dir)?,
    }

    Ok(())
}
