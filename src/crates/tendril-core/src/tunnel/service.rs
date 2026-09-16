//! A tunnel's lifecycle — a port of `Services/Tunnel/ShareTunnelService.cs` *and*
//! `Services/Tunnel/CloudflaredService.cs`, which in the original are two near-identical classes.
//!
//! One supervisor task per activation. It resolves the binary, works out what to publish, starts a
//! [`super::session::TunnelSession`], waits for the URL to actually route, and then restarts the
//! session with exponential backoff if cloudflared dies — giving up after `maxRestarts` consecutive
//! failures, exactly as the original does.
//!
//! # Why the two tunnels are one type
//!
//! `TunnelSetupView` renders a block for each, and the original backs them with two copies of the same
//! class. Everything that is actually hard — the supervisor loop, the exponential backoff, the
//! registered-connection fallback in the health probe, the binary resolution — is identical, and
//! duplicating it would mean fixing every tunnel bug twice. [`TunnelKind`] is the discriminator, and
//! exactly three things branch on it:
//!
//! 1. **The precondition.** A [`TunnelKind::FullAccess`] tunnel refuses to start unless a session
//!    password is configured. See [`TunnelService::start`].
//! 2. **What is recorded.** A share writes [`super::share_state`], which *grants* a narrow capability. A
//!    full-access tunnel writes [`super::full_state`], which grants nothing and exists so the daemon can
//!    recognise its own public host and reap an orphaned child.
//! 3. **The log line**, because the two publish very different things.
//!
//! Nothing else in this file knows which one it is running.

use super::config::TunnelConfig;
use super::full_state::{self, FullTunnelSession};
use super::installer;
use super::session::{host_of, SessionOptions, TunnelSession};
use super::share_state::{self, ShareSession};
use super::status::{TunnelKind, TunnelStatus};
use super::TunnelError;
use futures_util::future::BoxFuture;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Notify};

/// Timings ported from the original's constants, gathered so a test can shrink them. Production code
/// should always use [`Default`].
#[derive(Debug, Clone)]
pub struct TunnelTimings {
    /// `HealthCheckInitialDelay`. Cloudflare needs a moment to publish DNS for a brand-new hostname;
    /// probing sooner returns NXDOMAIN, which the OS resolver caches *negatively* and then keeps
    /// returning long after the record goes live.
    pub probe_initial_delay: Duration,
    /// `HealthCheckInterval`.
    pub probe_interval: Duration,
    /// `HealthCheckTimeout`.
    pub probe_timeout: Duration,
    /// `TunnelSession.UrlTimeout`.
    pub url_timeout: Duration,
    /// The original's 6s wait for a registered edge connection.
    pub registered_grace: Duration,
    /// Upper bound on the restart backoff. The original's 60s.
    pub max_backoff: Duration,
    /// How long `stop` waits for the supervisor to unwind before abandoning it. The original's 5s.
    pub stop_timeout: Duration,
}

impl Default for TunnelTimings {
    fn default() -> Self {
        Self {
            probe_initial_delay: Duration::from_secs(3),
            probe_interval: Duration::from_secs(2),
            probe_timeout: Duration::from_secs(180),
            url_timeout: Duration::from_secs(60),
            registered_grace: Duration::from_secs(6),
            max_backoff: Duration::from_secs(60),
            stop_timeout: Duration::from_secs(5),
        }
    }
}

/// What a probe of the tunnel URL found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// The request reached our origin through the tunnel.
    Routable,
    /// The tunnel exists but is not routable end to end yet.
    NotReady,
    /// The request did not complete: DNS, TLS, connection.
    Failed(String),
}

/// The health check, behind a trait so tests never touch the network.
pub trait TunnelProbe: Send + Sync + 'static {
    fn probe(&self, url: String) -> BoxFuture<'static, ProbeOutcome>;
}

/// The real probe: a plain `GET` of the tunnel URL.
///
/// `502`, `504` and `530` are the codes Cloudflare returns while a tunnel exists but nothing routes to
/// it yet; **any other completed response** — including a `401` from the daemon's auth layer — means
/// the request reached our origin, which is exactly what is being tested. That is the original's rule
/// and it matters more in V2, where an unauthenticated `GET /` is a `401` rather than a page.
pub struct HttpProbe;

impl TunnelProbe for HttpProbe {
    fn probe(&self, url: String) -> BoxFuture<'static, ProbeOutcome> {
        Box::pin(async move {
            let client = match reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
            {
                Ok(client) => client,
                Err(err) => return ProbeOutcome::Failed(err.to_string()),
            };
            match client.get(&url).send().await {
                Ok(response) => {
                    let code = response.status().as_u16();
                    if matches!(code, 502 | 504 | 530) {
                        ProbeOutcome::NotReady
                    } else {
                        ProbeOutcome::Routable
                    }
                }
                Err(err) => ProbeOutcome::Failed(err.to_string()),
            }
        })
    }
}

/// The status the routes report. Port of the properties on `IShareTunnelService`, plus the token and
/// the ready-made share link the original builds in `GetShareUrlForPlan`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TunnelSnapshot {
    /// Which tunnel this is. Serialised so a client that reads both statuses cannot mix them up.
    pub kind: TunnelKind,
    pub status: TunnelStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// The visitor's capability token, present only while a *share* is connected. It is returned to the
    /// *owner*, who is already authenticated, so that the app can build a link; it is never logged.
    /// Always `None` for [`TunnelKind::FullAccess`], which mints no token at all.
    #[serde(rename = "shareToken", skip_serializing_if = "Option::is_none")]
    pub share_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub installed: bool,
    #[serde(rename = "startedAt", skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    /// Parity with `IShareTunnelService.SharePort`. Reported, not used — see
    /// [`super::config::share_port`].
    #[serde(rename = "sharePort")]
    pub share_port: u16,
    /// Whether a session password is configured. Only meaningful for
    /// [`TunnelKind::FullAccess`], where it is the precondition for starting: the settings screen reads
    /// it to explain *why* the Activate button is unavailable rather than just disabling it.
    #[serde(rename = "passwordConfigured")]
    pub password_configured: bool,
}

impl TunnelSnapshot {
    pub fn is_connected(&self) -> bool {
        self.status.is_connected()
    }
}

/// Mutable status, kept behind a `std` lock so a synchronous reader (a route handler, a middleware)
/// never has to be async to read it.
#[derive(Debug, Clone)]
struct Live {
    status: TunnelStatus,
    url: Option<String>,
    token: Option<String>,
    error: Option<String>,
    started_at: Option<String>,
}

impl Default for Live {
    fn default() -> Self {
        Self {
            status: TunnelStatus::Disabled,
            url: None,
            token: None,
            error: None,
            started_at: None,
        }
    }
}

/// Cooperative cancellation for the supervisor. `abort()`ing the task would work — [`TunnelSession`]'s
/// `Drop` kills the child either way — but a supervisor that unwinds on its own also gets to clear the
/// state file, which is what stops a stopped share from leaving a live token behind.
struct StopSignal {
    stopped: AtomicBool,
    notify: Notify,
}

impl StopSignal {
    fn new() -> Self {
        Self {
            stopped: AtomicBool::new(false),
            notify: Notify::new(),
        }
    }

    fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    /// Sleeps unless stopped. Returns `false` if a stop arrived, so callers read as
    /// `if !stop.sleep(d).await { return; }`.
    async fn sleep(&self, duration: Duration) -> bool {
        if self.is_stopped() {
            return false;
        }
        tokio::select! {
            _ = tokio::time::sleep(duration) => !self.is_stopped(),
            _ = self.notify.notified() => false,
        }
    }
}

struct Supervisor {
    stop: Arc<StopSignal>,
    handle: tokio::task::JoinHandle<()>,
}

pub struct TunnelService {
    kind: TunnelKind,
    tendril_home: PathBuf,
    timings: TunnelTimings,
    probe: Arc<dyn TunnelProbe>,
    /// Shared with the supervisor task, which is `'static` and so cannot borrow it.
    live: Arc<RwLock<Live>>,
    /// Serialises `start`/`stop` so two clicks cannot leave two supervisors running.
    supervisor: Mutex<Option<Supervisor>>,
}

impl TunnelService {
    pub fn new(kind: TunnelKind, tendril_home: PathBuf) -> Self {
        Self::with_parts(
            kind,
            tendril_home,
            TunnelTimings::default(),
            Arc::new(HttpProbe),
        )
    }

    pub fn with_parts(
        kind: TunnelKind,
        tendril_home: PathBuf,
        timings: TunnelTimings,
        probe: Arc<dyn TunnelProbe>,
    ) -> Self {
        Self {
            kind,
            tendril_home,
            timings,
            probe,
            live: Arc::new(RwLock::new(Live::default())),
            supervisor: Mutex::new(None),
        }
    }

    pub fn kind(&self) -> TunnelKind {
        self.kind
    }

    pub fn tendril_home(&self) -> &std::path::Path {
        &self.tendril_home
    }

    fn read_live(&self) -> Live {
        self.live
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn update_live(&self, mutate: impl FnOnce(&mut Live)) {
        let mut guard = self
            .live
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        mutate(&mut guard);
    }

    /// Current state, as the status route returns it.
    pub fn snapshot(&self) -> TunnelSnapshot {
        let live = self.read_live();
        let config = self.config();
        let daemon_port = self.daemon_port().unwrap_or(config.port);
        TunnelSnapshot {
            kind: self.kind,
            status: live.status,
            url: live.url,
            share_token: live.token,
            error: live.error,
            installed: installer::find_existing(&self.tendril_home).is_some()
                || config.binary_override().is_some_and(|configured| {
                    installer::resolve_binary(&self.tendril_home, Some(configured)).is_ok()
                }),
            started_at: live.started_at,
            share_port: super::config::share_port(daemon_port, config.port),
            password_configured: self.password_configured(),
        }
    }

    /// Whether `auth` in `config.yaml` holds a usable credential.
    ///
    /// Read per call rather than cached for the same reason [`Self::config`] is: an operator who sets a
    /// password expects the Activate button to come alive without restarting the daemon.
    fn password_configured(&self) -> bool {
        crate::auth::credentials::is_password_active(&crate::config::get_config_path(
            &self.tendril_home,
        ))
    }

    /// `shareTunnel:` as of now. Re-read per call rather than cached, so an operator can fix a wrong
    /// `binaryPath` and retry without restarting the daemon — the same "re-read on click" behaviour
    /// the original's views rely on.
    fn config(&self) -> TunnelConfig {
        let config_path = crate::config::get_config_path(&self.tendril_home);
        let settings = crate::config::load_config(&config_path).unwrap_or_default();
        TunnelConfig::from_settings(&settings)
    }

    fn daemon_port(&self) -> Option<u16> {
        crate::config::read_master(&self.tendril_home).map(|master| master.port)
    }

    /// What cloudflared publishes: the daemon's own bound origin, from `.master`.
    ///
    /// The original reads `IServerAddressesFeature` — the address its own Kestrel bound — and rewrites
    /// `localhost` to `127.0.0.1` so cloudflared does not resolve it to `::1` on a dual-stack box.
    /// `.master` is V2's equivalent: it is written *after* a successful bind, by the process that bound
    /// it, so it is the same fact from the same source rather than a guess from config.
    ///
    /// A missing `.master` is a hard error and not a fallback to `shareTunnel.port`: publishing a port
    /// nothing is listening on produces a tunnel that resolves to a connection refused, which looks
    /// like a Cloudflare problem and is not one.
    fn origin_url(&self) -> Result<String, TunnelError> {
        let master = crate::config::read_master(&self.tendril_home).ok_or_else(|| {
            TunnelError::NoOrigin(format!(
                "no .master file in {}; is the daemon running?",
                self.tendril_home.display()
            ))
        })?;
        let host = match master.host.as_str() {
            "localhost" | "0.0.0.0" | "" => "127.0.0.1",
            other => other,
        };
        Ok(format!("{}://{}:{}", master.scheme, host, master.port))
    }

    /// Port of `ActivateAsync`. Idempotent: activating an already-connected tunnel is a no-op that
    /// returns the existing snapshot, so a double click cannot produce two tunnels.
    ///
    /// Unlike the original, this does **not** write `shareTunnel.enabled = true` to `config.yaml`. See
    /// the module docs on [`super`].
    ///
    /// # The full-access precondition
    ///
    /// A [`TunnelKind::FullAccess`] tunnel refuses to start unless `auth` in `config.yaml` holds a usable
    /// password ([`crate::config::AuthConfig::is_active`]). V1 has no such check — `TunnelSetupView`'s
    /// Activate button calls straight through — and this is a deliberate divergence for two reasons that
    /// point the same way:
    ///
    /// - **It is the only credential a remote caller can hold.** V1 renders its UI server-side, so
    ///   tunnelling the server tunnels the app and a browser session is enough. V2's daemon is an API;
    ///   its bearer secret lives in `.master` on the daemon's own machine, and no remote client can read
    ///   it. Without a password there is no way to *use* a full-access tunnel — only to expose one.
    /// - **What is left exposed is exactly the part with no credential.** `/api/ping`, `/api/health`,
    ///   `/api/auth/login`, `/api/auth/status` and the WebViewer proxy sit outside `auth_middleware`. So
    ///   a full-access tunnel with no password published is all downside: the unauthenticated surface
    ///   reaches the internet and nothing else becomes usable.
    ///
    /// The refusal is here, in the service, rather than in the route or the UI, because it is the
    /// invariant and not the presentation of it: the CLI and any future caller get it for free.
    pub async fn start(&self) -> Result<TunnelSnapshot, TunnelError> {
        let mut guard = self.supervisor.lock().await;
        if guard.is_some() && self.read_live().status != TunnelStatus::Disabled {
            return Ok(self.snapshot());
        }

        // Fail before anything is spawned or announced, so the error the caller sees is the real one
        // rather than "connecting" followed by a status they have to poll for. The password check comes
        // first of all: it is the cheapest and the one whose failure is a decision rather than an
        // environment problem.
        if self.kind == TunnelKind::FullAccess && !self.password_configured() {
            return Err(TunnelError::PasswordRequired);
        }

        let config = self.config();
        let binary = installer::resolve_binary(&self.tendril_home, config.binary_override())?;
        let origin = self.origin_url()?;

        // A cloudflared left behind by a previous daemon would keep the old URL live alongside the new
        // one. Reaping happens here, where a tunnel is being started deliberately, and never on a
        // timer: killing a process is not something to do speculatively. Each kind reaps only its own
        // record, so starting a share cannot kill a live full-access tunnel or the reverse.
        let reaped = match self.kind {
            TunnelKind::Share => share_state::reap_orphan(&self.tendril_home),
            TunnelKind::FullAccess => full_state::reap_orphan(&self.tendril_home),
        };
        if let Some(pid) = reaped {
            tracing::warn!(
                "Reaped orphaned cloudflared (pid {pid}) before starting a new {}",
                self.kind.label()
            );
        }

        // Said out loud on every start, because a tunnel is the one action in Tendril that makes a
        // local daemon reachable from the internet. See the security note on [`super`].
        match self.kind {
            TunnelKind::Share => tracing::warn!(
                "Starting a share tunnel: this publishes {origin} on a public URL. Routes that require \
no credential become publicly reachable: /api/ping, /api/health, and /api/auth/status. \
/api/auth/login and the WebViewer proxy are refused on the share host. Stop the share when you are \
done."
            ),
            TunnelKind::FullAccess => tracing::warn!(
                "Starting a FULL-ACCESS tunnel: this publishes the whole of {origin} on a public URL. \
Every route is reachable by anyone holding the session password or the bearer secret, and \
/api/ping, /api/health, /api/auth/login and /api/auth/status are reachable with no credential at \
all. The WebViewer proxy and /api/auth/password are refused on the tunnel host. This is not a \
read-only share — stop it as soon as you are done."
            ),
        }

        // Only a share mints a capability token. A full-access tunnel authorises nothing by existing,
        // so there is nothing to mint and nothing that could leak.
        let token = match self.kind {
            TunnelKind::Share => Some(share_state::mint_token()),
            TunnelKind::FullAccess => None,
        };
        self.update_live(|live| {
            live.status = TunnelStatus::Connecting;
            live.url = None;
            live.token = token.clone();
            live.error = None;
            live.started_at = Some(chrono::Utc::now().to_rfc3339());
        });

        let stop = Arc::new(StopSignal::new());
        let task = SupervisorTask {
            kind: self.kind,
            tendril_home: self.tendril_home.clone(),
            timings: self.timings.clone(),
            probe: self.probe.clone(),
            live: SharedLive(self.live.clone()),
            binary,
            origin,
            token,
            max_restarts: config.effective_max_restarts(),
            stop: stop.clone(),
        };
        let handle = tokio::spawn(task.run());
        *guard = Some(Supervisor { stop, handle });

        Ok(self.snapshot())
    }

    /// Port of `DeactivateAsync`. Stops the supervisor, kills the child, and clears the state file so
    /// the share token and the tunnel host stop being honoured.
    ///
    /// Waits for the supervisor to unwind, but only for [`TunnelTimings::stop_timeout`] — the original
    /// makes the same choice, and for the same reason: a stop that hangs on a slow teardown leaves the
    /// UI stuck on a share the user has already dismissed.
    pub async fn stop(&self) -> TunnelSnapshot {
        let mut guard = self.supervisor.lock().await;
        if let Some(supervisor) = guard.take() {
            supervisor.stop.stop();
            match tokio::time::timeout(self.timings.stop_timeout, supervisor.handle).await {
                Ok(_) => {}
                Err(_) => tracing::warn!(
                    "{} supervisor did not stop within {:?}; abandoning it",
                    self.kind.label(),
                    self.timings.stop_timeout
                ),
            }
        }

        // Belt and braces: the supervisor clears these on its way out, but a supervisor that was
        // abandoned above did not, and a live record is a live capability.
        self.clear_record();
        self.update_live(|live| {
            live.status = TunnelStatus::Disabled;
            live.url = None;
            live.token = None;
            live.error = None;
            live.started_at = None;
        });
        self.snapshot()
    }

    /// Removes this kind's on-disk record. A share's record is a live capability, so this is the
    /// revocation; a full-access tunnel's is not, but a stale one would make the daemon go on refusing
    /// the WebViewer proxy for a hostname it no longer answers on.
    fn clear_record(&self) {
        match self.kind {
            TunnelKind::Share => share_state::clear(&self.tendril_home),
            TunnelKind::FullAccess => full_state::clear(&self.tendril_home),
        }
    }

    /// Port of `GetShareUrlForPlan`: the link a reviewer is sent.
    ///
    /// Kept from the original: the `?planId=…&share=1` query, and `/review` vs `/drafts` — spelled
    /// `/plans` here, which is what V2 calls that app.
    ///
    /// Two V2 differences, both forced by V2 shipping a bundle rather than rendering on the server:
    /// - `plan_id` is the plan *id* (`00021`), not the folder name. The original passes a folder name
    ///   into the same `planId` key because its router resolves either; V2's routes key on the id.
    /// - the capability token rides along as `shareToken`, because an anonymous visitor has no bearer
    ///   credential and V2 refuses unauthenticated requests. See [`crate::share::policy`].
    ///
    /// With no tunnel running this returns the relative path, exactly as the original does, so a caller
    /// can render a link before a share exists.
    pub fn share_url_for_plan(&self, plan_id: &str, is_review: bool) -> String {
        let path = if is_review { "/review" } else { "/plans" };
        let live = self.read_live();
        let mut query = format!("?planId={}&share=1", encode_query_component(plan_id));
        if let Some(token) = live.token.as_deref() {
            if live.status.is_connected() {
                query.push_str("&shareToken=");
                query.push_str(token);
            }
        }
        match live.url.as_deref() {
            Some(url) if live.status.is_connected() => {
                format!("{}{path}{query}", url.trim_end_matches('/'))
            }
            _ => format!("{path}{query}"),
        }
    }
}

/// Minimal percent-encoding for the one value that goes into a share link. A plan id is `NNNNN`, so
/// this only has to be correct, not complete.
fn encode_query_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// The supervisor writes status back through this. A raw pointer would be wrong; what it actually
/// needs is the same `Arc`, so the service hands out a clone of its own state instead.
#[derive(Clone)]
struct SharedLive(Arc<RwLock<Live>>);

impl SharedLive {
    fn set(&self, mutate: impl FnOnce(&mut Live)) {
        let mut guard = self
            .0
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        mutate(&mut guard);
    }
}

struct SupervisorTask {
    kind: TunnelKind,
    tendril_home: PathBuf,
    timings: TunnelTimings,
    probe: Arc<dyn TunnelProbe>,
    live: SharedLive,
    binary: PathBuf,
    origin: String,
    /// A share's capability token. `None` for [`TunnelKind::FullAccess`], which mints none.
    token: Option<String>,
    max_restarts: u32,
    stop: Arc<StopSignal>,
}

impl SupervisorTask {
    /// Port of `SupervisorLoopAsync`.
    async fn run(self) {
        let mut consecutive_failures: u32 = 0;

        while !self.stop.is_stopped() && consecutive_failures < self.max_restarts {
            self.live.set(|live| live.status = TunnelStatus::Connecting);

            match self.one_session().await {
                Ok(()) => {
                    // The session was healthy and then cloudflared exited. Not a failure, but the
                    // share is down until a new session comes up.
                    if self.stop.is_stopped() {
                        break;
                    }
                    tracing::warn!(
                        "{} process exited unexpectedly; restarting",
                        self.kind.label()
                    );
                    consecutive_failures = 0;
                }
                Err(err) => {
                    if self.stop.is_stopped() {
                        break;
                    }
                    consecutive_failures += 1;
                    let message = err.to_string();
                    tracing::warn!(
                        "{} session failed (attempt {consecutive_failures}/{}): {message}",
                        self.kind.label(),
                        self.max_restarts
                    );
                    self.live.set(|live| {
                        live.status = TunnelStatus::Connecting;
                        live.url = None;
                        live.error = Some(message);
                    });
                }
            }

            self.clear_record();

            if self.stop.is_stopped() {
                break;
            }
            if consecutive_failures >= self.max_restarts {
                break;
            }
            if !self.stop.sleep(self.backoff(consecutive_failures)).await {
                break;
            }
        }

        if consecutive_failures >= self.max_restarts {
            tracing::error!(
                "{} exceeded max restarts ({}), giving up",
                self.kind.label(),
                self.max_restarts
            );
            self.live.set(|live| {
                live.status = TunnelStatus::Disabled;
                live.url = None;
                live.token = None;
            });
        } else if self.stop.is_stopped() {
            self.live.set(|live| {
                live.status = TunnelStatus::Disabled;
                live.url = None;
                live.token = None;
                live.error = None;
            });
        }

        // Whatever ended the loop, nothing may be left claiming to be an active tunnel.
        self.clear_record();
    }

    /// This kind's record, and only this kind's.
    fn clear_record(&self) {
        match self.kind {
            TunnelKind::Share => share_state::clear(&self.tendril_home),
            TunnelKind::FullAccess => full_state::clear(&self.tendril_home),
        }
    }

    /// `min(5 * 2^(n-1), max)`, the original's formula — including `n = 0` giving 2.5s, which is the
    /// gap after a *healthy* session's process exits.
    fn backoff(&self, consecutive_failures: u32) -> Duration {
        let exponent = consecutive_failures as f64 - 1.0;
        let seconds = (5.0 * 2f64.powf(exponent)).min(self.timings.max_backoff.as_secs_f64());
        Duration::from_secs_f64(seconds.max(0.5))
    }

    /// Starts one session, waits for it to route, publishes it, and returns when it exits.
    async fn one_session(&self) -> Result<(), TunnelError> {
        let mut options = SessionOptions::new(self.binary.clone(), self.origin.clone());
        options.url_timeout = self.timings.url_timeout;
        options.registered_grace = self.timings.registered_grace;

        // `session` owns the child from here; every `?` below drops it, which kills the process.
        let mut session = TunnelSession::start(options).await?;
        let url = session.url().to_string();

        self.wait_until_routable(&url, &session).await?;

        let host = host_of(&url).unwrap_or_default();
        let started_at = chrono::Utc::now().to_rfc3339();
        match self.kind {
            TunnelKind::Share => share_state::write(
                &self.tendril_home,
                &ShareSession {
                    url: url.clone(),
                    host,
                    // A share always has one: `start` mints it before spawning this task.
                    token: self.token.clone().unwrap_or_default(),
                    pid: session.pid(),
                    started_at,
                },
            )?,
            TunnelKind::FullAccess => full_state::write(
                &self.tendril_home,
                &FullTunnelSession {
                    url: url.clone(),
                    host,
                    pid: session.pid(),
                    started_at,
                },
            )?,
        }

        self.live.set(|live| {
            live.status = TunnelStatus::Connected;
            live.url = Some(url.clone());
            live.error = None;
        });
        tracing::info!("{} is live at {url}", self.kind.label());

        // Either cloudflared exits or a stop arrives; both leave through the same `Drop`.
        tokio::select! {
            _ = session.wait_for_exit() => {}
            _ = self.stop.notify.notified() => {}
        }
        Ok(())
    }

    /// Port of `WaitForTunnelHealthyAsync`, minus the DNS-over-HTTPS cross-check.
    ///
    /// The registered-connection fallback *is* ported: when the deadline passes but cloudflared says
    /// it has a registered edge connection, the tunnel is treated as up. Locally-poisoned negative DNS
    /// is common enough that refusing on a local probe alone would report working shares as broken.
    async fn wait_until_routable(
        &self,
        url: &str,
        session: &TunnelSession,
    ) -> Result<(), TunnelError> {
        if !self.stop.sleep(self.timings.probe_initial_delay).await {
            return Err(TunnelError::NotRoutable {
                seconds: 0,
                url: url.to_string(),
            });
        }

        let deadline = Instant::now() + self.timings.probe_timeout;
        let mut attempt = 0u32;
        loop {
            if self.stop.is_stopped() {
                return Err(TunnelError::NotRoutable {
                    seconds: 0,
                    url: url.to_string(),
                });
            }
            attempt += 1;
            match self.probe.probe(url.to_string()).await {
                ProbeOutcome::Routable => {
                    tracing::info!(
                        "{} is routable after {attempt} attempt(s)",
                        self.kind.label()
                    );
                    return Ok(());
                }
                ProbeOutcome::NotReady => {
                    tracing::debug!("{} not ready yet (attempt {attempt})", self.kind.label());
                }
                ProbeOutcome::Failed(err) => {
                    tracing::debug!("{} probe {attempt} failed: {err}", self.kind.label());
                }
            }

            if Instant::now() >= deadline {
                if session.is_registered() {
                    tracing::warn!(
                        "{} probe timed out but cloudflared reports a registered \
connection; treating it as up",
                        self.kind.label()
                    );
                    return Ok(());
                }
                return Err(TunnelError::NotRoutable {
                    seconds: self.timings.probe_timeout.as_secs(),
                    url: url.to_string(),
                });
            }

            if !self.stop.sleep(self.timings.probe_interval).await {
                return Err(TunnelError::NotRoutable {
                    seconds: 0,
                    url: url.to_string(),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AlwaysRoutable;

    impl TunnelProbe for AlwaysRoutable {
        fn probe(&self, _url: String) -> BoxFuture<'static, ProbeOutcome> {
            Box::pin(async { ProbeOutcome::Routable })
        }
    }

    fn service(home: PathBuf) -> TunnelService {
        of_kind(TunnelKind::Share, home)
    }

    fn of_kind(kind: TunnelKind, home: PathBuf) -> TunnelService {
        TunnelService::with_parts(
            kind,
            home,
            TunnelTimings::default(),
            Arc::new(AlwaysRoutable),
        )
    }

    fn temp_home(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "tendril-tunnel-service-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).expect("create fixture home");
        path
    }

    #[test]
    fn a_fresh_service_reports_disabled_and_no_url() {
        let home = temp_home("fresh");
        let snapshot = service(home.clone()).snapshot();
        assert_eq!(snapshot.status, TunnelStatus::Disabled);
        assert!(snapshot.url.is_none());
        assert!(snapshot.share_token.is_none());
        assert!(snapshot.error.is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    /// With no `.master` there is nothing to publish, and guessing a port would produce a tunnel that
    /// resolves to a connection refused.
    #[tokio::test]
    async fn starting_without_a_running_daemon_is_a_clear_error() {
        let home = temp_home("no-master");
        // Point `binaryPath` at something that exists so the failure is the origin, not the binary.
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        std::fs::write(
            crate::config::get_config_path(&home),
            format!("shareTunnel:\n  binaryPath: {shell}\n"),
        )
        .unwrap();

        let err = service(home.clone()).start().await.unwrap_err();
        let message = err.to_string();
        assert!(message.contains(".master"), "{message}");
        assert!(message.contains("is the daemon running?"), "{message}");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_share_link_is_relative_until_a_tunnel_exists() {
        let home = temp_home("link-relative");
        let svc = service(home.clone());
        assert_eq!(
            svc.share_url_for_plan("00021-Ship-It", true),
            "/review?planId=00021-Ship-It&share=1"
        );
        assert_eq!(
            svc.share_url_for_plan("00021-Ship-It", false),
            "/plans?planId=00021-Ship-It&share=1"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_share_link_carries_the_tunnel_and_the_token_once_connected() {
        let home = temp_home("link-connected");
        let svc = service(home.clone());
        svc.update_live(|live| {
            live.status = TunnelStatus::Connected;
            live.url = Some("https://calm-otter.trycloudflare.com/".to_string());
            live.token = Some("tok-123".to_string());
        });

        let link = svc.share_url_for_plan("00021-Ship It", true);
        assert_eq!(
            link,
            "https://calm-otter.trycloudflare.com/review?planId=00021-Ship%20It&share=1&shareToken=tok-123"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A token is only appended once the tunnel is actually routable: handing out a link that cannot
    /// work yet is how a reviewer ends up reporting a broken share.
    #[test]
    fn a_connecting_tunnel_does_not_hand_out_a_token() {
        let home = temp_home("link-connecting");
        let svc = service(home.clone());
        svc.update_live(|live| {
            live.status = TunnelStatus::Connecting;
            live.url = Some("https://calm-otter.trycloudflare.com".to_string());
            live.token = Some("tok-123".to_string());
        });
        assert_eq!(
            svc.share_url_for_plan("00021-Ship-It", true),
            "/review?planId=00021-Ship-It&share=1"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_backoff_matches_the_originals_formula() {
        let home = temp_home("backoff");
        let task = SupervisorTask {
            kind: TunnelKind::Share,
            tendril_home: home.clone(),
            timings: TunnelTimings::default(),
            probe: Arc::new(AlwaysRoutable),
            live: SharedLive(Arc::new(RwLock::new(Live::default()))),
            binary: PathBuf::from("cloudflared"),
            origin: "http://127.0.0.1:5010".to_string(),
            token: Some("t".to_string()),
            max_restarts: 10,
            stop: Arc::new(StopSignal::new()),
        };

        // n = 0 is the "healthy session's process exited" case: 5 * 2^-1.
        assert_eq!(task.backoff(0), Duration::from_secs_f64(2.5));
        assert_eq!(task.backoff(1), Duration::from_secs(5));
        assert_eq!(task.backoff(2), Duration::from_secs(10));
        assert_eq!(task.backoff(4), Duration::from_secs(40));
        assert_eq!(task.backoff(20), Duration::from_secs(60), "clamped");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn stopping_a_service_that_never_started_is_a_no_op() {
        let home = temp_home("stop-idle");
        let snapshot = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(service(home.clone()).stop());
        assert_eq!(snapshot.status, TunnelStatus::Disabled);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// The invariant this whole section exists for: a full-access tunnel publishes the entire daemon,
    /// and with no password there is no credential a remote caller could hold, so all it can do is
    /// expose the unauthenticated surface.
    #[tokio::test]
    async fn a_full_access_tunnel_refuses_to_start_without_a_password() {
        let home = temp_home("full-no-password");
        // A resolvable binary and a `.master`, so the only thing that can fail is the password check.
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        std::fs::write(
            crate::config::get_config_path(&home),
            format!("shareTunnel:\n  binaryPath: {shell}\n"),
        )
        .unwrap();

        let svc = of_kind(TunnelKind::FullAccess, home.clone());
        assert!(!svc.snapshot().password_configured);

        let err = svc.start().await.unwrap_err();
        assert!(
            matches!(err, TunnelError::PasswordRequired),
            "expected PasswordRequired, got {err:?}"
        );
        // Nothing was announced and nothing was recorded.
        assert_eq!(svc.snapshot().status, TunnelStatus::Disabled);
        assert!(full_state::read(&home).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    /// The same start with a password gets *past* the precondition and fails on the next one, which is
    /// what proves the gate is the password and not something incidental.
    #[tokio::test]
    async fn a_configured_password_clears_the_precondition() {
        let home = temp_home("full-with-password");
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        let config = crate::config::get_config_path(&home);
        std::fs::write(&config, format!("shareTunnel:\n  binaryPath: {shell}\n")).unwrap();
        crate::auth::credentials::set_password(&config, None, "a-real-password").expect("set");

        let svc = of_kind(TunnelKind::FullAccess, home.clone());
        assert!(svc.snapshot().password_configured);

        let err = svc.start().await.unwrap_err();
        assert!(
            matches!(err, TunnelError::NoOrigin(_)),
            "the password gate is cleared; the next failure is the missing .master: {err:?}"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A share is deny-by-default and safe to hand to somebody who is not the operator, so it has never
    /// needed a password and must not start needing one.
    #[tokio::test]
    async fn a_share_still_needs_no_password() {
        let home = temp_home("share-no-password");
        let shell = if cfg!(windows) { "cmd" } else { "sh" };
        std::fs::write(
            crate::config::get_config_path(&home),
            format!("shareTunnel:\n  binaryPath: {shell}\n"),
        )
        .unwrap();

        let err = service(home.clone()).start().await.unwrap_err();
        assert!(
            matches!(err, TunnelError::NoOrigin(_)),
            "a share must not be gated on a password: {err:?}"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_snapshot_names_its_kind_and_a_full_access_one_never_carries_a_token() {
        let home = temp_home("kinds");
        let share = service(home.clone()).snapshot();
        assert_eq!(share.kind, TunnelKind::Share);

        let full = of_kind(TunnelKind::FullAccess, home.clone()).snapshot();
        assert_eq!(full.kind, TunnelKind::FullAccess);
        assert!(
            full.share_token.is_none(),
            "a full-access tunnel mints no capability token"
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn query_components_are_encoded() {
        assert_eq!(encode_query_component("00021-Ship-It"), "00021-Ship-It");
        assert_eq!(encode_query_component("a b"), "a%20b");
        assert_eq!(encode_query_component("a&b=c"), "a%26b%3Dc");
        assert_eq!(encode_query_component("../etc"), "..%2Fetc");
    }
}
