//! The `tendril plan` clap surface — the subcommand tree and its argument structs.
//!
//! Kept apart from the handlers so the shape of the CLI can be read without scrolling past the
//! logic that implements it, the same way `commands/project/cli.rs` is.

use clap::{Args, Subcommand};
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum PlanCommands {
    #[command(about = "List plans")]
    List(PlanListArgs),

    #[command(
        name = "check-wireframes",
        about = "Report any wireframe code in a plan's changes"
    )]
    CheckWireframes {
        #[arg(value_name = "ID", help = "Plan id or folder name")]
        id: String,
    },

    #[command(about = "Create a new plan")]
    Create(PlanCreateArgs),

    #[command(about = "Update plan from file or stdin")]
    Update(PlanUpdateArgs),

    #[command(about = "Get plan data")]
    Get(PlanGetArgs),

    #[command(about = "Set a plan field")]
    Set(PlanSetArgs),

    #[command(about = "Validate plan health")]
    Validate(PlanValidateArgs),

    #[command(about = "Check all plans health")]
    Doctor {
        #[arg(long)]
        fix: bool,

        /// Also verify every recorded pull request against GitHub. Opt-in: it costs one `gh` call
        /// per distinct PR, so the default doctor pass stays offline and free.
        #[arg(long)]
        prs: bool,

        /// Delete plan folders that have no revision and hold no work — the husks an interrupted
        /// `CreatePlan` leaves behind. Separate from `--fix`, which only migrates schemas: this
        /// removes plan folders, so it is never implied by anything. A revision-less plan that holds
        /// a wireframe, an artifact or a recorded PR is reported and kept whatever this flag says.
        #[arg(long = "prune-husks")]
        prune_husks: bool,

        /// With `--prune-husks`, report what would be removed and remove nothing.
        #[arg(long = "dry-run")]
        dry_run: bool,
    },

    #[command(about = "Remove plan worktrees")]
    Cleanup(PlanCleanupArgs),

    #[command(about = "Create a worktree for a repository in a plan")]
    AddWorktree(PlanAddWorktreeArgs),

    #[command(about = "Remove a worktree from a plan")]
    RemoveWorktree(PlanRemoveWorktreeArgs),

    #[command(about = "Write a revision")]
    WriteRevision(PlanWriteRevisionArgs),

    #[command(about = "Get revision content")]
    GetRevision(PlanGetRevisionArgs),

    #[command(about = "Add repository to plan")]
    AddRepo(PlanAddRepoArgs),

    #[command(about = "Remove repository from plan")]
    RemoveRepo(PlanRemoveRepoArgs),

    #[command(about = "Add pull request to plan")]
    AddPr(PlanAddPrArgs),

    #[command(about = "Remove pull request from plan")]
    RemovePr(PlanRemovePrArgs),

    #[command(about = "Add commit to plan")]
    AddCommit(PlanAddCommitArgs),

    #[command(about = "Add dependency to plan")]
    AddDependsOn(PlanAddDependsOnArgs),

    #[command(about = "Remove dependency from plan")]
    RemoveDependsOn(PlanRemoveDependsOnArgs),

    #[command(about = "Add related plan")]
    AddRelatedPlan(PlanAddRelatedArgs),

    #[command(about = "Remove related plan")]
    RemoveRelatedPlan(PlanRemoveRelatedArgs),

    #[command(about = "Set verification status")]
    SetVerification(PlanSetVerificationArgs),

    #[command(subcommand, about = "Manage plan verifications")]
    Verification(PlanVerificationCommands),

    #[command(subcommand, about = "Manage plan recommendations")]
    Rec(PlanRecCommands),

    #[command(subcommand, about = "Materialize or inspect the plan's environment")]
    Env(PlanEnvCommands),
}

#[derive(Args)]
pub struct PlanListArgs {
    #[arg(short, long)]
    pub status: Option<String>,
    #[arg(long)]
    pub state: Option<String>,
    #[arg(short, long)]
    pub project: Option<String>,
    #[arg(long)]
    pub level: Option<String>,
    #[arg(long)]
    pub has_pr: bool,
    #[arg(long)]
    pub has_worktree: bool,
    #[arg(short = 'q', long)]
    pub search: Option<String>,
    #[arg(long)]
    pub format: Option<String>,
    /// `0` is rejected by the parser rather than silently truncating the list to nothing, which is
    /// indistinguishable from "no plans match".
    #[arg(long, value_parser = clap::value_parser!(u64).range(1..))]
    pub limit: Option<u64>,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
}

#[derive(Args)]
pub struct PlanCreateArgs {
    pub title: String,
    pub project: String,
    #[arg(long)]
    pub level: Option<String>,
    #[arg(long)]
    pub initial_prompt: Option<String>,
    #[arg(long)]
    pub source_url: Option<String>,
    #[arg(long)]
    pub execution_profile: Option<String>,
    #[arg(long)]
    pub priority: Option<i32>,
    #[arg(long)]
    pub verification: Vec<String>,
    #[arg(long)]
    pub depends_on: Vec<String>,
    #[arg(long)]
    pub related_plan: Vec<String>,
    #[arg(long)]
    pub chat_session: Option<String>,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
    #[arg(long)]
    pub no_duplicate_check: bool,
}

#[derive(Args)]
pub struct PlanUpdateArgs {
    pub plan_id: String,
    #[arg(short, long)]
    pub file: Option<PathBuf>,
    #[arg(long)]
    pub stdin: bool,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
}

#[derive(Args)]
pub struct PlanGetArgs {
    pub plan_id: String,
    pub field: Option<String>,
}

#[derive(Args)]
pub struct PlanSetArgs {
    pub plan_id: String,
    pub field: String,
    pub value: String,
    #[arg(long)]
    pub allow_failed_verifications: bool,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanValidateArgs {
    pub plan_id: String,
}

#[derive(Args)]
pub struct PlanCleanupArgs {
    pub plan_id: String,
    #[arg(
        long,
        help = "Remove the worktrees even if the plan is not in a terminal state"
    )]
    pub force: bool,
}

#[derive(Args)]
pub struct PlanWriteRevisionArgs {
    pub plan_id: String,
    #[arg(long)]
    pub file: Option<PathBuf>,
    #[arg(long)]
    pub stdin: bool,
    #[arg(long)]
    pub plans_dir: Option<PathBuf>,
    #[arg(long, help = "Bypass question block validation")]
    pub no_question_check: bool,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanGetRevisionArgs {
    pub plan_id: String,
    #[arg(long)]
    pub number: Option<i32>,
}

#[derive(Args)]
pub struct PlanAddRepoArgs {
    pub plan_id: String,
    pub path: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanRemoveRepoArgs {
    pub plan_id: String,
    pub path: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanAddWorktreeArgs {
    pub plan_id: String,
    #[arg(help = "Path to the repository to create the worktree from")]
    pub repo: String,
    #[arg(
        long,
        help = "Branch to base the worktree on, defaults to origin's HEAD"
    )]
    pub base: Option<String>,
}

#[derive(Args)]
pub struct PlanRemoveWorktreeArgs {
    pub plan_id: String,
    #[arg(help = "Worktree folder name inside the plan's Worktrees directory")]
    pub repo_name: String,
    #[arg(long, help = "Branch to delete, defaults to the plan's branch")]
    pub branch: Option<String>,
}

#[derive(Args)]
pub struct PlanAddPrArgs {
    pub plan_id: String,
    pub url: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanRemovePrArgs {
    pub plan_id: String,
    pub url: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanAddCommitArgs {
    pub plan_id: String,
    pub sha: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanAddDependsOnArgs {
    pub plan_id: String,
    pub folder: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanRemoveDependsOnArgs {
    pub plan_id: String,
    pub folder: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanAddRelatedArgs {
    pub plan_id: String,
    pub folder: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanRemoveRelatedArgs {
    pub plan_id: String,
    pub folder: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Args)]
pub struct PlanSetVerificationArgs {
    pub plan_id: String,
    pub name: String,
    pub status: String,
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Subcommand)]
pub enum PlanVerificationCommands {
    #[command(about = "List a plan's verifications in run order")]
    List(PlanVerificationListArgs),
    #[command(about = "Add a verification to a plan")]
    Add(PlanVerificationAddArgs),
    #[command(about = "Remove a verification from a plan")]
    Remove(PlanVerificationRemoveArgs),
}

#[derive(Args)]
pub struct PlanVerificationListArgs {
    pub plan_id: String,
    #[arg(long, help = "Only show verifications with this status")]
    pub status: Option<String>,
    #[arg(long, help = "Print compact JSON instead of a table")]
    pub json: bool,
}

#[derive(Args)]
pub struct PlanVerificationAddArgs {
    pub plan_id: String,
    pub name: String,
    #[arg(long, help = "Initial status (default: Pending)")]
    pub status: Option<String>,
    #[command(flatten)]
    pub edit: PlanEditReasonArgs,
}

#[derive(Args)]
pub struct PlanVerificationRemoveArgs {
    pub plan_id: String,
    pub name: String,
    #[command(flatten)]
    pub edit: PlanEditReasonArgs,
}

/// `--reason` / `--chat-session`, the pair every other plan mutation carries so an edit can explain
/// itself to the other chat sessions watching the plan.
#[derive(Args, Default)]
pub struct PlanEditReasonArgs {
    #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
    pub reason: Option<String>,
    #[arg(
        long,
        help = "Chat session making the edit, excluded from self-notification"
    )]
    pub chat_session: Option<String>,
}

#[derive(Subcommand)]
pub enum PlanRecCommands {
    #[command(about = "List recommendations")]
    List {
        plan_id: String,
        #[arg(
            long,
            help = "Only recommendations in this state (Pending, Accepted, AcceptedWithNotes, Declined)"
        )]
        state: Option<String>,
    },
    #[command(about = "List recommendations across every plan")]
    All {
        #[arg(long, help = "Only recommendations of plans in this project")]
        project: Option<String>,
        #[arg(
            long,
            help = "Only recommendations in this state (Pending, Accepted, AcceptedWithNotes, Declined)"
        )]
        state: Option<String>,
    },
    #[command(about = "Rebuild the recommendations projection from the plan folders on disk")]
    Rebuild,
    #[command(about = "Add recommendation")]
    Add {
        plan_id: String,
        title: String,
        // `-d` is V1's short and `ExecutePlan`'s reflection step invokes it that way, so dropping it
        // made that step a usage error on every run.
        #[arg(short = 'd', long, default_value = "")]
        description: String,
        #[arg(long)]
        impact: Option<String>,
        #[command(flatten)]
        edit: PlanEditReasonArgs,
    },
    #[command(
        about = "Set a recommendation field (title, description, state, impact, declineReason, notes)"
    )]
    Set {
        plan_id: String,
        title: String,
        field: String,
        value: String,
        #[command(flatten)]
        edit: PlanEditReasonArgs,
    },
    #[command(about = "Accept recommendation, with optional notes")]
    Accept {
        plan_id: String,
        title: String,
        #[arg(
            long,
            help = "Why it was accepted; any text promotes it to AcceptedWithNotes"
        )]
        notes: Option<String>,
        #[command(flatten)]
        edit: PlanEditReasonArgs,
    },
    // `--reason` here is the *decline* reason, which is the documented public surface of this command
    // and what it has always meant. The notification reason every other mutation spells `--reason` is
    // therefore `--edit-reason` on this one command.
    #[command(
        about = "Decline recommendation. --reason is the decline reason; use --edit-reason for the notification reason"
    )]
    Decline {
        plan_id: String,
        title: String,
        #[arg(
            long,
            help = "Why the recommendation was declined, stored in plan.yaml"
        )]
        reason: Option<String>,
        #[arg(long, help = "Why this edit was made, reported to other chat sessions")]
        edit_reason: Option<String>,
        #[arg(
            long,
            help = "Chat session making the edit, excluded from self-notification"
        )]
        chat_session: Option<String>,
    },
    #[command(about = "Remove recommendation")]
    Remove {
        plan_id: String,
        title: String,
        #[command(flatten)]
        edit: PlanEditReasonArgs,
    },
}

#[derive(Subcommand)]
pub enum PlanEnvCommands {
    #[command(
        about = "Allocate ports and write the project's env files into the plan's worktrees"
    )]
    Materialize {
        plan_id: String,
        #[arg(long, help = "Only this repo's worktree (path or repo name)")]
        repo: Option<String>,
        #[arg(long, help = "Overwrite env files that were edited by hand")]
        force: bool,
        #[arg(long)]
        json: bool,
    },
    #[command(about = "Print the plan's allocated ports and resolved environment")]
    Get {
        plan_id: String,
        #[arg(
            long,
            help = "Resolve against this repo's worktree (path or repo name)"
        )]
        repo: Option<String>,
        #[arg(long)]
        json: bool,
    },
}
