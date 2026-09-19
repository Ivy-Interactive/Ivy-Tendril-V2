//! Per-agent rate-limit windows: how much of a provider's quota is left, and when it resets.
//!
//! This is the daemon half of V1's usage strip — the pair of progress bars
//! `Apps/Settings/Views/CodingAgentSetupView.cs:280-325` draws above the profile models. It answers
//! one question the model catalogue cannot: whether launching a fleet right now would actually do
//! any work, or whether it would burn an hour producing nothing because the weekly window is spent.
//!
//! Only three providers expose usage at all, which is why V1 has exactly three
//! `IAgentUsageProvider` implementations and no more. Gemini, Copilot and OpenCode publish nothing
//! an operator could read, so [`agent_usage`] returns `None` for them and the strip simply does not
//! appear — that absence is parity, not a gap.
//!
//! Each provider is read a different way because each one publishes it a different way: Claude over
//! an authenticated HTTP endpoint, Codex out of the session transcripts it writes to disk,
//! Antigravity through its own CLI. None of them is a general API; all three are what that vendor
//! happens to expose.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::agents::probe::run_probe;
use crate::agents::resolution::normalize_agent_name;
use crate::config::dirs_home;

/// One provider rate-limit window, e.g. "five hours" or "seven days".
///
/// V1 `Abstractions/AgentUsageWindow`. `used_percent` and `remaining_percent` are stored rather than
/// derived because the three providers report opposite halves of the same number — Claude sends a
/// utilization, Antigravity sends a remaining fraction — and each is clamped against the other on
/// the way in, so a provider reporting 103% cannot produce a negative bar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageWindow {
    /// The window's length in minutes: 300 for five hours, 10080 for a week.
    pub window_minutes: u32,
    pub used_percent: f64,
    pub remaining_percent: f64,
    /// Tokens spent in the window, where the provider reports them. None of the three currently do.
    pub total_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    /// When the window rolls over, as an RFC 3339 timestamp.
    pub resets_at: Option<String>,
}

impl AgentUsageWindow {
    /// A window from the half a provider reports, with the other half derived and both clamped.
    fn from_used(window_minutes: u32, used_percent: f64, resets_at: Option<String>) -> Self {
        let used = used_percent.clamp(0.0, 100.0);
        Self {
            window_minutes,
            used_percent: used,
            remaining_percent: 100.0 - used,
            total_tokens: None,
            cost_usd: None,
            resets_at,
        }
    }
}

/// Every window for one agent, as of one moment.
///
/// V1 `Abstractions/AgentUsageSnapshot`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageSnapshot {
    pub agent_id: String,
    pub windows: Vec<AgentUsageWindow>,
    /// When this was read from the provider. The strip says "as of ..." once it is stale enough to
    /// matter, so a cached snapshot never silently reads as live.
    pub captured_at: String,
    /// Which of several same-length limits this came from, e.g. "from Opus weekly limit". The
    /// weekly number is the worst of up to three buckets, and without this the operator cannot tell
    /// which one is the wall.
    pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// Formatting — V1 `Helpers/UsageWindowCalculator`
// ---------------------------------------------------------------------------

/// A window length as the provider's own shorthand: `5h`, `7d`, `45m`.
pub fn format_window(minutes: u32) -> String {
    if minutes >= 1440 && minutes.is_multiple_of(1440) {
        return format!("{}d", minutes / 1440);
    }
    if minutes >= 60 && minutes.is_multiple_of(60) {
        return format!("{}h", minutes / 60);
    }
    format!("{minutes}m")
}

/// Time until `resets_at`, phrased the way a countdown is read rather than as a duration.
pub fn format_countdown(resets_at: &str, now: DateTime<Utc>) -> String {
    let Ok(target) = DateTime::parse_from_rfc3339(resets_at) else {
        return String::new();
    };
    let remaining = target.with_timezone(&Utc) - now;
    let total_minutes = remaining.num_minutes();
    if total_minutes <= 0 {
        return "now".to_string();
    }
    if total_minutes >= 60 {
        return format!("{}h {:02}m", total_minutes / 60, total_minutes % 60);
    }
    format!("{total_minutes}m")
}

/// How long ago a snapshot was taken.
pub fn format_relative(captured_at: &str, now: DateTime<Utc>) -> String {
    let Ok(captured) = DateTime::parse_from_rfc3339(captured_at) else {
        return String::new();
    };
    let elapsed = now - captured.with_timezone(&Utc);
    let minutes = elapsed.num_minutes();
    if minutes >= 1440 {
        return format!("{}d ago", minutes / 1440);
    }
    if minutes >= 60 {
        return format!("{}h ago", minutes / 60);
    }
    if minutes >= 1 {
        return format!("{minutes}m ago");
    }
    "just now".to_string()
}

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

/// How long a snapshot is served before the provider is asked again.
///
/// V1's sixty seconds, and its reason: the strip polls on a sixty-second timer, but so does every
/// other client of it, and Claude's arm is an authenticated network round trip. Without the cache a
/// settings pane open in two windows doubles the request rate against a provider that rate-limits.
const CACHE_TTL: Duration = Duration::from_secs(60);

struct CachedSnapshot {
    snapshot: AgentUsageSnapshot,
    fetched_at: SystemTime,
}

/// One lock across all agents rather than one per agent, matching V1's single `SemaphoreSlim(1,1)`.
/// Usage reads are seconds apart and never on a hot path, so the contention does not matter and the
/// simpler invariant does.
static USAGE_CACHE: LazyLock<Mutex<HashMap<String, CachedSnapshot>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The current usage snapshot for `agent`, or `None` when the provider publishes none.
///
/// Every failure path returns `None` rather than an error. A snapshot is decoration on a settings
/// pane: an agent whose usage cannot be read is not a broken agent, and surfacing a parse failure
/// from a vendor's undocumented JSON as an error the operator must act on would be wrong.
pub async fn agent_usage(agent: &str) -> Option<AgentUsageSnapshot> {
    let agent = normalize_agent_name(agent);

    {
        let cache = USAGE_CACHE.lock().await;
        if let Some(entry) = cache.get(&agent) {
            if entry
                .fetched_at
                .elapsed()
                .is_ok_and(|elapsed| elapsed < CACHE_TTL)
            {
                return Some(entry.snapshot.clone());
            }
        }
    }

    let snapshot = match agent.as_str() {
        "claude" => claude_usage().await,
        "codex" => codex_usage().await,
        "antigravity" | "agy" => antigravity_usage().await,
        // Gemini, Copilot, OpenCode and the two proxies publish nothing to read.
        _ => None,
    }?;

    let mut cache = USAGE_CACHE.lock().await;
    cache.insert(
        agent,
        CachedSnapshot {
            snapshot: snapshot.clone(),
            fetched_at: SystemTime::now(),
        },
    );
    Some(snapshot)
}

/// Drops every cached snapshot. For tests, and for the case where an operator has just signed in
/// and should not wait out the TTL to see it took.
pub async fn clear_usage_cache() {
    USAGE_CACHE.lock().await.clear();
}

fn snapshot(
    agent_id: &str,
    windows: Vec<AgentUsageWindow>,
    note: Option<String>,
) -> Option<AgentUsageSnapshot> {
    if windows.is_empty() {
        return None;
    }
    Some(AgentUsageSnapshot {
        agent_id: agent_id.to_string(),
        windows,
        captured_at: Utc::now().to_rfc3339(),
        note,
    })
}

// ---------------------------------------------------------------------------
// Claude — V1 `Providers/Claude/ClaudeUsageProvider`
// ---------------------------------------------------------------------------

const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_USAGE_TIMEOUT: Duration = Duration::from_secs(10);

/// Claude's own five-hour and weekly windows, read from the OAuth usage endpoint with the token
/// Claude Code already holds.
async fn claude_usage() -> Option<AgentUsageSnapshot> {
    let token = claude_access_token()?;
    let http = reqwest::Client::builder()
        .timeout(CLAUDE_USAGE_TIMEOUT)
        .build()
        .ok()?;

    // No `tracing` line here or below carries `token`: it is a live credential belonging to the
    // user's Claude Code install, not to Tendril.
    let response = http
        .get(CLAUDE_USAGE_URL)
        .bearer_auth(&token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body: serde_json::Value = response.json().await.ok()?;
    parse_claude_usage(&body)
}

/// V1 `ClaudeUsageProvider.BuildSnapshot`, split out so the bucket arithmetic is testable without a
/// live token.
fn parse_claude_usage(body: &serde_json::Value) -> Option<AgentUsageSnapshot> {
    let bucket = |name: &str| -> Option<(f64, Option<String>)> {
        let bucket = body.get(name)?;
        let utilization = bucket.get("utilization")?.as_f64()?;
        let resets_at = bucket
            .get("resets_at")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        Some((utilization, resets_at))
    };

    let mut windows = Vec::new();
    if let Some((utilization, resets_at)) = bucket("five_hour") {
        windows.push(AgentUsageWindow::from_used(300, utilization, resets_at));
    }

    // Three weekly buckets can be live at once — an overall limit plus per-model ones. Only the
    // most-used is a wall, and the note says which so "82% of weekly" is attributable.
    let mut note = None;
    let weekly = [
        ("seven_day", "weekly limit"),
        ("seven_day_opus", "Opus weekly limit"),
        ("seven_day_sonnet", "Sonnet weekly limit"),
    ]
    .into_iter()
    .filter_map(|(key, label)| bucket(key).map(|(used, resets)| (used, resets, label)))
    .max_by(|a, b| a.0.total_cmp(&b.0));

    if let Some((used, resets_at, label)) = weekly {
        note = Some(format!("from {label}"));
        windows.push(AgentUsageWindow::from_used(10080, used, resets_at));
    }

    snapshot("claude", windows, note)
}

/// The OAuth access token Claude Code stores for itself.
///
/// An expired token is reported as absent and deliberately **not** refreshed: refreshing rotates the
/// refresh token, which would sign the user's own Claude Code install out. A usage strip is not
/// worth that.
fn claude_access_token() -> Option<String> {
    let path = claude_credentials_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&content).ok()?;
    let oauth = parsed.get("claudeAiOauth")?;

    if let Some(expires_at) = oauth.get("expiresAt").and_then(|value| value.as_i64()) {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_millis() as i64)
            .unwrap_or(0);
        if expires_at <= now_ms {
            return None;
        }
    }

    oauth
        .get("accessToken")
        .and_then(|value| value.as_str())
        .filter(|token| !token.is_empty())
        .map(str::to_string)
}

fn claude_credentials_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return Some(Path::new(dir.trim()).join(".credentials.json"));
        }
    }
    Some(dirs_home()?.join(".claude").join(".credentials.json"))
}

// ---------------------------------------------------------------------------
// Codex — V1 `Providers/Codex/CodexUsageProvider`
// ---------------------------------------------------------------------------

/// How many session transcripts are searched for a rate-limit line.
const CODEX_SESSIONS_SCANNED: usize = 5;

/// Codex publishes no usage endpoint; it writes rate-limit headers into its own session transcripts.
/// The newest few are read back to find them.
async fn codex_usage() -> Option<AgentUsageSnapshot> {
    let sessions = dirs_home()?.join(".codex").join("sessions");
    let files = newest_session_files(&sessions, CODEX_SESSIONS_SCANNED);
    // Blocking file IO, moved off the runtime: five transcripts can be megabytes apiece.
    tokio::task::spawn_blocking(move || {
        files
            .into_iter()
            .find_map(|path| std::fs::read_to_string(path).ok())
            .and_then(|content| parse_codex_usage(&content, Utc::now()))
    })
    .await
    .ok()
    .flatten()
}

/// The `CODEX_SESSIONS_SCANNED` most recently modified `*.jsonl` under `root`, newest first.
fn newest_session_files(root: &Path, limit: usize) -> Vec<PathBuf> {
    let mut files: Vec<(SystemTime, PathBuf)> = walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.into_path()))
        })
        .collect();
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    files
        .into_iter()
        .take(limit)
        .map(|(_, path)| path)
        .collect()
}

/// V1 `CodexUsageProvider.ParseSession`: the last `token_count` line carrying rate limits.
///
/// Read in reverse because a long session holds hundreds of these and only the final one is current.
fn parse_codex_usage(content: &str, now: DateTime<Utc>) -> Option<AgentUsageSnapshot> {
    for line in content.lines().rev() {
        let line = line.trim();
        if line.is_empty() || !line.contains("token_count") {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let payload = parsed.get("payload")?;
        if payload.get("type").and_then(|t| t.as_str()) != Some("token_count") {
            continue;
        }
        let Some(limits) = payload.get("rate_limits").filter(|value| value.is_object()) else {
            continue;
        };

        let mut windows: Vec<AgentUsageWindow> = ["primary", "secondary"]
            .into_iter()
            .filter_map(|key| codex_window(limits.get(key)?, now))
            .collect();
        if windows.is_empty() {
            return None;
        }
        windows.sort_by_key(|window| window.window_minutes);

        // A transcript from last week reports last week's quota. The shortest window is the
        // yardstick: once more time has passed than that window is long, every number in the line
        // has already rolled over, and showing them would be worse than showing nothing.
        let shortest = windows.first().map(|w| w.window_minutes).unwrap_or(0);
        if let Some(timestamp) = parsed.get("timestamp").and_then(|value| value.as_str()) {
            if let Ok(written) = DateTime::parse_from_rfc3339(timestamp) {
                let age_minutes = (now - written.with_timezone(&Utc)).num_minutes();
                if age_minutes > i64::from(shortest) {
                    return None;
                }
            }
        }

        return snapshot("codex", windows, None);
    }
    None
}

/// One `primary`/`secondary` rate-limit bucket.
fn codex_window(bucket: &serde_json::Value, now: DateTime<Utc>) -> Option<AgentUsageWindow> {
    let window_minutes = bucket.get("window_minutes")?.as_u64()? as u32;
    let used_percent = bucket
        .get("used_percent")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0);

    // Two spellings of the same field, because Codex has used both.
    let resets_at = bucket
        .get("resets_at")
        .and_then(serde_json::Value::as_i64)
        .and_then(|seconds| DateTime::from_timestamp(seconds, 0))
        .map(|time| time.to_rfc3339())
        .or_else(|| {
            let seconds = bucket
                .get("resets_in_seconds")
                .and_then(serde_json::Value::as_i64)?;
            Some((now + chrono::Duration::seconds(seconds)).to_rfc3339())
        });

    Some(AgentUsageWindow::from_used(
        window_minutes,
        used_percent,
        resets_at,
    ))
}

// ---------------------------------------------------------------------------
// Antigravity — V1 `Providers/Antigravity/AntigravityUsageProvider`
// ---------------------------------------------------------------------------

const ANTIGRAVITY_USAGE_TIMEOUT: Duration = Duration::from_secs(15);

/// Antigravity answers `/usage` as a slash command through its own CLI.
async fn antigravity_usage() -> Option<AgentUsageSnapshot> {
    let args: Vec<String> = [
        "-p",
        "/usage",
        "--output-format",
        "json",
        "--print-timeout",
        "10s",
    ]
    .iter()
    .map(|arg| arg.to_string())
    .collect();

    let out = run_probe("agy", &args, ANTIGRAVITY_USAGE_TIMEOUT).await;
    if out.exit_code != 0 {
        return None;
    }
    let parsed: serde_json::Value = serde_json::from_str(&out.stdout).ok()?;
    parse_antigravity_usage(&parsed)
}

/// The least-remaining bucket seen for one window length, and which group reported it.
type WorstBucket = (f64, Option<String>, String);

/// V1 `AntigravityUsageProvider.BuildSnapshot`.
///
/// Antigravity reports usage per *group* — one per model family — so several groups can report the
/// same window length with different amounts left. Only the worst of them is a wall, so each window
/// keeps its lowest remaining fraction and the note names which groups it came from.
fn parse_antigravity_usage(body: &serde_json::Value) -> Option<AgentUsageSnapshot> {
    let groups = body
        .get("command")?
        .get("data")?
        .get("groups")?
        .as_array()?;

    let mut worst: HashMap<u32, WorstBucket> = HashMap::new();

    for group in groups {
        let group_name = group
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("usage")
            .to_string();
        let Some(buckets) = group.get("buckets").and_then(|value| value.as_array()) else {
            continue;
        };
        for bucket in buckets {
            let Some(minutes) = bucket
                .get("window")
                .and_then(|value| value.as_str())
                .and_then(parse_window_label)
            else {
                continue;
            };
            let remaining = bucket
                .get("remaining_fraction")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0)
                .clamp(0.0, 1.0);
            let resets_at = bucket
                .get("reset_time")
                .and_then(|value| value.as_str())
                .map(str::to_string);

            worst
                .entry(minutes)
                .and_modify(|entry| {
                    if remaining < entry.0 {
                        *entry = (remaining, resets_at.clone(), group_name.clone());
                    }
                })
                .or_insert((remaining, resets_at, group_name.clone()));
        }
    }

    let mut by_window: Vec<(u32, WorstBucket)> = worst.into_iter().collect();
    by_window.sort_by_key(|(minutes, _)| *minutes);

    let note = by_window
        .first()
        .map(|(_, (_, _, group))| format!("from {group}"));
    let windows = by_window
        .into_iter()
        .map(|(minutes, (remaining, resets_at, _))| {
            AgentUsageWindow::from_used(minutes, (1.0 - remaining) * 100.0, resets_at)
        })
        .collect();

    snapshot("antigravity", windows, note)
}

/// A window label as Antigravity spells it: `5h`, `weekly`, `45m`, `7d`, or a bare minute count.
fn parse_window_label(label: &str) -> Option<u32> {
    let label = label.trim().to_ascii_lowercase();
    if label.is_empty() {
        return None;
    }
    if label == "weekly" {
        return Some(10080);
    }
    if label == "daily" {
        return Some(1440);
    }
    if let Ok(minutes) = label.parse::<u32>() {
        return Some(minutes);
    }

    let (digits, unit) = label.split_at(label.len() - 1);
    let value: u32 = digits.parse().ok()?;
    match unit {
        "m" => Some(value),
        "h" => Some(value * 60),
        "d" => Some(value * 1440),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(rfc3339: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn a_window_is_named_in_the_providers_own_shorthand() {
        assert_eq!(format_window(300), "5h");
        assert_eq!(format_window(10080), "7d");
        assert_eq!(format_window(45), "45m");
        assert_eq!(format_window(90), "90m");
    }

    #[test]
    fn a_countdown_reads_as_a_clock_rather_than_a_duration() {
        let now = at("2026-09-19T12:00:00Z");
        assert_eq!(format_countdown("2026-09-19T14:05:00Z", now), "2h 05m");
        assert_eq!(format_countdown("2026-09-19T12:30:00Z", now), "30m");
        assert_eq!(format_countdown("2026-09-19T11:00:00Z", now), "now");
        assert_eq!(format_countdown("not a date", now), "");
    }

    #[test]
    fn a_fresh_snapshot_does_not_claim_an_age() {
        let now = at("2026-09-19T12:00:00Z");
        assert_eq!(format_relative("2026-09-19T11:59:30Z", now), "just now");
        assert_eq!(format_relative("2026-09-19T11:45:00Z", now), "15m ago");
        assert_eq!(format_relative("2026-09-19T09:00:00Z", now), "3h ago");
        assert_eq!(format_relative("2026-09-17T12:00:00Z", now), "2d ago");
    }

    #[test]
    fn the_two_halves_of_a_window_always_sum_to_a_hundred() {
        let window = AgentUsageWindow::from_used(300, 82.5, None);
        assert_eq!(window.used_percent + window.remaining_percent, 100.0);
        // A provider reporting over 100% must not produce a negative bar.
        let over = AgentUsageWindow::from_used(300, 103.0, None);
        assert_eq!(over.used_percent, 100.0);
        assert_eq!(over.remaining_percent, 0.0);
    }

    #[test]
    fn claude_reports_the_worst_of_three_weekly_buckets_and_says_which() {
        let body = serde_json::json!({
            "five_hour": {"utilization": 12.0, "resets_at": "2026-09-19T17:00:00Z"},
            "seven_day": {"utilization": 40.0, "resets_at": "2026-09-24T00:00:00Z"},
            "seven_day_opus": {"utilization": 88.0, "resets_at": "2026-09-24T00:00:00Z"},
            "seven_day_sonnet": {"utilization": 21.0, "resets_at": "2026-09-24T00:00:00Z"},
        });
        let snapshot = parse_claude_usage(&body).unwrap();
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].window_minutes, 300);
        assert_eq!(snapshot.windows[1].window_minutes, 10080);
        assert_eq!(snapshot.windows[1].used_percent, 88.0);
        assert_eq!(snapshot.note.as_deref(), Some("from Opus weekly limit"));
    }

    #[test]
    fn claude_with_only_a_five_hour_bucket_still_reports_one_window() {
        let body = serde_json::json!({"five_hour": {"utilization": 5.0}});
        let snapshot = parse_claude_usage(&body).unwrap();
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.note, None);
    }

    #[test]
    fn claude_with_no_buckets_reports_nothing_rather_than_an_empty_strip() {
        assert!(parse_claude_usage(&serde_json::json!({})).is_none());
    }

    #[test]
    fn codex_reads_the_last_rate_limit_line_not_the_first() {
        let now = at("2026-09-19T12:00:00Z");
        let content = [
            r#"{"timestamp":"2026-09-19T11:50:00Z","payload":{"type":"token_count","rate_limits":{"primary":{"window_minutes":300,"used_percent":10.0}}}}"#,
            r#"{"timestamp":"2026-09-19T11:58:00Z","payload":{"type":"token_count","rate_limits":{"primary":{"window_minutes":300,"used_percent":64.0,"resets_in_seconds":3600}}}}"#,
        ]
        .join("\n");
        let snapshot = parse_codex_usage(&content, now).unwrap();
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.windows[0].used_percent, 64.0);
        assert_eq!(
            snapshot.windows[0].resets_at.as_deref(),
            Some("2026-09-19T13:00:00+00:00")
        );
    }

    /// The rule that keeps last week's numbers off the strip.
    #[test]
    fn codex_discards_a_line_older_than_its_shortest_window() {
        let now = at("2026-09-19T12:00:00Z");
        let stale = r#"{"timestamp":"2026-09-19T05:00:00Z","payload":{"type":"token_count","rate_limits":{"primary":{"window_minutes":300,"used_percent":64.0}}}}"#;
        assert!(parse_codex_usage(stale, now).is_none());

        // Seven hours old is stale against a five-hour window but fine against a weekly one.
        let weekly = r#"{"timestamp":"2026-09-19T05:00:00Z","payload":{"type":"token_count","rate_limits":{"primary":{"window_minutes":10080,"used_percent":30.0}}}}"#;
        assert!(parse_codex_usage(weekly, now).is_some());
    }

    #[test]
    fn codex_sorts_its_windows_shortest_first() {
        let now = at("2026-09-19T12:00:00Z");
        let content = r#"{"timestamp":"2026-09-19T11:59:00Z","payload":{"type":"token_count","rate_limits":{"primary":{"window_minutes":10080,"used_percent":30.0},"secondary":{"window_minutes":300,"used_percent":5.0}}}}"#;
        let snapshot = parse_codex_usage(content, now).unwrap();
        assert_eq!(snapshot.windows[0].window_minutes, 300);
        assert_eq!(snapshot.windows[1].window_minutes, 10080);
    }

    #[test]
    fn codex_ignores_lines_that_are_not_token_counts() {
        let now = at("2026-09-19T12:00:00Z");
        let content = [
            r#"{"timestamp":"2026-09-19T11:59:00Z","payload":{"type":"message","text":"token_count"}}"#,
            "not json at all",
            "",
        ]
        .join("\n");
        assert!(parse_codex_usage(&content, now).is_none());
    }

    #[test]
    fn antigravity_keeps_the_worst_group_for_each_window() {
        let body = serde_json::json!({
            "command": {"data": {"groups": [
                {"name": "Gemini 3 Pro", "buckets": [
                    {"window": "5h", "remaining_fraction": 0.80, "reset_time": "2026-09-19T17:00:00Z"},
                    {"window": "weekly", "remaining_fraction": 0.50}
                ]},
                {"name": "Gemini 3 Deep Think", "buckets": [
                    {"window": "5h", "remaining_fraction": 0.10, "reset_time": "2026-09-19T17:00:00Z"},
                    {"window": "weekly", "remaining_fraction": 0.90}
                ]}
            ]}}
        });
        let snapshot = parse_antigravity_usage(&body).unwrap();
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].window_minutes, 300);
        // 10% left is the wall, not the 80% the other group reports.
        assert!((snapshot.windows[0].remaining_percent - 10.0).abs() < 1e-9);
        assert_eq!(snapshot.windows[1].window_minutes, 10080);
        assert!((snapshot.windows[1].remaining_percent - 50.0).abs() < 1e-9);
        assert_eq!(snapshot.note.as_deref(), Some("from Gemini 3 Deep Think"));
    }

    #[test]
    fn antigravity_with_no_groups_reports_nothing() {
        let body = serde_json::json!({"command": {"data": {"groups": []}}});
        assert!(parse_antigravity_usage(&body).is_none());
        assert!(parse_antigravity_usage(&serde_json::json!({})).is_none());
    }

    #[test]
    fn every_window_label_antigravity_uses_is_understood() {
        assert_eq!(parse_window_label("5h"), Some(300));
        assert_eq!(parse_window_label("weekly"), Some(10080));
        assert_eq!(parse_window_label("daily"), Some(1440));
        assert_eq!(parse_window_label("45m"), Some(45));
        assert_eq!(parse_window_label("7d"), Some(10080));
        assert_eq!(parse_window_label("120"), Some(120));
        assert_eq!(parse_window_label("fortnightly"), None);
        assert_eq!(parse_window_label(""), None);
    }

    #[tokio::test]
    async fn an_agent_with_no_usage_provider_reports_none() {
        // Parity with V1, which has three providers and not six: these publish nothing to read.
        for agent in ["gemini", "copilot", "opencode", "ivy", "openaiproxy"] {
            assert!(agent_usage(agent).await.is_none(), "{agent}");
        }
    }
}
