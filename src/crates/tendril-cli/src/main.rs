use clap::{Parser, Subcommand};
use std::path::PathBuf;
use tendril_core::config::get_default_tendril_home;

use tendril_cli::commands;

#[derive(Parser)]
#[command(
    name = "tendril",
    author = "SpaceCorps Technology",
    version = env!("CARGO_PKG_VERSION"),
    about = "Tendril - AI Coding Agent Orchestration Service & CLI in Rust"
)]
struct Cli {
    #[arg(long, env = "TENDRIL_HOME", help = "Path to Tendril home directory")]
    home: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    #[command(subcommand, about = "Manage plans")]
    Plan(commands::plan::PlanCommands),

    #[command(subcommand, about = "Manage jobs")]
    Job(commands::job::JobCommands),

    #[command(subcommand, about = "Manage chat sessions and execution")]
    Chat(commands::chat::ChatCommands),

    #[command(subcommand, about = "Manage projects")]
    Project(commands::project::ProjectCommands),

    #[command(subcommand, about = "Manage team configuration vaults")]
    Vault(commands::vault::VaultCommands),

    // Top-level rather than `project analyzer`, because the promptwares call
    // `tendril project-analyzer <path>`.
    #[command(
        name = "project-analyzer",
        about = "Print a trimmed YAML stack report for a folder"
    )]
    ProjectAnalyzer {
        #[arg(value_name = "FOLDERPATH")]
        folder: String,
    },

    #[command(subcommand, about = "Manage verification definitions")]
    Verification(commands::verification::VerificationCommands),

    #[command(subcommand, about = "Author and preview plan wireframes")]
    Wireframe(commands::wireframe::WireframeCommands),

    #[command(subcommand, about = "Manage promptwares")]
    Promptware(commands::promptware::PromptwareCommands),

    #[command(subcommand, about = "Tendril configuration")]
    Config(commands::config::ConfigCommands),

    #[command(about = "Check system health")]
    Doctor {
        #[arg(
            long,
            help = "Rebuild the plan full-text search index from the Plans table"
        )]
        rebuild_search_index: bool,
    },

    #[command(about = "Show version")]
    Version,

    #[command(about = "List available models and pricing")]
    Models {
        #[arg(
            long,
            help = "Fetch live model updates and pricing from models.dev before printing"
        )]
        refresh: bool,
    },

    #[command(about = "Start the Tendril HTTP & WebSocket API server")]
    Serve {
        #[arg(short, long, default_value = "5010")]
        port: u16,

        #[arg(long, default_value = "127.0.0.1")]
        host: String,

        #[arg(
            long,
            value_name = "PATH",
            requires = "tls_key",
            help = "PEM certificate; serves HTTPS instead of HTTP (see `tendril generate-certs`)"
        )]
        tls_cert: Option<PathBuf>,

        #[arg(
            long,
            value_name = "PATH",
            requires = "tls_cert",
            help = "PEM private key matching --tls-cert"
        )]
        tls_key: Option<PathBuf>,
    },

    #[command(
        about = "Start the Tendril daemon, migrating the database and checking the port first"
    )]
    Run {
        #[arg(short, long, help = "Port to listen on (default: 5010)")]
        port: Option<u16>,

        #[arg(long, default_value = "127.0.0.1")]
        host: String,
    },

    #[command(about = "Run Model Context Protocol (MCP) server over stdio")]
    Mcp,

    #[command(subcommand, about = "Inspect and maintain the Tendril database")]
    Db(commands::db::DbCommands),

    #[command(about = "Delete the Tendril home and plans directories")]
    Reset(commands::reset::ResetArgs),

    #[command(about = "Update Tendril to the latest version")]
    Update(commands::update::UpdateArgs),

    #[command(about = "Refresh deployed promptwares, preserving their Memory/ and Tools/")]
    UpdatePromptwares(commands::update_promptwares::UpdatePromptwaresArgs),

    #[command(
        about = "Hash a password for config.yaml's auth block",
        long_about = "Hashes PASSWORD with Argon2i and prints the encoded hash plus the secret \
(pepper) it was hashed with.\n\nThe pepper is NOT part of the hash string, so both values have to \
be stored: the hash as `auth.password` and the pepper as `auth.hashSecret` in config.yaml. Pass \
SECRET to reuse an existing pepper; omit it to generate a new 32-byte one."
    )]
    HashPassword {
        #[arg(value_name = "PASSWORD")]
        password: String,

        #[arg(value_name = "SECRET")]
        secret: Option<String>,
    },

    #[command(
        name = "agent-instructions",
        about = "Print the instructions for a coding agent in a chat session",
        long_about = "Prints the instructions given to a coding agent running in an interactive \
chat session, with this installation's paths substituted in.\n\nThe output is the compiled template \
only, with no trailing newline, so it can be piped straight into an agent's system prompt."
    )]
    AgentInstructions,

    #[command(
        name = "generate-certs",
        about = "Generate a self-signed localhost certificate for `serve --tls-cert`",
        long_about = "Writes a self-signed `localhost.crt` / `localhost.key` PEM pair into \
OUTPUT_DIR, valid for localhost, 127.0.0.1 and ::1.\n\nThis is a PEM pair, not the PKCS#12 `.pfx` \
bundle earlier versions wrote: it is what `tendril serve --tls-cert/--tls-key` reads. The \
certificate is self-signed, so clients have to be told to trust it."
    )]
    GenerateCerts {
        #[arg(value_name = "OUTPUT_DIR")]
        output_dir: PathBuf,
    },

    #[command(
        name = "report-bug",
        about = "Bundle a plan or job's diagnostics into a zip",
        long_about = "Collects a plan's files and its jobs' artifacts, plus a health report, a \
sanitized copy of config.yaml and a manifest of the plan's worktrees, and writes them to a zip.\n\n\
The report is written locally and goes nowhere else unless both --submit and --yes are given, \
because submitting attaches the bundle to a public GitHub issue. Secrets are stripped from the \
config, the health report and every job artifact; plan files are included as they are."
    )]
    ReportBug(commands::report_bug::ReportBugArgs),
}

/// The log filter used when `RUST_LOG` says nothing.
///
/// `warn` globally so a dependency cannot bury the output, `info` for Tendril's own crates so
/// `tendril serve` has a diagnostic log worth reading. Anything more selective belongs in `RUST_LOG`,
/// which overrides this entirely.
const DEFAULT_LOG_FILTER: &str = "warn,tendril_cli=info,tendril_core=info,tendril_server=info";

/// Installs the process-wide log subscriber, on **stderr**.
///
/// Without this, every `tracing::{info,warn,error}!` in the daemon and the CLI went nowhere: only
/// `tendril mcp` and the separate `tendril-server` binary ever installed a subscriber, so
/// `tendril serve` — the documented way to run the daemon — was silent even under `RUST_LOG=debug`.
///
/// stderr, never stdout: `mcp` speaks JSON-RPC on stdout, `project-analyzer` writes a YAML report
/// there, and the daemon's own user-visible lines are `println!`. A log line on stdout would corrupt
/// all three. `try_init` rather than `init` because `mcp` installs its own stricter subscriber and
/// must stay able to do so without panicking.
fn init_logging() {
    use tracing_subscriber::EnvFilter;

    let _ = tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER)),
        )
        .try_init();
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let tendril_home = cli.home.unwrap_or_else(get_default_tendril_home);

    // Before any command runs, so nothing it logs is lost.
    if !matches!(cli.command, Commands::Mcp) {
        init_logging();
    }

    // Boxed, because this match is one future whose size is the sum of every arm's locals. With
    // this many subcommands that exceeds the 1 MB main-thread stack Windows gives a process, and a
    // debug build of `tendril` overflowed before reaching any command - `tendril version` included.
    // Boxing moves the state to the heap and leaves main's own frame small. Release builds lay the
    // future out more tightly, which is why this only ever showed up locally.
    Box::pin(dispatch(cli.command, tendril_home)).await
}

async fn dispatch(command: Commands, tendril_home: PathBuf) -> anyhow::Result<()> {
    let tendril_home = &tendril_home;
    match command {
        Commands::Plan(cmd) => commands::plan::handle_plan_command(cmd, tendril_home).await?,
        Commands::Job(cmd) => commands::job::handle_job_command(cmd, tendril_home).await?,
        Commands::Chat(cmd) => commands::chat::handle_chat_command(cmd, tendril_home).await?,
        Commands::Project(cmd) => {
            commands::project::handle_project_command(cmd, tendril_home).await?
        }
        Commands::Vault(cmd) => commands::vault::handle_vault_command(cmd, tendril_home).await?,
        Commands::ProjectAnalyzer { folder } => {
            commands::project_analyzer::handle_project_analyzer(&folder)?
        }
        Commands::Verification(cmd) => {
            commands::verification::handle_verification_command(cmd, tendril_home).await?
        }
        Commands::Wireframe(cmd) => commands::wireframe::handle_wireframe(cmd).await?,
        Commands::Promptware(cmd) => {
            commands::promptware::handle_promptware_command(cmd, tendril_home).await?
        }
        Commands::Config(cmd) => commands::config::handle_config_command(cmd, tendril_home)?,
        Commands::Doctor {
            rebuild_search_index,
        } => commands::doctor::handle_doctor(tendril_home, rebuild_search_index)?,
        Commands::Version => println!("tendril v{}", env!("CARGO_PKG_VERSION")),
        Commands::Models { refresh } => {
            commands::models::handle_models(refresh, tendril_home).await?
        }
        Commands::Serve {
            port,
            host,
            tls_cert,
            tls_key,
        } => {
            commands::serve::handle_serve(tendril_home, port, Some(host), tls_cert, tls_key).await?
        }
        Commands::Run { port, host } => {
            commands::run::handle_run(tendril_home, port.unwrap_or(5010), host).await?
        }
        Commands::Mcp => commands::mcp::handle_mcp(tendril_home).await?,
        Commands::Db(cmd) => commands::db::handle_db_command(cmd, tendril_home)?,
        Commands::Reset(args) => commands::reset::handle_reset(args, tendril_home)?,
        Commands::Update(args) => commands::update::handle_update(args).await?,
        Commands::UpdatePromptwares(args) => {
            commands::update_promptwares::handle_update_promptwares(args, tendril_home)?
        }
        Commands::HashPassword { password, secret } => {
            commands::hash_password::handle_hash_password(&password, secret.as_deref())?
        }
        Commands::AgentInstructions => {
            commands::agent_instructions::handle_agent_instructions(tendril_home)?
        }
        Commands::GenerateCerts { output_dir } => {
            commands::generate_certs::handle_generate_certs(&output_dir)?
        }
        Commands::ReportBug(args) => {
            commands::report_bug::handle_report_bug(args, tendril_home).await?
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Cli;
    use clap::{CommandFactory, Parser};
    use tendril_core::agents::instructions;

    /// Every `tendril ...` invocation the agent instructions document must name a command that
    /// actually exists. The asset is the only description of the CLI the chat agent gets, so a
    /// renamed or dropped subcommand has to fail here rather than in a chat session.
    #[test]
    fn every_command_the_instructions_document_exists() {
        let root = Cli::command();
        let mut checked = 0usize;

        for snippet in code_snippets(instructions::TEMPLATE) {
            for invocation in snippet.split("tendril ").skip(1) {
                let mut node = &root;
                for token in invocation.split_whitespace() {
                    // Placeholders (`<plan-id>`), flags, literal job types (`CreatePlan`) and
                    // ordinary prose all end the command path.
                    if !token
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                    {
                        break;
                    }
                    // A leaf command's arguments can look like subcommand names — `tendril config
                    // get planTemplate` — so stop as soon as there is nothing left to descend into.
                    if node.get_subcommands().next().is_none() {
                        break;
                    }
                    let found = node.get_subcommands().find(|c| c.get_name() == token);
                    node = found.unwrap_or_else(|| {
                        panic!(
                            "the agent instructions name `{}`, but `{}` has no `{}` subcommand",
                            invocation.trim(),
                            node.get_name(),
                            token
                        )
                    });
                    checked += 1;
                }
            }
        }

        assert!(
            checked > 100,
            "only {checked} command tokens were checked — the snippet extraction is broken"
        );
    }

    /// Every `tendril ...` command line the README documents has to parse against this CLI.
    ///
    /// Issue #137: the README's "Run" section documented a bare `tendril` and `tendril --web` as the
    /// way to launch Tendril, and neither existed — `command: Commands` is not `Option<Commands>`, so
    /// a bare invocation is a clap `MissingSubcommand`, and there has never been a `--web` flag. The
    /// first command a new user copied out of the README failed. Nothing checked, so nothing caught
    /// it; this is that check.
    #[test]
    fn every_tendril_command_in_the_readme_parses() {
        const README: &str =
            include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../README.md"));

        let mut checked = 0usize;
        for line in readme_invocations(README) {
            let rest = line.strip_prefix("tendril").expect("filtered above");
            let args: Vec<&str> = std::iter::once("tendril")
                .chain(rest.split_whitespace())
                .collect();
            match Cli::try_parse_from(&args) {
                Ok(_) => {}
                // `--help`/`--version` "fail" by printing; both are real, working invocations.
                Err(e)
                    if matches!(
                        e.kind(),
                        clap::error::ErrorKind::DisplayHelp
                            | clap::error::ErrorKind::DisplayVersion
                            | clap::error::ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
                    ) => {}
                Err(e) => panic!(
                    "the README documents `{}`, which this CLI rejects:\n{}",
                    line, e
                ),
            }
            checked += 1;
        }

        assert!(
            checked >= 3,
            "only {checked} `tendril` command lines were found in the README — the snippet \
             extraction is broken, so this test is not checking anything"
        );
    }

    /// The `tendril ...` command lines a reader would copy out of the README.
    ///
    /// A fenced code block is taken line by line, whatever it says — a bare `tendril` on a line of
    /// its own in a fence is an instruction to run it, and that is exactly the case in issue #137. An
    /// inline span is only taken when it carries arguments, because prose naming the binary
    /// (`` the `tendril` CLI ``) is not an invocation.
    fn readme_invocations(markdown: &str) -> Vec<String> {
        let mut invocations = Vec::new();
        let mut in_fence = false;

        let is_invocation = |candidate: &str| {
            // `tendril-app`, `tendril-docs`, `ivy-tendril` and the like are other things entirely.
            candidate == "tendril" || candidate.starts_with("tendril ")
        };

        for line in markdown.lines() {
            if line.trim_start().starts_with("```") {
                in_fence = !in_fence;
                continue;
            }
            if in_fence {
                let candidate = line.trim();
                if is_invocation(candidate) {
                    invocations.push(candidate.to_string());
                }
                continue;
            }
            let mut parts = line.split('`');
            parts.next();
            while let Some(span) = parts.next() {
                let candidate = span.trim();
                if candidate.contains(' ') && is_invocation(candidate) {
                    invocations.push(candidate.to_string());
                }
                parts.next();
            }
        }

        invocations
    }

    /// The contents of every inline code span and fenced code block, which is where the document
    /// spells out commands. Prose is skipped: `` `tendril plan` CLI commands `` would otherwise look
    /// like a `plan commands` invocation.
    fn code_snippets(markdown: &str) -> Vec<String> {
        let mut snippets = Vec::new();
        let mut in_fence = false;

        for line in markdown.lines() {
            if line.trim_start().starts_with("```") {
                in_fence = !in_fence;
                continue;
            }
            if in_fence {
                snippets.push(line.to_string());
                continue;
            }
            // Inline spans, taken in pairs of backticks.
            let mut parts = line.split('`');
            parts.next();
            while let Some(span) = parts.next() {
                snippets.push(span.to_string());
                parts.next();
            }
        }

        snippets
    }
}
