//! The `tendril project` clap surface — the subcommand enums and their help text.
//!
//! Kept apart from the handlers so the shape of the CLI can be read without scrolling past the
//! logic that implements it.

use clap::Subcommand;

#[derive(Subcommand)]
pub enum ProjectCommands {
    #[command(about = "List projects")]
    List,

    #[command(about = "Synchronize project repositories from remote")]
    Sync {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(long, help = "Sync only this repository (path or directory name)")]
        repo: Option<String>,
    },

    #[command(about = "Get project details")]
    Get { name: String },

    #[command(about = "Add a new project")]
    Add { name: String },

    #[command(about = "Remove a project")]
    Remove { name: String },

    #[command(about = "Rename a project")]
    Rename { name: String, new_name: String },

    #[command(about = "Add a repository to a project")]
    AddRepo { name: String, path: String },

    #[command(about = "Remove a repository from a project")]
    RemoveRepo { name: String, path: String },

    #[command(about = "Add a verification to a project")]
    AddVerification {
        name: String,
        verification: String,
        #[arg(long, conflicts_with = "optional", help = "Mark as required (default)")]
        required: bool,
        #[arg(long, help = "Mark as optional")]
        optional: bool,
        #[arg(long, help = "Insert directly after this verification")]
        after: Option<String>,
    },

    #[command(about = "Remove a verification from a project")]
    RemoveVerification { name: String, verification: String },

    #[command(about = "Move a verification within a project's run order")]
    MoveVerification {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "VERIFICATION")]
        verification: String,
        #[arg(long, help = "Move directly before this verification")]
        before: Option<String>,
        #[arg(long, help = "Move directly after this verification")]
        after: Option<String>,
        #[arg(long, help = "Move to this zero-based position")]
        position: Option<usize>,
    },

    #[command(about = "Add a build dependency to a project")]
    AddBuildDep {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "DEPENDENCY")]
        dependency: String,
    },

    #[command(about = "Remove a build dependency from a project")]
    RemoveBuildDep {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "DEPENDENCY")]
        dependency: String,
    },

    #[command(about = "Add a review action to a project")]
    AddReviewAction {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        action: String,
        #[arg(long)]
        command: String,
        #[arg(long, default_value = "")]
        condition: String,
        /// Repo-relative path prefix this action renders (repeatable).
        #[arg(long = "paths")]
        paths: Vec<String>,
        /// Insert before this existing action instead of appending to the end.
        #[arg(long)]
        before: Option<String>,
        /// Insert after this existing action instead of appending to the end.
        #[arg(long)]
        after: Option<String>,
    },

    #[command(about = "Remove a review action from a project")]
    RemoveReviewAction {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        action: String,
    },

    #[command(about = "List MCP servers in a project")]
    ListMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add an MCP server to a project")]
    AddMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        server: String,
        #[arg(value_name = "COMMAND")]
        command: String,
        /// Argument passed to the server command (repeatable).
        #[arg(long = "arg")]
        arguments: Vec<String>,
        /// Environment variable for the server (repeatable).
        #[arg(long = "env", value_name = "KEY=VALUE")]
        environment: Vec<String>,
    },

    #[command(about = "Remove an MCP server from a project")]
    RemoveMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        server: String,
    },

    #[command(about = "List custom skills in a project")]
    ListSkills {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add a custom skill to a project")]
    AddSkill {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        skill: String,
        #[arg(long)]
        description: Option<String>,
        #[arg(long, help = "Skill file or folder holding SKILL.md")]
        path: Option<String>,
        #[arg(long, help = "Inline instructions, used when no path is given")]
        instructions: Option<String>,
    },

    #[command(about = "Remove a custom skill from a project")]
    RemoveSkill {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        skill: String,
    },

    #[command(about = "Import MCP servers and custom skills from a repository into a project")]
    Import {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "REPO")]
        repo: String,
        #[arg(long, help = "Import only MCP servers")]
        mcp_only: bool,
        #[arg(long, help = "Import only custom skills")]
        skills_only: bool,
    },

    #[command(about = "Import MCP servers from a repository into a project")]
    ImportMcp {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "REPO")]
        repo: String,
        #[arg(long = "name", help = "Import only the server with this name")]
        server: Option<String>,
    },

    #[command(about = "Import custom skills from a repository into a project")]
    ImportSkills {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "REPO")]
        repo: String,
        #[arg(long = "name", help = "Import only the skill with this name")]
        skill: Option<String>,
        #[arg(long, help = "Register the skill without copying its files")]
        no_copy: bool,
    },

    #[command(about = "Add a promptware hook to a project")]
    AddHook {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        hook: String,
        #[arg(long, value_parser = ["before", "after"], default_value = "before")]
        when: String,
        /// Promptwares the hook fires for. Omit to fire for every promptware.
        #[arg(long, value_delimiter = ',')]
        promptwares: Vec<String>,
        #[arg(long)]
        action: String,
        #[arg(long, default_value = "")]
        condition: String,
    },

    #[command(about = "Remove a promptware hook from a project")]
    RemoveHook {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        hook: String,
    },

    #[command(about = "Rank a project's review actions against a plan's changed files")]
    ReviewActions {
        #[arg(value_name = "PROJECT")]
        name: String,
        /// A changed file to rank against (repeatable). Combined with --plan if both are given.
        #[arg(long = "changed-file")]
        changed_files: Vec<String>,
        /// Derive changed files from this plan's worktree(s).
        #[arg(long)]
        plan: Option<String>,
        #[arg(long, default_value = "table")]
        format: String,
    },

    #[command(about = "Set a project field")]
    Set {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "FIELD")]
        field: String,
        #[arg(value_name = "VALUE")]
        value: String,
    },

    #[command(subcommand, about = "Manage a project's named service ports")]
    Port(ProjectPortCommands),

    #[command(subcommand, about = "Manage a project's environment files")]
    EnvFile(ProjectEnvFileCommands),
}

#[derive(Subcommand)]
pub enum ProjectPortCommands {
    #[command(about = "List a project's named service ports")]
    List {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add or update a named service port")]
    Add {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        port_name: String,
        #[arg(long)]
        default_port: u16,
        #[arg(long, default_value = "")]
        description: String,
    },

    #[command(about = "Remove a named service port")]
    Remove {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "NAME")]
        port_name: String,
    },
}

#[derive(Subcommand)]
pub enum ProjectEnvFileCommands {
    #[command(about = "List a project's environment files")]
    List {
        #[arg(value_name = "PROJECT")]
        name: String,
    },

    #[command(about = "Add or update an environment file")]
    Add {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "PATH")]
        path: String,
        #[arg(long, help = "Source file, relative to the worktree root")]
        template: Option<String>,
        #[arg(
            long = "override",
            value_name = "KEY=VALUE",
            help = "Key written on top of the template (repeatable)"
        )]
        overrides: Vec<String>,
    },

    #[command(about = "Remove an environment file")]
    Remove {
        #[arg(value_name = "PROJECT")]
        name: String,
        #[arg(value_name = "PATH")]
        path: String,
    },
}
