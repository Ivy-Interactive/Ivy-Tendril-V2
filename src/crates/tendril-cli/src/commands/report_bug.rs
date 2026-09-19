use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use clap::Args;
use regex::Regex;
use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tendril_core::config::{get_config_path, get_plans_dir, load_config};
use tendril_core::git::enumerate_worktree_directories;
use tendril_core::health;
use tendril_core::jobs::logger::find_log_file;
use tendril_core::plans::helpers::resolve_plan_folder;

const BUG_REPORT_API_URL: &str = "https://tendril-api.ivy.app/report-bug";
const REDACTED: &str = "[REDACTED]";

/// The artifacts a job leaves behind, in the order they are most useful to read.
const JOB_ARTIFACT_SUFFIXES: [&str; 4] = [".md", ".prompt.md", ".raw.jsonl", ".eventwire.jsonl"];

#[derive(Args)]
// There is nothing to report on without one of the two, and saying so as a group makes clap ask for
// "one of" rather than listing both as missing.
#[command(group(
    clap::ArgGroup::new("subject").required(true).multiple(true).args(["plan", "job"])
))]
pub struct ReportBugArgs {
    #[arg(long, value_name = "ID", help = "Plan ID to include in the report")]
    pub plan: Option<String>,

    #[arg(long, value_name = "ID", help = "Job ID to include in the report")]
    pub job: Option<String>,

    #[arg(
        short,
        long,
        value_name = "TEXT",
        help = "Bug description; read from stdin when stdin is not a terminal"
    )]
    pub description: Option<String>,

    #[arg(
        long,
        value_name = "PATH",
        help = "Where to write the zip (default: <TendrilHome>/bug-report-<timestamp>.zip)"
    )]
    pub out: Option<PathBuf>,

    #[arg(
        long,
        value_name = "NAME",
        help = "Your GitHub username, so the issue can be followed up with you"
    )]
    pub github_user: Option<String>,

    #[arg(
        long,
        help = "Upload the report; without this the zip is only written locally"
    )]
    pub submit: bool,

    #[arg(
        short = 'y',
        long,
        help = "Confirm the upload. --submit does nothing without it"
    )]
    pub yes: bool,
}

/// Where a bundle entry's bytes come from. `Disk` files are zipped straight from their path;
/// `Synthesized` bodies are either generated here (`doctor.txt`, `metadata.txt`) or a redacted copy
/// of something on disk, which is why the two cases cannot be collapsed into one.
pub(crate) enum EntryBody {
    Disk(PathBuf),
    Synthesized(Vec<u8>),
}

pub(crate) struct BundleEntry {
    /// The path inside the zip, always forward-slashed.
    pub path: String,
    pub body: EntryBody,
}

impl BundleEntry {
    fn synthesized(path: &str, body: impl Into<Vec<u8>>) -> Self {
        BundleEntry {
            path: path.to_string(),
            body: EntryBody::Synthesized(body.into()),
        }
    }

    /// The size the size table reports. A file that cannot be stat'd counts as zero rather than
    /// aborting the report; it is a diagnostic bundle, not a backup.
    fn size(&self) -> u64 {
        match &self.body {
            EntryBody::Disk(path) => std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            EntryBody::Synthesized(bytes) => bytes.len() as u64,
        }
    }
}

pub async fn handle_report_bug(args: ReportBugArgs, tendril_home: &Path) -> Result<()> {
    let plans_dir = get_plans_dir(tendril_home);

    // Only submission needs a description — a local zip is attached to an issue by hand, with the
    // description typed there — so asking for one before writing the zip would be pure friction.
    let description = if args.submit {
        Some(resolve_description(args.description.as_deref())?)
    } else {
        args.description
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(str::to_string)
    };

    let entries = collect_entries(
        tendril_home,
        &plans_dir,
        args.plan.as_deref(),
        args.job.as_deref(),
        description.as_deref(),
    )?;
    if entries.is_empty() {
        bail!("No files found to include in the report.");
    }

    print!("{}", file_table(&entries));

    let out = args
        .out
        .unwrap_or_else(|| default_out_path(tendril_home, Utc::now()));
    write_zip(&entries, &out)?;
    println!("\nWrote {}", out.display());

    if !args.submit {
        println!("Local report only. Add --submit --yes to upload it.");
        return Ok(());
    }

    print!("{}", public_issue_warning());

    if !args.yes {
        println!("Not uploaded: --submit needs --yes to confirm.");
        return Ok(());
    }

    println!("Uploading bug report...");
    let agent = load_config(&get_config_path(tendril_home))
        .map(|c| c.coding_agent)
        .unwrap_or_default();
    let issue_url = upload(
        &out,
        description.as_deref().unwrap_or_default(),
        args.github_user.as_deref(),
        &agent,
    )
    .await?;

    println!("\nBug report submitted successfully!");
    println!("{}", issue_url);
    Ok(())
}

/// V1's warning, kept because it is the whole reason `--submit` is opt-in: the attachments end up on
/// a public issue tracker.
fn public_issue_warning() -> String {
    "\nWarning: These files will be attached to a public GitHub issue.\n\
     If this project contains sensitive data, consider reporting via another channel.\n"
        .to_string()
}

/// The description, from `--description` or from stdin when stdin is a pipe. There is no interactive
/// prompt: nothing else in this CLI reads a line from a TTY.
fn resolve_description(provided: Option<&str>) -> Result<String> {
    if let Some(text) = provided {
        if !text.trim().is_empty() {
            return Ok(text.trim().to_string());
        }
    }

    if std::io::stdin().is_terminal() {
        bail!("--description is required, or pipe the description in on stdin");
    }

    let mut piped = String::new();
    std::io::stdin()
        .read_to_string(&mut piped)
        .context("reading the description from stdin")?;
    if piped.trim().is_empty() {
        bail!("--description is required, or pipe the description in on stdin");
    }
    Ok(piped.trim().to_string())
}

pub(crate) fn collect_entries(
    tendril_home: &Path,
    plans_dir: &Path,
    plan: Option<&str>,
    job: Option<&str>,
    description: Option<&str>,
) -> Result<Vec<BundleEntry>> {
    let mut plan_folders: Vec<PathBuf> = Vec::new();
    let mut job_ids: Vec<String> = Vec::new();

    if let Some(plan_ref) = plan {
        let folder = resolve_plan_folder(plan_ref, plans_dir)?;
        job_ids.extend(job_ids_for_plan(tendril_home, &folder));
        plan_folders.push(folder);
    }

    if let Some(job_ref) = job {
        let normalized = normalize_job_id(job_ref);
        // The plan a job belongs to is what makes a job report readable on its own.
        if let Some(folder) = plan_folder_for_job(tendril_home, plans_dir, &normalized) {
            plan_folders.push(folder);
        }
        job_ids.push(normalized);
    }

    let mut entries: Vec<BundleEntry> = Vec::new();

    for folder in dedupe(plan_folders) {
        collect_plan_files(&folder, &mut entries);
        if let Some(manifest) = worktrees_manifest(&folder) {
            entries.push(manifest);
        }
    }

    for job_id in dedupe(job_ids) {
        collect_job_files(tendril_home, &job_id, &mut entries);
    }

    entries.push(BundleEntry::synthesized(
        "doctor.txt",
        redact_secret_shapes(&doctor_text(tendril_home)),
    ));

    if let Some(config) = sanitized_config(tendril_home) {
        entries.push(BundleEntry::synthesized("config.sanitized.yaml", config));
    }

    entries.push(BundleEntry::synthesized(
        "metadata.txt",
        metadata_text(tendril_home, Utc::now()),
    ));

    if let Some(text) = description {
        entries.push(BundleEntry::synthesized("description.txt", text));
    }

    dedupe_entries(&mut entries);
    Ok(entries)
}

fn dedupe<T: Clone + PartialEq>(items: Vec<T>) -> Vec<T> {
    let mut unique: Vec<T> = Vec::new();
    for item in items {
        if !unique.contains(&item) {
            unique.push(item);
        }
    }
    unique
}

/// Zip entry paths have to be unique, and a report for a plan *and* one of its own jobs collects the
/// same files twice. First one wins.
fn dedupe_entries(entries: &mut Vec<BundleEntry>) {
    let mut seen: Vec<String> = Vec::new();
    entries.retain(|entry| {
        if seen.contains(&entry.path) {
            return false;
        }
        seen.push(entry.path.clone());
        true
    });
}

/// Every file in the plan folder except the worktrees, which are working copies of repositories that
/// are already on the reporter's disk and would dwarf everything else in the bundle.
fn collect_plan_files(plan_folder: &Path, entries: &mut Vec<BundleEntry>) {
    // `WalkDir` hands each directory back in whatever order the filesystem gives it - APFS returns
    // these sorted, ext4 does not - and these entries become both the `File | Size` table printed
    // before the upload and the order of the members inside the zip, so two reports on the same
    // plan have to read the same way whoever ran them.
    let walker = walkdir::WalkDir::new(plan_folder)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|entry| !is_worktrees_dir(entry));

    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(plan_folder) else {
            continue;
        };
        entries.push(BundleEntry {
            path: zip_path(relative),
            body: EntryBody::Disk(entry.path().to_path_buf()),
        });
    }
}

fn is_worktrees_dir(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0
        && entry.file_type().is_dir()
        && entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case("Worktrees")
}

/// Every artifact a job produced. The bodies are read and passed through the value-shape pass rather
/// than zipped from disk: an agent log echoes the commands it ran and the output it saw, so a key
/// pasted into a prompt or printed by a tool lands here under no key name at all.
fn collect_job_files(tendril_home: &Path, job_id: &str, entries: &mut Vec<BundleEntry>) {
    for suffix in JOB_ARTIFACT_SUFFIXES {
        let Some(path) = find_log_file(tendril_home, job_id, suffix) else {
            continue;
        };
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        match std::fs::read_to_string(&path) {
            Ok(text) => entries.push(BundleEntry::synthesized(
                &format!("Jobs/{}", name),
                redact_secret_shapes(&text),
            )),
            // Not readable as text means it cannot be scanned for secrets, so it is left out
            // entirely rather than shipped unredacted.
            Err(e) => eprintln!("Skipping job artifact {} ({})", path.display(), e),
        }
    }
}

/// `worktrees.txt`: what each of the plan's worktrees actually points at. This is the identity needed
/// to spot a repo or branch mismatch without bundling the trees themselves.
fn worktrees_manifest(plan_folder: &Path) -> Option<BundleEntry> {
    let worktrees_dir = plan_folder.join("Worktrees");
    let dirs = enumerate_worktree_directories(&worktrees_dir);
    if dirs.is_empty() {
        return None;
    }

    let mut text = String::new();
    for dir in dirs {
        let relative = dir.strip_prefix(&worktrees_dir).unwrap_or(&dir);
        text.push_str(&format!("{}\n", zip_path(relative)));
        text.push_str(&format!(
            "  remote: {}\n",
            git_field(&dir, &["remote", "get-url", "origin"])
        ));
        text.push_str(&format!(
            "  branch: {}\n",
            git_field(&dir, &["rev-parse", "--abbrev-ref", "HEAD"])
        ));
        text.push_str(&format!(
            "  HEAD:   {}\n\n",
            git_field(&dir, &["rev-parse", "HEAD"])
        ));
    }

    Some(BundleEntry::synthesized("worktrees.txt", text))
}

fn git_field(working_dir: &Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .current_dir(working_dir)
        .args(args)
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if value.is_empty() {
                "(unknown)".to_string()
            } else {
                value
            }
        }
        _ => "(unknown)".to_string(),
    }
}

fn doctor_text(tendril_home: &Path) -> String {
    let mut text = health::run_checks(tendril_home)
        .into_iter()
        .map(|check| format!("[{}] {}", check.status.tag(), check.message))
        .collect::<Vec<_>>()
        .join("\n");
    text.push('\n');
    text
}

fn metadata_text(tendril_home: &Path, now: DateTime<Utc>) -> String {
    let agent = load_config(&get_config_path(tendril_home))
        .map(|c| c.coding_agent)
        .unwrap_or_default();
    format!(
        "Tendril version: {}\nOS: {} {}\nCoding agent: {}\nGenerated: {}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        agent,
        now.to_rfc3339()
    )
}

/// `config.yaml` with its secrets taken out, or `None` when there is nothing safe to include.
///
/// The file is read from disk rather than through the loaded settings so that `%VAR%` references stay
/// literal instead of being resolved to the values they name.
fn sanitized_config(tendril_home: &Path) -> Option<String> {
    let path = get_config_path(tendril_home);
    let raw = std::fs::read_to_string(path).ok()?;
    redact_config_yaml(&raw)
}

/// `config.yaml` with every secret replaced by `[REDACTED]`, or `None` when the config cannot be
/// read or parsed.
///
/// Failing closed matters more here than elsewhere: a bug report can end up on a public issue, and a
/// config that does not parse is exactly the config whose contents nobody has looked at. Two passes
/// run over it, because either one alone leaks: the key-name pass cannot see a credential filed under
/// an innocuous name, and the value-shape pass cannot see a password that looks like a word.
pub(crate) fn redact_config_yaml(raw: &str) -> Option<String> {
    let mut tree: serde_yaml::Value = serde_yaml::from_str(&quote_variable_references(raw)).ok()?;
    redact_secret_keys(&mut tree, false);
    let serialized = serde_yaml::to_string(&tree).ok()?;
    Some(redact_secret_shapes(&serialized))
}

/// Quotes `%VAR%` values so YAML will parse them: `%` opens a directive, so a plain scalar cannot
/// start with one. A config written that way does not load in Tendril either, but that is exactly the
/// config someone files a bug about, and it can still be sanitized and included.
fn quote_variable_references(yaml: &str) -> String {
    static PATTERNS: OnceLock<[Regex; 2]> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            // `key: %VAR%/rest`
            Regex::new(r"(?m)^([^:\n]*:[ \t]+)(%\w+%.*)$").unwrap(),
            // `- %VAR%/rest`
            Regex::new(r"(?m)^(\s*-[ \t]+)(%\w+%.*)$").unwrap(),
        ]
    });

    let mut quoted = yaml.to_string();
    for pattern in patterns {
        quoted = pattern.replace_all(&quoted, "$1'$2'").into_owned();
    }
    quoted
}

/// Key names whose value is a secret. Compared with `-` and `_` stripped and case folded, and matched
/// as a suffix, so `hashSecret`, `hash_secret` and `AUTH-SECRET` all hit `secret`.
const SECRET_KEY_SUFFIXES: [&str; 11] = [
    "password",
    "hashsecret",
    "secret",
    "apikey",
    "token",
    "accesstoken",
    "refreshtoken",
    "clientsecret",
    "privatekey",
    "credential",
    "passphrase",
];

/// Mapping names whose values are all secrets regardless of their own names: an agent's environment
/// block is where API keys are configured, and the variable names are the agent's own.
const REDACT_EVERY_VALUE_MAPPINGS: [&str; 2] = ["environmentvariables", "env"];

fn redact_secret_keys(value: &mut serde_yaml::Value, redact_every_value: bool) {
    match value {
        serde_yaml::Value::Mapping(map) => {
            let keys: Vec<serde_yaml::Value> = map.keys().cloned().collect();
            for key in keys {
                let name = key.as_str().map(normalize_key).unwrap_or_default();
                let Some(entry) = map.get_mut(&key) else {
                    continue;
                };
                if redact_every_value || is_secret_key(&name) {
                    // Replacing the whole subtree, not just scalars: `auth: {password: {...}}` is
                    // malformed config, but it must not become a way through.
                    *entry = serde_yaml::Value::String(REDACTED.to_string());
                    continue;
                }
                redact_secret_keys(entry, REDACT_EVERY_VALUE_MAPPINGS.contains(&name.as_str()));
            }
        }
        serde_yaml::Value::Sequence(items) => {
            for item in items {
                redact_secret_keys(item, redact_every_value);
            }
        }
        _ => {}
    }
}

fn normalize_key(key: &str) -> String {
    key.chars()
        .filter(|c| *c != '-' && *c != '_')
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn is_secret_key(normalized: &str) -> bool {
    SECRET_KEY_SUFFIXES
        .iter()
        .any(|suffix| normalized.ends_with(suffix))
}

/// Text with every recognizable credential shape replaced. Run over the sanitized config, the doctor
/// report and every job artifact, so a key that no key name gives away is still caught.
pub(crate) fn redact_secret_shapes(text: &str) -> String {
    // The userinfo of a remote URL goes first, and by the same rule the daemon clones under, because
    // the shapes below only catch a secret they recognize: a git remote written
    // `https://user:password@host/o/r` carries one that no shape matches, and a job log is full of
    // remote URLs.
    let mut redacted = tendril_core::git::redact_credentials(text);
    for shape in secret_shapes() {
        redacted = shape.replace_all(&redacted, REDACTED).into_owned();
    }
    redacted
}

fn secret_shapes() -> &'static Vec<Regex> {
    static SHAPES: OnceLock<Vec<Regex>> = OnceLock::new();
    SHAPES.get_or_init(|| {
        [
            r"sk-ant-[A-Za-z0-9_-]{16,}",
            r"sk-[A-Za-z0-9_-]{16,}",
            r"gh[pousr]_[A-Za-z0-9]{20,}",
            r"github_pat_[A-Za-z0-9_]{20,}",
            r"xox[baprs]-[A-Za-z0-9-]{10,}",
            r"AKIA[0-9A-Z]{16}",
            r"AIza[0-9A-Za-z_-]{35}",
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
            // The shape of a bearer secret, and of anything else written as a 32-byte hex blob.
            r"\b[0-9a-f]{64}\b",
        ]
        .iter()
        .map(|pattern| Regex::new(pattern).expect("secret shapes are literal patterns"))
        .collect()
    })
}

/// Job ids are five digits; accept an unpadded one the way the rest of the CLI does.
fn normalize_job_id(input: &str) -> String {
    let digits: String = input.chars().filter(|c| c.is_ascii_digit()).collect();
    match digits.parse::<i32>() {
        Ok(number) if digits.len() == input.len() => format!("{:05}", number),
        _ => input.to_string(),
    }
}

/// Every job that touched the plan. Plan-connected jobs carry the plan id in their artifact names; a
/// CreatePlan job does not, so its log is read for the `PlanId` line it records. Without that second
/// pass a plan's report would omit the job that wrote the plan.
fn job_ids_for_plan(tendril_home: &Path, plan_folder: &Path) -> Vec<String> {
    let Some(plan_id) = plan_id_from_folder(plan_folder) else {
        return Vec::new();
    };

    let mut job_ids = Vec::new();
    for path in job_artifacts(tendril_home) {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        let Some(job_id) = name.split('-').next().filter(|id| !id.is_empty()) else {
            continue;
        };

        let named_in_stem = plan_id_from_stem(&name).as_deref() == Some(plan_id.as_str());
        let named_in_log = plan_id_from_stem(&name).is_none()
            && is_job_log(&path)
            && plan_id_from_job_log(&path).as_deref() == Some(plan_id.as_str());

        if named_in_stem || named_in_log {
            job_ids.push(job_id.to_string());
        }
    }

    dedupe(job_ids)
}

/// The plan folder that owns a job, from the plan id in its artifact names or, for a CreatePlan job,
/// from the `PlanId` line in its log.
fn plan_folder_for_job(tendril_home: &Path, plans_dir: &Path, job_id: &str) -> Option<PathBuf> {
    let mut from_log = None;
    for suffix in JOB_ARTIFACT_SUFFIXES {
        let Some(path) = find_log_file(tendril_home, job_id, suffix) else {
            continue;
        };
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if let Some(plan_id) = plan_id_from_stem(&name) {
            return resolve_plan_folder(&plan_id, plans_dir).ok();
        }
        if from_log.is_none() && is_job_log(&path) {
            from_log = plan_id_from_job_log(&path);
        }
    }

    resolve_plan_folder(&from_log?, plans_dir).ok()
}

/// Every job artifact in either of the two directories jobs write to.
fn job_artifacts(tendril_home: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for dir in [
        tendril_home.join("Logs").join("Jobs"),
        tendril_home.join("Jobs"),
    ] {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            found.extend(entries.flatten().map(|e| e.path()).filter(|p| p.is_file()));
        }
    }
    found.sort();
    found
}

fn is_job_log(path: &Path) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    name.ends_with(".md") && !name.ends_with(".prompt.md")
}

/// The plan id in a `<jobId>-<planId>-<type>.*` artifact name, or `None` for the plan-less
/// `<jobId>-<type>.*` form.
fn plan_id_from_stem(file_name: &str) -> Option<String> {
    let parts: Vec<&str> = file_name.split('-').collect();
    let candidate = parts.get(1)?;
    if candidate.len() == 5 && candidate.chars().all(|c| c.is_ascii_digit()) {
        Some(candidate.to_string())
    } else {
        None
    }
}

/// The `- **PlanId:** 00075` line every job log carries.
fn plan_id_from_job_log(path: &Path) -> Option<String> {
    static PLAN_ID_LINE: OnceLock<Regex> = OnceLock::new();
    let pattern =
        PLAN_ID_LINE.get_or_init(|| Regex::new(r"(?m)^-\s*\*\*PlanId:\*\*\s*(\d{5})\s*$").unwrap());
    let text = std::fs::read_to_string(path).ok()?;
    Some(pattern.captures(&text)?[1].to_string())
}

fn plan_id_from_folder(plan_folder: &Path) -> Option<String> {
    let name = plan_folder.file_name()?.to_string_lossy();
    let id: String = name.chars().take(5).collect();
    if id.len() == 5 && id.chars().all(|c| c.is_ascii_digit()) {
        Some(id)
    } else {
        None
    }
}

fn zip_path(relative: &Path) -> String {
    relative.to_string_lossy().replace('\\', "/")
}

/// V1's `File | Size` table, including the total.
fn file_table(entries: &[BundleEntry]) -> String {
    let width = entries
        .iter()
        .map(|e| e.path.chars().count())
        .chain(std::iter::once("Total".len()))
        .max()
        .unwrap_or(4)
        .max("File".len());

    let mut total = 0u64;
    let mut table = format!("{:<width$}  {}\n", "File", "Size", width = width);
    table.push_str(&format!("{}\n", "-".repeat(width + 12)));
    for entry in entries {
        let size = entry.size();
        total += size;
        table.push_str(&format!(
            "{:<width$}  {}\n",
            entry.path,
            format_size(size),
            width = width
        ));
    }
    table.push_str(&format!("{}\n", "-".repeat(width + 12)));
    table.push_str(&format!(
        "{:<width$}  {}\n",
        "Total",
        format_size(total),
        width = width
    ));
    table
}

fn format_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

fn default_out_path(tendril_home: &Path, now: DateTime<Utc>) -> PathBuf {
    tendril_home.join(format!("bug-report-{}.zip", now.format("%Y%m%dT%H%M%SZ")))
}

pub(crate) fn write_zip(entries: &[BundleEntry], out: &Path) -> Result<()> {
    if let Some(parent) = out.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating {}", parent.display()))?;
        }
    }

    let file = std::fs::File::create(out).with_context(|| format!("creating {}", out.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for entry in entries {
        zip.start_file(entry.path.as_str(), options)?;
        match &entry.body {
            EntryBody::Disk(path) => {
                let mut source = std::fs::File::open(path)
                    .with_context(|| format!("reading {}", path.display()))?;
                std::io::copy(&mut source, &mut zip)?;
            }
            EntryBody::Synthesized(bytes) => zip.write_all(bytes)?,
        }
    }

    zip.finish()?;
    Ok(())
}

async fn upload(
    zip_path: &Path,
    description: &str,
    github_user: Option<&str>,
    agent: &str,
) -> Result<String> {
    let bytes =
        std::fs::read(zip_path).with_context(|| format!("reading {}", zip_path.display()))?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("bug-report.zip")
        .mime_str("application/zip")?;

    // No `commitId` part: nothing embeds the build's commit in the V2 binary, and V1 omits the field
    // when its build did not either.
    let mut form = reqwest::multipart::Form::new()
        .text("description", description.to_string())
        .text(
            "osVersion",
            format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        )
        .text("tendrilVersion", env!("CARGO_PKG_VERSION").to_string())
        .text("agent", agent.to_string())
        .part("file", part);

    if let Some(user) = github_user.map(str::trim).filter(|u| !u.is_empty()) {
        form = form.text("githubUser", user.to_string());
    }

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()?
        .post(BUG_REPORT_API_URL)
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        bail!("Bug report upload failed with status {}: {}", status, body);
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)
        .with_context(|| format!("the upload succeeded but returned {}", body))?;
    parsed
        .get("issueUrl")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("the upload returned no issueUrl: {}", body))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{}-{}", name, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Every secret shape this module knows about, with a planted value of that shape.
    fn planted_secrets() -> Vec<(&'static str, String)> {
        vec![
            ("openai", "sk-abcdefghijklmnopqrstuvwx".to_string()),
            (
                "anthropic",
                "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF".to_string(),
            ),
            ("github-classic", format!("ghp_{}", "A1b2C3d4E5f6G7h8I9j0")),
            (
                "github-fine-grained",
                format!("github_pat_{}", "11ABCDE0000abcdefghij"),
            ),
            ("slack", "xoxb-1234567890-abcdefghij".to_string()),
            ("aws", "AKIAIOSFODNN7EXAMPLE".to_string()),
            (
                "google",
                "AIzaSyA1234567890abcdefghijklmnopqrstuvw".to_string(),
            ),
            (
                "private-key",
                "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----"
                    .to_string(),
            ),
            (
                "bearer-secret",
                "1cde84b8345d87525d884ff2175ea8d9fe561ca857c81be07a9d23747d419dc3".to_string(),
            ),
        ]
    }

    fn config_with_secrets() -> String {
        format!(
            r#"codingAgent: claude
planFolder: '%TENDRIL_HOME%/Plans'
auth:
  username: admin
  password: '$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo'
  hashSecret: 'cGVwcGVycGVwcGVycGVwcGVycGVwcGVycGVwcGVy'
llm:
  apiKey: '{anthropic}'
api:
  apiKey: '{openai}'
  bearerSecret: '{bearer}'
codingAgents:
  - id: claude
    environmentVariables:
      ANTHROPIC_API_KEY: '{anthropic}'
      HTTPS_PROXY: 'http://proxy.internal:8080'
notes: 'a key pasted into a comment: {github}'
projects:
  - name: Ivy-Tendril-V2
    repos:
      - path: '%TENDRIL_HOME%/../git/Ivy-Tendril-V2'
"#,
            anthropic = planted_secrets()[1].1,
            openai = planted_secrets()[0].1,
            bearer = planted_secrets()[8].1,
            github = planted_secrets()[2].1,
        )
    }

    #[test]
    fn no_planted_secret_survives_redaction() {
        let out = redact_config_yaml(&config_with_secrets()).expect("the config parses");

        for (name, value) in planted_secrets() {
            if out.contains(&value) {
                panic!("{} leaked into the sanitized config:\n{}", name, out);
            }
        }
        assert!(
            out.contains(REDACTED),
            "nothing was redacted at all:\n{}",
            out
        );
        // The argon2 hash is a password field, so it goes too even though it is not a key shape.
        assert!(
            !out.contains("argon2i"),
            "the password hash leaked:\n{}",
            out
        );
    }

    #[test]
    fn every_secret_shape_is_caught_under_an_innocuous_key() {
        for (name, value) in planted_secrets() {
            let yaml = format!("harmlessLookingKey: |\n  {}\n", value.replace('\n', "\n  "));
            let out = redact_config_yaml(&yaml).expect("the config parses");
            assert!(
                !out.contains(&value),
                "{} survived under a key name that gives nothing away:\n{}",
                name,
                out
            );
        }
    }

    /// A remote URL carries its credentials in the URL itself, where no token shape has to match for
    /// them to be a secret: `https://user:hunter2@host/o/r` is a password in a job log.
    #[test]
    fn a_credential_bearing_remote_url_is_redacted_wherever_it_appears() {
        let out = redact_secret_shapes(
            "Cloning into 'widgets'...\nremote: https://octocat:hunter2@github.com/acme/widgets.git\n",
        );

        assert!(!out.contains("hunter2"), "the password leaked:\n{}", out);
        assert!(!out.contains("octocat"), "the username leaked:\n{}", out);
        assert!(
            out.contains("https://***@github.com/acme/widgets.git"),
            "the URL should survive with only its userinfo gone:\n{}",
            out
        );
        assert!(
            out.contains("Cloning into 'widgets'"),
            "the surrounding log should survive:\n{}",
            out
        );
    }

    #[test]
    fn a_credential_bearing_remote_url_does_not_survive_in_the_sanitized_config() {
        let out = redact_config_yaml(
            "projects:\n  - name: Acme\n    repos:\n      - path: https://octocat:hunter2@github.com/acme/widgets.git\n",
        )
        .expect("the config parses");

        assert!(!out.contains("hunter2"), "the password leaked:\n{}", out);
        assert!(out.contains("github.com/acme/widgets.git"), "{}", out);
    }

    #[test]
    fn every_environment_variable_value_is_redacted_whatever_it_is_called() {
        let out = redact_config_yaml(&config_with_secrets()).expect("the config parses");

        assert!(
            !out.contains("proxy.internal"),
            "an agent's environment block is redacted wholesale, not by key name:\n{}",
            out
        );
        assert!(
            out.contains("ANTHROPIC_API_KEY"),
            "the names stay:\n{}",
            out
        );
    }

    #[test]
    fn ordinary_configuration_survives() {
        let out = redact_config_yaml(&config_with_secrets()).expect("the config parses");

        for kept in [
            "codingAgent",
            "claude",
            "Ivy-Tendril-V2",
            "%TENDRIL_HOME%/Plans",
            "%TENDRIL_HOME%/../git/Ivy-Tendril-V2",
            "admin",
        ] {
            assert!(
                out.contains(kept),
                "{} should have survived redaction:\n{}",
                kept,
                out
            );
        }
    }

    /// The config is read as text rather than through the loaded settings so that a `%VAR%` stays the
    /// reference it was written as. An expanded one would put whatever it names — a token, a path
    /// naming a user — into the bundle.
    #[test]
    fn variable_references_are_not_resolved() {
        let quoted =
            redact_config_yaml("planFolder: '%TENDRIL_HOME%/Plans'\n").expect("the config parses");
        assert!(quoted.contains("%TENDRIL_HOME%/Plans"), "{}", quoted);

        // Unquoted is not loadable YAML, and Tendril itself rejects such a config — but it is worth
        // sanitizing and shipping, because it is what the bug is about.
        let unquoted =
            redact_config_yaml("planFolder: %TENDRIL_HOME%/Plans\nrepos:\n  - %SOME_VAR%/repo\n")
                .expect("an unquoted reference is quoted before parsing");
        assert!(unquoted.contains("%TENDRIL_HOME%/Plans"), "{}", unquoted);
        assert!(unquoted.contains("%SOME_VAR%/repo"), "{}", unquoted);
    }

    #[test]
    fn an_unparseable_config_is_left_out_entirely() {
        assert!(redact_config_yaml("auth:\n  password: 'unterminated\n\t- tab").is_none());

        let home = scratch_dir("tendril-report-bug-bad-config");
        std::fs::write(home.join("config.yaml"), "projects:\n  - name: [unclosed\n").unwrap();
        let plans_dir = home.join("Plans");
        std::fs::create_dir_all(&plans_dir).unwrap();
        let plan_folder = plans_dir.join("00577-Something");
        std::fs::create_dir_all(&plan_folder).unwrap();
        std::fs::write(plan_folder.join("plan.yaml"), "metadata:\n  id: 577\n").unwrap();

        let entries = collect_entries(&home, &plans_dir, Some("00577"), None, None).unwrap();

        assert!(
            !entries.iter().any(|e| e.path == "config.sanitized.yaml"),
            "a config that cannot be parsed cannot be sanitized, so it is not shipped"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_plans_bundle_holds_its_files_but_not_its_worktrees() {
        let home = scratch_dir("tendril-report-bug-collect");
        std::fs::write(home.join("config.yaml"), "codingAgent: claude\n").unwrap();
        let plans_dir = home.join("Plans");
        let plan_folder = plans_dir.join("00577-PortSomething");
        std::fs::create_dir_all(plan_folder.join("Revisions")).unwrap();
        std::fs::create_dir_all(plan_folder.join("Worktrees").join("repo")).unwrap();
        std::fs::write(plan_folder.join("plan.yaml"), "metadata:\n  id: 577\n").unwrap();
        std::fs::write(plan_folder.join("Revisions").join("001.md"), "# Plan\n").unwrap();
        std::fs::write(
            plan_folder.join("Worktrees").join("repo").join("x.txt"),
            "a whole checkout lives here\n",
        )
        .unwrap();

        let entries = collect_entries(&home, &plans_dir, Some("00577"), None, None).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();

        assert!(paths.contains(&"plan.yaml"), "{:?}", paths);
        assert!(paths.contains(&"Revisions/001.md"), "{:?}", paths);
        assert!(paths.contains(&"doctor.txt"), "{:?}", paths);
        assert!(paths.contains(&"config.sanitized.yaml"), "{:?}", paths);
        assert!(paths.contains(&"metadata.txt"), "{:?}", paths);
        assert!(
            !paths.iter().any(|p| p.starts_with("Worktrees")),
            "the worktrees are working copies and stay out: {:?}",
            paths
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_jobs_log_is_zipped_with_its_secrets_removed() {
        let home = scratch_dir("tendril-report-bug-job-log");
        std::fs::write(home.join("config.yaml"), "codingAgent: claude\n").unwrap();
        let plans_dir = home.join("Plans");
        std::fs::create_dir_all(&plans_dir).unwrap();
        let logs = home.join("Logs").join("Jobs");
        std::fs::create_dir_all(&logs).unwrap();
        let leaked = &planted_secrets()[1].1;
        std::fs::write(
            logs.join("03125-00577-ExecutePlan.md"),
            format!(
                "# Job Log\n\n- **PlanId:** 00577\n\nexport KEY={}\n",
                leaked
            ),
        )
        .unwrap();

        let entries = collect_entries(&home, &plans_dir, None, Some("3125"), None).unwrap();
        let zip_path = home.join("bug-report.zip");
        write_zip(&entries, &zip_path).unwrap();

        let mut archive = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
        let mut body = String::new();
        archive
            .by_name("Jobs/03125-00577-ExecutePlan.md")
            .expect("the job log is in the bundle")
            .read_to_string(&mut body)
            .unwrap();

        assert!(
            !body.contains(leaked.as_str()),
            "the log leaked a key: {}",
            body
        );
        assert!(body.contains(REDACTED), "{}", body);
        assert!(body.contains("# Job Log"), "the rest of the log survives");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_job_is_reported_together_with_the_plan_it_belongs_to() {
        let home = scratch_dir("tendril-report-bug-job-plan");
        let plans_dir = home.join("Plans");
        let plan_folder = plans_dir.join("00577-PortSomething");
        std::fs::create_dir_all(&plan_folder).unwrap();
        std::fs::write(plan_folder.join("plan.yaml"), "metadata:\n  id: 577\n").unwrap();
        let logs = home.join("Logs").join("Jobs");
        std::fs::create_dir_all(&logs).unwrap();
        // A CreatePlan job's name carries no plan id, so only its log connects it to the plan.
        std::fs::write(
            logs.join("03120-CreatePlan.md"),
            "# Job Log\n\n- **PlanId:** 00577\n",
        )
        .unwrap();

        let entries = collect_entries(&home, &plans_dir, None, Some("03120"), None).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();

        assert!(paths.contains(&"plan.yaml"), "{:?}", paths);
        assert!(paths.contains(&"Jobs/03120-CreatePlan.md"), "{:?}", paths);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_plan_report_includes_the_job_that_authored_the_plan() {
        let home = scratch_dir("tendril-report-bug-plan-jobs");
        let plans_dir = home.join("Plans");
        let plan_folder = plans_dir.join("00577-PortSomething");
        std::fs::create_dir_all(&plan_folder).unwrap();
        std::fs::write(plan_folder.join("plan.yaml"), "metadata:\n  id: 577\n").unwrap();
        let logs = home.join("Logs").join("Jobs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(
            logs.join("03120-CreatePlan.md"),
            "# Job Log\n\n- **PlanId:** 00577\n",
        )
        .unwrap();
        std::fs::write(logs.join("03125-00577-ExecutePlan.md"), "# Job Log\n").unwrap();
        std::fs::write(
            logs.join("03126-00999-ExecutePlan.md"),
            "# Another plan's job\n",
        )
        .unwrap();

        let entries = collect_entries(&home, &plans_dir, Some("577"), None, None).unwrap();
        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();

        assert!(
            paths.contains(&"Jobs/03125-00577-ExecutePlan.md"),
            "{:?}",
            paths
        );
        assert!(
            paths.contains(&"Jobs/03120-CreatePlan.md"),
            "the CreatePlan job is recovered from its log: {:?}",
            paths
        );
        assert!(
            !paths.contains(&"Jobs/03126-00999-ExecutePlan.md"),
            "another plan's job does not belong here: {:?}",
            paths
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn nothing_is_zipped_twice() {
        let home = scratch_dir("tendril-report-bug-dedupe");
        let plans_dir = home.join("Plans");
        let plan_folder = plans_dir.join("00577-PortSomething");
        std::fs::create_dir_all(&plan_folder).unwrap();
        std::fs::write(plan_folder.join("plan.yaml"), "metadata:\n  id: 577\n").unwrap();
        let logs = home.join("Logs").join("Jobs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(logs.join("03125-00577-ExecutePlan.md"), "# Job Log\n").unwrap();

        let entries =
            collect_entries(&home, &plans_dir, Some("00577"), Some("03125"), None).unwrap();

        let mut paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
        let count = paths.len();
        paths.sort();
        paths.dedup();
        assert_eq!(count, paths.len(), "duplicate zip entries: {:?}", paths);

        // A zip with a repeated entry name is what this guards against, so write one.
        let zip_path = home.join("bug-report.zip");
        write_zip(&entries, &zip_path).unwrap();
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_description_travels_with_the_bundle() {
        let home = scratch_dir("tendril-report-bug-description");
        let plans_dir = home.join("Plans");
        let plan_folder = plans_dir.join("00577-PortSomething");
        std::fs::create_dir_all(&plan_folder).unwrap();
        std::fs::write(plan_folder.join("plan.yaml"), "metadata:\n  id: 577\n").unwrap();

        let entries = collect_entries(
            &home,
            &plans_dir,
            Some("00577"),
            None,
            Some("the daemon stopped answering"),
        )
        .unwrap();

        let description = entries
            .iter()
            .find(|e| e.path == "description.txt")
            .expect("the description is in the bundle");
        match &description.body {
            EntryBody::Synthesized(bytes) => {
                assert_eq!(bytes, b"the daemon stopped answering")
            }
            EntryBody::Disk(_) => panic!("the description is synthesized"),
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn worktree_identities_are_recorded_without_the_trees() {
        let home = scratch_dir("tendril-report-bug-worktrees");
        let plan_folder = home.join("Plans").join("00577-PortSomething");
        let worktree = plan_folder.join("Worktrees").join("repo");
        std::fs::create_dir_all(&worktree).unwrap();
        // `enumerate_worktree_directories` looks for the `.git` a worktree has.
        std::fs::write(worktree.join(".git"), "gitdir: /nowhere\n").unwrap();

        let manifest = worktrees_manifest(&plan_folder).expect("one worktree was found");
        let text = match manifest.body {
            EntryBody::Synthesized(bytes) => String::from_utf8(bytes).unwrap(),
            EntryBody::Disk(_) => panic!("the manifest is synthesized"),
        };

        assert_eq!(manifest.path, "worktrees.txt");
        assert!(text.starts_with("repo\n"), "{}", text);
        // Git cannot answer for a fabricated worktree, and every field says so rather than failing.
        assert_eq!(text.matches("(unknown)").count(), 3, "{}", text);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn sizes_are_formatted_v1s_way() {
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(1023), "1023 B");
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1024 * 1024 - 1), "1024.0 KB");
        assert_eq!(format_size(1024 * 1024), "1.0 MB");
        assert_eq!(format_size(3 * 1024 * 1024 + 512 * 1024), "3.5 MB");
    }

    #[test]
    fn the_table_totals_the_entries() {
        let entries = vec![
            BundleEntry::synthesized("doctor.txt", "x".repeat(2048)),
            BundleEntry::synthesized("metadata.txt", "y".repeat(1024)),
        ];

        let table = file_table(&entries);

        assert!(table.starts_with("File"), "{}", table);
        assert!(table.contains("doctor.txt    2.0 KB"), "{}", table);
        assert!(table.contains("Total         3.0 KB"), "{}", table);
    }

    #[test]
    fn an_unpadded_job_id_is_accepted() {
        assert_eq!(normalize_job_id("3125"), "03125");
        assert_eq!(normalize_job_id("03125"), "03125");
        // Not a number: left alone rather than mangled into one.
        assert_eq!(normalize_job_id("03125-ExecutePlan"), "03125-ExecutePlan");
    }

    #[test]
    fn a_missing_description_is_an_error_rather_than_a_prompt() {
        assert!(resolve_description(Some("a real description")).is_ok());
        // Whitespace is no description at all; with no terminal this reads stdin, which under the
        // test harness is empty, so either branch has to refuse it.
        assert!(resolve_description(Some("   ")).is_err());
    }

    #[test]
    fn the_default_output_path_is_stamped() {
        let now = DateTime::parse_from_rfc3339("2026-09-14T13:29:49Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            default_out_path(Path::new("/home/.tendril"), now),
            PathBuf::from("/home/.tendril/bug-report-20260914T132949Z.zip")
        );
    }
}
