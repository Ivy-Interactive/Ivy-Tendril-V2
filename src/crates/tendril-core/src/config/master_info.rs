//! The `.master` document: [`MasterInfo`], the wire shape every client parses, and [`MasterClaim`],
//! that plus the two fields only the mastership lifecycle needs.

// Imported solely so the read_master_claim and MasterGuard::beat doc links below — written when
// this code and those items shared one file — still resolve.
#[allow(unused_imports)]
use super::master_file::read_master_claim;
#[allow(unused_imports)]
use super::master_guard::MasterGuard;
use super::process::{is_process_running, process_start_token};
use serde::{Deserialize, Serialize};

pub fn generate_bearer_secret() -> String {
    // `try_fill_bytes` rather than `fill_bytes`: as of rand 0.9 `OsRng` implements only `TryRngCore`,
    // because a read from the OS entropy source is genuinely fallible. There is nothing sensible to
    // do with that failure here — a secret we cannot make random must not be returned — and the
    // callers up the chain (`share_state::mint`, `persona::generate_random`) all return `String`, so
    // the panic stops short of handing out a predictable token.
    use rand::TryRngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng
        .try_fill_bytes(&mut bytes)
        .expect("the OS entropy source must be readable to mint a bearer secret");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn default_capabilities() -> Vec<String> {
    vec![
        "jobs".to_string(),
        "plans".to_string(),
        "projects".to_string(),
        "ws".to_string(),
        "auth_bearer".to_string(),
        "auth_api_key".to_string(),
    ]
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_api_version() -> u32 {
    1
}

/// `.master` files written before `serve --tls-cert/--tls-key` existed carry no `scheme`, and every
/// one of them describes a plaintext server.
fn default_scheme() -> String {
    "http".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MasterInfo {
    pub port: u16,
    pub pid: u32,
    #[serde(default)]
    pub secret: String,
    #[serde(rename = "startedAt", alias = "started_at", default)]
    pub started_at: String,
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default)]
    pub version: String,
    #[serde(
        rename = "apiVersion",
        alias = "api_version",
        default = "default_api_version"
    )]
    pub api_version: u32,
    #[serde(default)]
    pub capabilities: Vec<String>,
    /// `"http"` or `"https"` — which one `serve` was started with. Clients must not guess: a request
    /// to the wrong scheme is a connection error, not a redirect.
    #[serde(default = "default_scheme")]
    pub scheme: String,
}

impl MasterInfo {
    /// The base URL of the daemon's API, e.g. `https://127.0.0.1:5010`.
    pub fn base_url(&self) -> String {
        format!("{}://{}:{}", self.scheme, self.host, self.port)
    }
}

#[cfg(test)]
mod master_info_tests {
    use super::MasterInfo;

    #[test]
    fn base_url_follows_the_recorded_scheme() {
        let mut info: MasterInfo =
            serde_json::from_str(r#"{"port":5010,"pid":1,"host":"127.0.0.1","scheme":"http"}"#)
                .unwrap();
        assert_eq!(info.base_url(), "http://127.0.0.1:5010");

        info.scheme = "https".to_string();
        assert_eq!(info.base_url(), "https://127.0.0.1:5010");
    }

    #[test]
    fn a_master_file_without_a_scheme_reads_as_http() {
        let json = r#"{"port":5010,"pid":42,"host":"127.0.0.1"}"#;
        let parsed: MasterInfo = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.scheme, "http");
        assert_eq!(parsed.base_url(), "http://127.0.0.1:5010");
    }
}

/// The `.master` document format this build writes, and the highest one it claims to understand.
///
/// A reader that finds a higher number is looking at a file written by a Tendril it does not know, and
/// the only safe thing it can do with it is leave it alone — a claim it cannot interpret is not
/// evidence that the daemon holding it is dead. V1 wrote no marker at all and had nothing to check,
/// which is how a V1 CLI came to delete a live V2 daemon's claim; 1 therefore means "unmarked".
pub const MASTER_SCHEMA_VERSION: u32 = 2;

fn default_schema_version() -> u32 {
    1
}

/// A heartbeat stamp: UTC, millisecond precision, `Z`-suffixed. See [`MasterClaim::heartbeat`] for why
/// the suffix rather than an offset.
pub(super) fn heartbeat_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The `.master` document as the daemon writes it: a [`MasterInfo`] plus the two fields only the
/// mastership lifecycle needs.
///
/// Kept as a separate struct rather than more fields on `MasterInfo` because `MasterInfo` is the
/// wire shape every client (CLI, app, extension) already parses, and serde ignores keys it does not
/// know: an older reader sees exactly what it saw before, and a reader that needs the lifecycle
/// fields asks for them explicitly through [`read_master_claim`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MasterClaim {
    #[serde(flatten)]
    pub info: MasterInfo,

    /// When the owning process last asserted this claim: written at acquire, when the bound port is
    /// published, on every re-assert, and on every beat of the daemon's master task.
    ///
    /// V2 never decides liveness from it — that is the pid, its start token and `/api/ping`, so a
    /// clock jump cannot unseat a running daemon. It is written for *other* readers, and it is not
    /// merely diagnostic to them: the shipped V1 CLI (`MasterLock.ReadLiveMaster`) treats a claim whose
    /// `heartbeat` is more than 90s old as abandoned and **deletes the file**. A V2 daemon that wrote
    /// no field of that name read as infinitely stale, so one `tendril` call from a developer's V1
    /// install took the live dev daemon off the air. Hence the wire name `heartbeat` — the name that
    /// reader looks for — and hence [`MasterGuard::beat`] keeping it inside that window.
    ///
    /// UTC with a `Z` suffix, not a numeric offset: a reader that maps an offset onto local time and
    /// then subtracts from UTC "now" (which is exactly what .NET's `DateTime` does) gets an age that is
    /// wrong by the machine's timezone, and west of UTC that error is in the direction that deletes.
    #[serde(
        alias = "heartbeatAt",
        alias = "heartbeat_at",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub heartbeat: Option<String>,

    /// Which `.master` document format this file is written to; see [`MASTER_SCHEMA_VERSION`].
    ///
    /// Absent means 1: every `.master` written before this field existed.
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: u32,

    /// The kernel's start time for `info.pid` as of the moment the claim was written.
    ///
    /// This is the PID-reuse guard: a bare `kill(pid, 0)` reports a recycled pid as alive, which
    /// wedges the claim forever (the only escape today is `TENDRIL_ALLOW_MASTER_TAKEOVER=1`). When
    /// the token recorded here differs from the pid's current one, the pid belongs to some other
    /// process and the claim is stale. `None` — a claim written by an older build, or a platform
    /// where the token cannot be read — means "cannot tell", and the check is skipped.
    #[serde(
        rename = "pidStartedAt",
        alias = "pid_started_at",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub pid_started_at: Option<String>,
}

impl MasterClaim {
    /// A claim describing this process, stamped with its own start token.
    pub fn for_this_process(port: u16, secret: &str, host: &str, scheme: &str) -> Self {
        let pid = std::process::id();
        Self {
            info: MasterInfo {
                port,
                pid,
                secret: secret.to_string(),
                started_at: chrono::Utc::now().to_rfc3339(),
                host: host.to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                api_version: 1,
                capabilities: default_capabilities(),
                scheme: scheme.to_string(),
            },
            heartbeat: Some(heartbeat_now()),
            schema_version: MASTER_SCHEMA_VERSION,
            pid_started_at: process_start_token(pid),
        }
    }

    /// True when the process this claim names is still the process that wrote it.
    ///
    /// Deliberately conservative: an unreadable start token, or a claim written before the token
    /// existed, falls back to the plain pid check, so this can only ever be *more* correct than
    /// `is_process_running` — never more eager to declare a live master dead.
    pub fn owner_is_running(&self) -> bool {
        if !is_process_running(self.info.pid) {
            return false;
        }
        match (&self.pid_started_at, process_start_token(self.info.pid)) {
            (Some(recorded), Some(current)) => recorded == &current,
            _ => true,
        }
    }
}
