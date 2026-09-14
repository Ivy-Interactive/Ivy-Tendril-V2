//! Telemetry gating, payload shape and plan-id hashing.
//!
//! Nothing here talks to PostHog: the ingestion host is injected, and every test that expects a
//! request stands up its own stub on loopback. A test that reached the real host would be a test that
//! sent real events.

mod common;

use common::HomeFixture;
use std::io::{Read, Write};
use std::time::Duration;
use tendril_core::config::{load_config, save_config, TendrilSettings};
use tendril_core::telemetry::{self, Track};
use tendril_core::telemetry::{
    AppStartContext, JobCompletedContext, JobCreatedContext, OnboardingCompletedContext,
    PlanCreatedContext, PlanStateTransitionContext, PrCreatedContext, ProjectCreatedContext,
};

/// The raw plan id handed to every context below. It must never appear in a posted property: the
/// client hashes it into `plan_uuid` first.
const RAW_PLAN_ID: &str = "00042";

/// Attached to every event, so every per-event key set is checked against these plus its own.
const SUPER_KEYS: &[&str] = &[
    "$session_id",
    "$geoip_disable",
    "app_version",
    "os",
    "os_version",
    "distinct_id",
];

fn enabled() -> TendrilSettings {
    TendrilSettings {
        telemetry: Some(true),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------------------------
// 1. Disabled is disabled: no client, no queue, no socket.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_disabled_telemetry_makes_no_network_call() {
    let home = HomeFixture::new("telemetry-disabled");

    // Loopback only, and a port the OS picks, so the assertion below is about *our* listener rather
    // than about the real host happening to be unreachable.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback stub");
    let host = format!("http://{}", listener.local_addr().expect("stub addr"));
    listener
        .set_nonblocking(true)
        .expect("stub listener nonblocking");

    // Key absent and key explicitly false must behave identically.
    let absent = TendrilSettings::default();
    let explicit_false = TendrilSettings {
        telemetry: Some(false),
        ..Default::default()
    };

    for settings in [&absent, &explicit_false] {
        let client = telemetry::init_with_host(&home.path, settings, &host);
        assert!(
            client.is_none(),
            "telemetry must not be constructed unless the key is explicitly true"
        );

        // Every `track_*` on the disabled client, not just one: the point of the `Option` impl is that
        // the whole surface is a no-op, and a test that exercised one method would not say so.
        let tracker = client.as_deref();
        tracker.track_app_started(&AppStartContext {
            version: "0.1.0".to_string(),
            project_count: 3,
            llm_configured: true,
        });
        tracker.track_onboarding_completed(&OnboardingCompletedContext {
            project_count: 1,
            agent: Some("claude".to_string()),
        });
        tracker.track_project_created(&ProjectCreatedContext {
            repo_count: 2,
            stack_hash: Some("be.rs:axum".to_string()),
        });
        tracker.track_job_created(&JobCreatedContext {
            job_type: "ExecutePlan".to_string(),
            agent: Some("claude".to_string()),
            plan_id: Some(RAW_PLAN_ID.to_string()),
        });
        tracker.track_job_completed(&JobCompletedContext {
            job_type: "ExecutePlan".to_string(),
            status: "Completed".to_string(),
            duration_seconds: Some(12),
            agent: Some("claude".to_string()),
            plan_id: Some(RAW_PLAN_ID.to_string()),
        });
        tracker.track_plan_created(&PlanCreatedContext {
            level: "Feature".to_string(),
            duration_seconds: Some(30),
            agent: Some("claude".to_string()),
            stack_hash: Some("be.rs:axum".to_string()),
            plan_id: Some(RAW_PLAN_ID.to_string()),
        });
        tracker.track_pr_created(&PrCreatedContext {
            duration_seconds: Some(5),
            agent: Some("claude".to_string()),
            plan_id: Some(RAW_PLAN_ID.to_string()),
        });
        tracker.track_plan_state_transition(&PlanStateTransitionContext {
            from_state: "Approved".to_string(),
            to_state: "InProgress".to_string(),
            plan_id: Some(RAW_PLAN_ID.to_string()),
        });
    }

    // There is deliberately no queue to inspect and no flush to call here: `flush` is a method on
    // `Telemetry`, and no `Telemetry` exists. "Disabled" is unrepresentable as "constructed but
    // suppressed", which is a stronger guarantee than an empty queue would be.
    //
    // A disabled client does not even reach for an identity: nothing to write means nothing to leak.
    assert!(
        !home.path.join(telemetry::ANONYMOUS_ID_FILE).exists(),
        "disabled telemetry must not create an anonymous id"
    );

    // A connection would sit in the backlog even unaccepted, so `WouldBlock` is the whole assertion.
    match listener.accept() {
        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
        Ok((_, peer)) => panic!("disabled telemetry opened a connection from {}", peer),
        Err(e) => panic!("unexpected error on stub listener: {}", e),
    }
}

// ---------------------------------------------------------------------------------------------
// 2. Enabled: capture queues, flush posts exactly one batch, and the batch carries no PII.
// ---------------------------------------------------------------------------------------------

#[tokio::test]
async fn test_enabled_client_posts_one_batch_with_no_pii() {
    let home = HomeFixture::new("telemetry-enabled");
    let (host, requests) = spawn_capture_server();

    let client = telemetry::init_with_host(&home.path, &enabled(), &host)
        .expect("explicit telemetry: true must construct a client");
    assert_eq!(client.endpoint(), format!("{}/batch/", host));
    assert!(
        home.path.join(telemetry::ANONYMOUS_ID_FILE).exists(),
        "an enabled client persists its anonymous id"
    );

    // Nothing queued means nothing posted: a flusher ticking on an idle daemon must stay silent.
    client.flush().await;
    assert!(
        requests.try_recv().is_err(),
        "an empty flush must not post a request"
    );

    let tracker = Some(client.as_ref());
    tracker.track_app_started(&AppStartContext {
        version: "0.1.0".to_string(),
        project_count: 3,
        llm_configured: true,
    });
    tracker.track_job_created(&JobCreatedContext {
        job_type: "ExecutePlan".to_string(),
        agent: Some("claude".to_string()),
        plan_id: Some(RAW_PLAN_ID.to_string()),
    });
    tracker.track_job_completed(&JobCompletedContext {
        job_type: "ExecutePlan".to_string(),
        status: "Completed".to_string(),
        duration_seconds: Some(12),
        agent: Some("claude".to_string()),
        plan_id: Some(RAW_PLAN_ID.to_string()),
    });
    tracker.track_plan_created(&PlanCreatedContext {
        level: "Feature".to_string(),
        duration_seconds: Some(30),
        agent: Some("claude".to_string()),
        stack_hash: Some("fe.ts:react/be.rs:axum".to_string()),
        plan_id: Some(RAW_PLAN_ID.to_string()),
    });
    tracker.track_pr_created(&PrCreatedContext {
        duration_seconds: Some(5),
        agent: Some("claude".to_string()),
        plan_id: Some(RAW_PLAN_ID.to_string()),
    });
    tracker.track_plan_state_transition(&PlanStateTransitionContext {
        from_state: "Approved".to_string(),
        to_state: "InProgress".to_string(),
        plan_id: Some(RAW_PLAN_ID.to_string()),
    });

    // Capture is a push onto a queue and nothing more — six events, still zero requests.
    assert_eq!(client.queued(), 6, "every capture should be queued");
    assert!(
        requests.try_recv().is_err(),
        "capture must not post on its own"
    );

    client.flush().await;
    assert_eq!(client.queued(), 0, "a flushed queue is an emptied queue");

    let body = requests
        .recv_timeout(Duration::from_secs(10))
        .expect("flush should post one batch");
    assert!(
        requests.try_recv().is_err(),
        "six events must go out as one batch, not six requests"
    );

    let payload: serde_json::Value = serde_json::from_str(&body).expect("batch body is JSON");
    assert_eq!(payload["api_key"], telemetry::PROJECT_TOKEN);
    let batch = payload["batch"].as_array().expect("batch is an array");
    assert_eq!(batch.len(), 6);

    let expected: [(&str, &[&str]); 6] = [
        (
            "app_started",
            &["version", "project_count", "llm_configured"],
        ),
        ("job_created", &["job_type", "agent", "plan_uuid"]),
        (
            "job_completed",
            &[
                "job_type",
                "status",
                "duration_seconds",
                "agent",
                "plan_uuid",
            ],
        ),
        (
            "plan_created",
            &[
                "level",
                "duration_seconds",
                "agent",
                "stack_hash",
                "plan_uuid",
            ],
        ),
        ("pr_created", &["duration_seconds", "agent", "plan_uuid"]),
        (
            "plan_state_transition",
            &["from_state", "to_state", "plan_uuid"],
        ),
    ];

    let expected_uuid = telemetry::derive_plan_uuid(client.anonymous_id(), Some(RAW_PLAN_ID))
        .expect("a plan id derives a uuid");

    for (i, (event, event_keys)) in expected.iter().enumerate() {
        let entry = &batch[i];
        assert_eq!(entry["event"], *event, "event {} out of order", i);
        assert!(
            entry["timestamp"].is_string(),
            "{} needs a timestamp",
            event
        );

        let props = entry["properties"]
            .as_object()
            .unwrap_or_else(|| panic!("{} has no properties", event));

        // The exact property set, not a subset: an added property is exactly what this asserts
        // against, since anything new has to be classified before it can ship.
        let mut actual: Vec<&str> = props.keys().map(String::as_str).collect();
        actual.sort_unstable();
        let mut wanted: Vec<&str> = SUPER_KEYS
            .iter()
            .copied()
            .chain(event_keys.iter().copied())
            .collect();
        wanted.sort_unstable();
        assert_eq!(actual, wanted, "unexpected property set on {}", event);

        if event_keys.contains(&"plan_uuid") {
            assert_eq!(
                props["plan_uuid"], expected_uuid,
                "{} must carry the derived uuid",
                event
            );
        }

        // No property, whatever its type, is the raw plan id, and none of them looks like a path. The
        // stack hash legitimately contains `/` as a section separator, so the path check is about
        // absolute paths and home-directory names rather than the character itself.
        for (key, value) in props {
            let rendered = match value {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            assert_ne!(
                rendered, RAW_PLAN_ID,
                "{}.{} leaked the raw plan id",
                event, key
            );
            assert!(
                !rendered.starts_with('/')
                    && !rendered.contains("/Users/")
                    && !rendered.contains(".tendril"),
                "{}.{} looks like a filesystem path: {}",
                event,
                key,
                rendered
            );
        }
    }

    // Whole-body checks, so a leak added to the super properties is caught too. The fixture's home
    // path stands in for the file-path class generally: it is the one path this client has seen.
    let home_path = home.path.to_string_lossy().to_string();
    assert!(
        !body.contains(&home_path),
        "a filesystem path reached the batch: {}",
        body
    );
    assert!(
        !body.contains("telemetry-enabled"),
        "the fixture (project-shaped) name reached the batch: {}",
        body
    );
    assert_eq!(
        batch[0]["properties"]["distinct_id"],
        client.anonymous_id(),
        "events are identified only by the anonymous id"
    );
}

// ---------------------------------------------------------------------------------------------
// 3. Plan id hashing.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_derive_plan_uuid_is_stable_normalized_and_salted() {
    let id_a = "1f0c4d6e-0000-4000-8000-000000000001";
    let id_b = "1f0c4d6e-0000-4000-8000-000000000002";

    let first = telemetry::derive_plan_uuid(id_a, Some("00042")).expect("derives");
    let again = telemetry::derive_plan_uuid(id_a, Some("00042")).expect("derives");
    assert_eq!(
        first, again,
        "derivation must be a pure function of its inputs"
    );

    // The database hands out `42` and the folder name says `00042`; both are the same plan.
    assert_eq!(
        first,
        telemetry::derive_plan_uuid(id_a, Some("42")).expect("derives"),
        "the int-shaped and folder-shaped ids must agree"
    );
    assert_eq!(
        first,
        telemetry::derive_plan_uuid(id_a, Some("  42  ")).expect("derives"),
        "surrounding whitespace is not part of the id"
    );

    // Salted per install: plan 00042 exists on every machine and must not merge across them.
    assert_ne!(
        first,
        telemetry::derive_plan_uuid(id_b, Some("00042")).expect("derives"),
        "two installs must not derive the same uuid for the same plan id"
    );
    assert_ne!(
        first,
        telemetry::derive_plan_uuid(id_a, Some("00043")).expect("derives"),
        "two plans must not derive the same uuid"
    );

    // Nothing to identify, nothing to send.
    assert_eq!(telemetry::derive_plan_uuid(id_a, None), None);
    assert_eq!(telemetry::derive_plan_uuid(id_a, Some("")), None);
    assert_eq!(telemetry::derive_plan_uuid(id_a, Some("   ")), None);
    assert_eq!(telemetry::derive_plan_uuid("", Some("00042")), None);

    // Canonical shape, RFC 9562 version 8 (custom) and variant 10xx: a value PostHog and a human
    // both read as a UUID rather than as an opaque hash.
    let groups: Vec<&str> = first.split('-').collect();
    assert_eq!(
        groups.iter().map(|g| g.len()).collect::<Vec<_>>(),
        vec![8, 4, 4, 4, 12],
        "not canonical UUID formatting: {}",
        first
    );
    assert!(
        first.chars().all(|c| c == '-' || c.is_ascii_hexdigit()),
        "non-hex characters in {}",
        first
    );
    let version = first.chars().nth(14).expect("version nibble");
    assert_eq!(version, '8', "expected a version 8 uuid, got {}", first);
    let variant = first.chars().nth(19).expect("variant nibble");
    assert!(
        matches!(variant, '8' | '9' | 'a' | 'b'),
        "expected the RFC 9562 variant, got {}",
        first
    );
    // And it is a hash, not the id: the counter must not survive anywhere in the value.
    assert!(!first.contains("00042"));
}

// ---------------------------------------------------------------------------------------------
// 4 & 5. The config key.
// ---------------------------------------------------------------------------------------------

#[test]
fn test_telemetry_enabled_is_strictly_opt_in() {
    // V2 diverges from the original here deliberately: the original defaults telemetry on.
    assert!(
        !TendrilSettings::default().telemetry_enabled(),
        "telemetry must be off by default"
    );
    assert!(!TendrilSettings {
        telemetry: Some(false),
        ..Default::default()
    }
    .telemetry_enabled());
    assert!(TendrilSettings {
        telemetry: Some(true),
        ..Default::default()
    }
    .telemetry_enabled());
}

#[test]
fn test_saving_config_never_writes_the_telemetry_key() {
    let home = HomeFixture::new("telemetry-config");
    let config_path = home.path.join("config.yaml");

    // The shared-config hazard: a config.yaml the original app also reads, with no telemetry key. The
    // original is opt-out, so the key's absence means "on" *there*. A V2 save that stamped
    // `telemetry: false` would silently disable the original app's telemetry as a side effect of
    // touching an unrelated setting.
    std::fs::write(&config_path, "codingAgent: claude\ntheme: default\n").expect("write config");

    let loaded = load_config(&config_path).expect("load config");
    assert!(!loaded.telemetry_enabled(), "an absent key means off in V2");

    save_config(&config_path, &loaded).expect("save config");
    let saved = std::fs::read_to_string(&config_path).expect("read saved config");
    assert!(
        !saved.contains("telemetry"),
        "save must not stamp a telemetry key into a shared config: {}",
        saved
    );

    // The default settings save the same way — the key is skipped, not written as false.
    save_config(&config_path, &TendrilSettings::default()).expect("save defaults");
    let defaults = std::fs::read_to_string(&config_path).expect("read defaults");
    assert!(
        !defaults.contains("telemetry"),
        "defaults must not write the key either: {}",
        defaults
    );

    // An explicit opt-in, by contrast, survives its own round trip: skipping it would silently
    // disable V2's telemetry the next time anything saved the config.
    std::fs::write(&config_path, "codingAgent: claude\ntelemetry: true\n").expect("write opt-in");
    let opted_in = load_config(&config_path).expect("load opt-in");
    assert!(opted_in.telemetry_enabled());
    save_config(&config_path, &opted_in).expect("save opt-in");
    assert!(load_config(&config_path)
        .expect("reload opt-in")
        .telemetry_enabled());
}

// ---------------------------------------------------------------------------------------------
// Stub ingestion server.
// ---------------------------------------------------------------------------------------------

/// A loopback HTTP stub that answers 200 and hands each request body back over a channel.
///
/// Deliberately hand-rolled: the client under test posts one JSON body to one path, so a real HTTP
/// server would be more moving parts than the thing being asserted.
fn spawn_capture_server() -> (String, std::sync::mpsc::Receiver<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback stub");
    let addr = listener.local_addr().expect("stub addr");
    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let body = read_request_body(&mut stream);
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            let _ = stream.flush();
            if tx.send(body).is_err() {
                break;
            }
        }
    });

    (format!("http://{}", addr), rx)
}

fn read_request_body(stream: &mut std::net::TcpStream) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];

    loop {
        let read = match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        buf.extend_from_slice(&chunk[..read]);

        let Some(headers_end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
            continue;
        };
        let body_start = headers_end + 4;
        let headers = String::from_utf8_lossy(&buf[..headers_end]).to_lowercase();
        let length = headers
            .split("content-length:")
            .nth(1)
            .and_then(|rest| rest.split("\r\n").next())
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(0);

        if buf.len() >= body_start + length {
            return String::from_utf8_lossy(&buf[body_start..body_start + length]).to_string();
        }
    }

    String::new()
}
