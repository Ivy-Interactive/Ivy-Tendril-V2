//! Live model discovery against a stub provider, end to end through
//! `provider_models::discover_provider_models`.
//!
//! This is V1's onboarding decision tree (`Apps/Onboarding/CodingAgentStepView.cs:334-400`) exercised
//! against an endpoint that answers, one that refuses the key, and one that lists nothing but takes a
//! prompt — the three cases that decide whether the pane shows selects, an error on the API-key field,
//! or the free-text fields.
//!
//! It also pins the rule that the credential never comes back out: not in a reply body, not in a log
//! line. A provider that quotes the key it rejected is the realistic way that would happen, so the stub
//! here does exactly that.

use std::io::Write;
use std::sync::{Arc, Mutex};

use tendril_core::agents::provider_models::{
    discover_provider_models, ModelProviderKind, ProviderModelsOutcome,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// A one-shot-per-connection HTTP stub. `answer` is handed the request head (request line and headers)
/// and returns a status and body, so a test can key off the path *and* assert on what was sent.
async fn stub_provider<F>(answer: F) -> (String, Arc<Mutex<Vec<String>>>)
where
    F: Fn(&str) -> (u16, String) + Send + Sync + 'static,
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&seen);
    let answer = Arc::new(answer);

    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            let answer = Arc::clone(&answer);
            let recorded = Arc::clone(&recorded);
            tokio::spawn(async move {
                let mut buffer = vec![0u8; 8192];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                recorded.lock().unwrap().push(request.clone());

                let (status, body) = answer(&request);
                let response = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            });
        }
    });

    (base_url, seen)
}

fn path_of(request: &str) -> String {
    request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/")
        .to_string()
}

fn serialized(outcome: &ProviderModelsOutcome) -> String {
    serde_json::to_string(outcome).unwrap()
}

const KEY: &str = "sk-proj-supersecret0123456789";

#[tokio::test]
async fn an_endpoint_that_lists_models_drives_the_selects() {
    let (base_url, seen) = stub_provider(|request| {
        if path_of(request) == "/v1/models" {
            return (
                200,
                r#"{"data":[{"id":"gpt-5.6-luna"},{"id":"gpt-5.6-terra"},{"id":"gpt-5.6-sol"},{"id":"house-blend-1","name":"House Blend"}]}"#
                    .to_string(),
            );
        }
        (404, r#"{"error":{"message":"nope"}}"#.to_string())
    })
    .await;

    let outcome = discover_provider_models(&base_url, KEY).await;

    match &outcome {
        ProviderModelsOutcome::Models {
            models,
            defaults,
            provider,
        } => {
            // An unrecognised base URL is V1's `Generic` provider, whose priorities are the union list.
            assert_eq!(*provider, ModelProviderKind::Generic);
            assert_eq!(models.len(), 4);
            // A declared id borrows the catalogue's label; an id nobody declared keeps the endpoint's.
            let sol = models.iter().find(|m| m.id == "gpt-5.6-sol").unwrap();
            assert_eq!(sol.display_name, "GPT-5.6-Sol");
            let blend = models.iter().find(|m| m.id == "house-blend-1").unwrap();
            assert_eq!(blend.display_name, "House Blend");
            // Tiers are chosen by priority rather than by listing order.
            assert_eq!(defaults.deep, "gpt-5.6-sol");
            assert_eq!(defaults.balanced, "gpt-5.6-terra");
            assert_eq!(defaults.quick, "gpt-5.6-luna");
        }
        other => panic!("expected a model list, got {other:?}"),
    }

    // The key really was used — a bearer on the listing request — and really did not come back.
    let requests = seen.lock().unwrap().clone();
    assert!(requests
        .iter()
        .any(|request| request.contains("authorization: Bearer")
            || request.contains("Authorization: Bearer")));
    assert!(!serialized(&outcome).contains(KEY));
}

/// A rejected key is an error on the **API-key field**, and never a fall-through to free text: an
/// endpoint that refused the credential has told us nothing about whether it lists models.
#[tokio::test]
async fn a_rejected_key_is_an_api_key_error_with_the_key_stripped_from_the_message() {
    // The realistic hazard: the provider quotes the credential it rejected.
    let (base_url, _) = stub_provider(|_| {
        (
            401,
            format!(
                r#"{{"error":{{"message":"Incorrect API key provided: {KEY}. You can find your API key at ..."}}}}"#
            ),
        )
    })
    .await;

    let outcome = discover_provider_models(&base_url, KEY).await;

    match &outcome {
        ProviderModelsOutcome::ApiKeyError { message } => {
            assert!(message.contains("Incorrect API key provided"), "{message}");
            assert!(!message.contains(KEY), "the key survived: {message}");
            assert!(
                !message.contains(&KEY[..12]),
                "a prefix survived: {message}"
            );
            assert!(message.contains("***"), "{message}");
        }
        other => panic!("expected an API key error, got {other:?}"),
    }
    assert!(!serialized(&outcome).contains(KEY));
    assert!(!serialized(&outcome).contains(&KEY[..12]));
}

/// V1's second half: no listing is not a failure. The endpoint gets a real five-token prompt, and if
/// that works the pane switches to typed model names prefilled with the provider's defaults.
#[tokio::test]
async fn an_endpoint_with_no_listing_but_a_working_prompt_asks_for_custom_names() {
    let (base_url, seen) = stub_provider(|request| {
        let path = path_of(request);
        if path.ends_with("/chat/completions") {
            return (
                200,
                r#"{"choices":[{"message":{"content":"pong"}}]}"#.to_string(),
            );
        }
        (404, r#"{"error":{"message":"no such route"}}"#.to_string())
    })
    .await;

    let outcome = discover_provider_models(&base_url, KEY).await;

    match &outcome {
        ProviderModelsOutcome::CustomNames { defaults, .. } => {
            assert_eq!(defaults.deep, "gpt-5.6-sol");
            assert_eq!(defaults.balanced, "gpt-5.6-terra");
            assert_eq!(defaults.quick, "gpt-5.6-luna");
        }
        other => panic!("expected custom names, got {other:?}"),
    }

    // The ping is a real completion request for the balanced default, which is what makes this a
    // check of the endpoint rather than of its documentation.
    let requests = seen.lock().unwrap().clone();
    let ping = requests
        .iter()
        .find(|request| path_of(request).ends_with("/chat/completions"))
        .expect("the balanced default should have been pinged");
    assert!(ping.contains("gpt-5.6-terra"), "{ping}");
    assert!(!serialized(&outcome).contains(KEY));
}

/// An endpoint whose prompt fails at the transport is an error on the **base-URL field** — the third
/// arm of V1's routing, and the reason the operator is not sent to type model names for an address that
/// does not answer.
#[tokio::test]
async fn an_endpoint_that_cannot_be_reached_is_a_base_url_error() {
    // Port 1 on loopback: nothing is listening, so both the listing and the ping fail to connect.
    let outcome = discover_provider_models("http://127.0.0.1:1/v1", KEY).await;
    match &outcome {
        ProviderModelsOutcome::BaseUrlError { message } => {
            assert!(!message.contains(KEY), "{message}");
        }
        other => panic!("expected a base URL error, got {other:?}"),
    }
    assert!(!serialized(&outcome).contains(KEY));
}

/// An endpoint that answers Anthropic's listing shape, with the display names its rows carry. (The
/// wire protocol itself — `x-api-key` versus a bearer — is pinned by `provider_models`'
/// `each_provider_gets_the_wire_protocol_it_expects`, which does not need a socket.)
#[tokio::test]
async fn anthropic_style_rows_keep_their_own_display_names() {
    let (base_url, _) = stub_provider(|_| {
        (
            200,
            r#"{"data":[{"id":"claude-opus-5","display_name":"Claude Opus 5"},{"id":"claude-nova-9","display_name":"Claude Nova 9"}]}"#
                .to_string(),
        )
    })
    .await;

    match discover_provider_models(&base_url, KEY).await {
        ProviderModelsOutcome::Models { models, .. } => {
            assert_eq!(models.len(), 2);
            assert_eq!(models[1].id, "claude-nova-9");
            // An id no provider declares keeps the endpoint's own label, and gains nothing else.
            assert_eq!(models[1].display_name, "Claude Nova 9");
        }
        other => panic!("expected a model list, got {other:?}"),
    }
}

/// The other half of "never returns the key": never logs it either. Nothing in this path emits a
/// tracing event carrying either the key or the URL's credentials, and this asserts it rather than
/// trusting the current code to stay that way.
#[tokio::test]
async fn nothing_on_the_discovery_path_logs_the_key() {
    #[derive(Clone)]
    struct Capture(Arc<Mutex<Vec<u8>>>);
    impl Write for Capture {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
        type Writer = Capture;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    let buffer = Arc::new(Mutex::new(Vec::new()));
    let subscriber = tracing_subscriber::fmt()
        .with_writer(Capture(Arc::clone(&buffer)))
        .with_max_level(tracing::Level::TRACE)
        .finish();

    let (base_url, _) =
        stub_provider(|_| (401, format!(r#"{{"error":{{"message":"bad key {KEY}"}}}}"#))).await;

    // `set_default` rather than `with_default`, because the work being watched is async: this test's
    // runtime is single-threaded, so the thread-local default holds across the await.
    let guard = tracing::subscriber::set_default(subscriber);
    let outcome = discover_provider_models(&base_url, KEY).await;
    drop(guard);

    assert!(matches!(outcome, ProviderModelsOutcome::ApiKeyError { .. }));
    let logged = String::from_utf8_lossy(&buffer.lock().unwrap().clone()).to_string();
    assert!(!logged.contains(KEY), "the key was logged: {logged}");
    assert!(
        !logged.contains(&KEY[..12]),
        "a prefix of the key was logged: {logged}"
    );
}
