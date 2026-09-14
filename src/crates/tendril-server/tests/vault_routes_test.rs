//! `/api/vaults` route contract — the surface plan 00574's Settings UI is written against.
//!
//! Each test runs a real router over a throwaway `TENDRIL_HOME`, removed on drop. **No test may reach
//! `gh` or the network**: `discover`, `create`, `push` and `delete` are exercised only through their
//! validation paths, which reject before any git or GitHub call.

use std::path::PathBuf;
use std::sync::Arc;
use tendril_core::config::{get_config_path, MasterGuard};
use tendril_server::{create_router, AppState};

struct TestServer {
    tendril_home: PathBuf,
    port: u16,
    secret: String,
    _guard: MasterGuard,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = std::fs::remove_dir_all(&self.tendril_home);
    }
}

impl TestServer {
    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{}", self.port, path)
    }

    fn vault_dir(&self) -> PathBuf {
        self.tendril_home.join("Vaults").join("abc12345")
    }

    /// Connects a vault in `config.yaml` pointing at [`Self::vault_dir`], with the given projects.
    fn write_config(&self, projects_yaml: &str) {
        let path = self.vault_dir();
        std::fs::write(
            get_config_path(&self.tendril_home),
            format!(
                "projects:\n{projects}vault:\n  id: abc12345\n  name: acme/Tendril-Vault\n  enabled: true\n  repoUrl: https://github.com/acme/Tendril-Vault.git\n  localPath: {path}\nvaults:\n  - id: abc12345\n    name: acme/Tendril-Vault\n    enabled: true\n    repoUrl: https://github.com/acme/Tendril-Vault.git\n    localPath: {path}\n",
                projects = projects_yaml,
                path = path.to_string_lossy()
            ),
        )
        .expect("write config.yaml");
    }
}

async fn start_test_server() -> TestServer {
    let tendril_home = std::env::temp_dir().join(format!(
        "tendril-vault-routes-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&tendril_home).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();

    let secret = tendril_core::config::generate_bearer_secret();
    let guard = MasterGuard::acquire(&tendril_home, port, &secret, "127.0.0.1").unwrap();

    let plans_dir = tendril_home.join("Plans");
    std::fs::create_dir_all(&plans_dir).unwrap();
    let state = Arc::new(AppState::with_plans_dir(
        tendril_home.clone(),
        plans_dir,
        secret.clone(),
    ));
    let app = create_router(state);

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    TestServer {
        tendril_home,
        port,
        secret,
        _guard: guard,
        shutdown_tx: Some(shutdown_tx),
    }
}

#[tokio::test]
async fn a_fresh_home_lists_no_vaults() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();

    let response = client
        .get(server.url("/api/vaults"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("GET /api/vaults");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body, serde_json::json!([]));
}

#[tokio::test]
async fn an_unknown_vault_id_is_a_404() {
    let server = start_test_server().await;
    server.write_config("");
    let client = reqwest::Client::new();

    let response = client
        .get(server.url("/api/vaults/nope"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("GET /api/vaults/nope");

    assert_eq!(
        response.status(),
        404,
        "a typo must not be answered as if it were 'default'"
    );
    let body: serde_json::Value = response.json().await.unwrap();
    assert!(body["error"].as_str().unwrap().contains("nope"));
}

#[tokio::test]
async fn the_default_id_resolves_to_the_primary_vault() {
    let server = start_test_server().await;
    server.write_config("");
    std::fs::create_dir_all(server.vault_dir()).unwrap();
    let client = reqwest::Client::new();

    let response = client
        .get(server.url("/api/vaults/default"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("GET /api/vaults/default");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["id"], "abc12345");
    assert_eq!(body["name"], "acme/Tendril-Vault");
    assert_eq!(body["repoUrl"], "https://github.com/acme/Tendril-Vault.git");
    assert_eq!(body["isConfigured"], true);
}

#[tokio::test]
async fn the_catalog_is_served_for_a_hand_built_vault_tree() {
    let server = start_test_server().await;
    server.write_config("");

    let vault = server.vault_dir();
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::write(
        vault.join("vault.yaml"),
        "schemaVersion: 1\nname: acme/Tendril-Vault\nversion: 2026.09.14.101500\nupdatedAt: 2026-09-14T10:15:00Z\n",
    )
    .unwrap();

    let alpha = vault.join("projects").join("Alpha");
    std::fs::create_dir_all(alpha.join("skills")).unwrap();
    std::fs::write(alpha.join("skills").join("rust.md"), "# rust\n").unwrap();
    std::fs::write(
        alpha.join("project.yaml"),
        "schemaVersion: 1\nname: Alpha\nversion: 1.2.3\nupdatedAt: 2026-09-14T10:15:00Z\ncontext: The alpha project\n",
    )
    .unwrap();

    let client = reqwest::Client::new();
    let response = client
        .get(server.url("/api/vaults/default/catalog"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("GET catalog");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["manifest"]["version"], "2026.09.14.101500");
    assert_eq!(body["projects"][0]["name"], "Alpha");
    assert_eq!(body["projects"][0]["remoteVersion"], "1.2.3");
    assert_eq!(body["projects"][0]["skillNames"][0], "rust");
    assert_eq!(body["projects"][0]["syncStatus"], "NotImported");

    // The catalog of an unknown vault is a 404, same as its status.
    let response = client
        .get(server.url("/api/vaults/nope/catalog"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 404);
}

#[tokio::test]
async fn auto_sync_is_toggled_and_persisted() {
    let server = start_test_server().await;
    server.write_config("");
    let client = reqwest::Client::new();

    let response = client
        .put(server.url("/api/vaults/abc12345"))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({ "alwaysUpToDate": true }))
        .send()
        .await
        .expect("PUT /api/vaults/abc12345");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["success"], true);

    let response = client
        .get(server.url("/api/vaults"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(
        body[0]["alwaysUpToDate"], true,
        "the change is written back to config.yaml"
    );
}

#[tokio::test]
async fn disconnecting_removes_the_vault_and_keeps_the_clone() {
    let server = start_test_server().await;
    server.write_config("");
    let vault = server.vault_dir();
    std::fs::create_dir_all(&vault).unwrap();
    std::fs::write(vault.join("vault.yaml"), "schemaVersion: 1\n").unwrap();

    let client = reqwest::Client::new();
    let response = client
        .delete(server.url("/api/vaults/abc12345"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("DELETE /api/vaults/abc12345");

    assert_eq!(response.status(), 200);

    let response = client
        .get(server.url("/api/vaults"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body, serde_json::json!([]));
    assert!(
        vault.join("vault.yaml").exists(),
        "the local clone is kept — disconnecting must not delete a teammate's work"
    );
}

#[tokio::test]
async fn a_missing_vault_project_is_a_404_on_import_and_delete() {
    // Both routes reject before touching git or `gh`, which is what keeps this test offline.
    let server = start_test_server().await;
    server.write_config("");
    std::fs::create_dir_all(server.vault_dir().join("projects")).unwrap();
    let client = reqwest::Client::new();

    let response = client
        .post(server.url("/api/vaults/default/projects"))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({ "projectName": "Nope" }))
        .send()
        .await
        .expect("POST projects");
    assert_eq!(response.status(), 404);

    let response = client
        .delete(server.url("/api/vaults/default/projects/Nope"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("DELETE project");
    assert_eq!(response.status(), 404);
}

#[tokio::test]
async fn pushing_to_an_uninitialized_clone_fails_before_any_git_call() {
    // This is the guard that keeps the route test offline: push rejects a vault directory without a
    // `.git`, before it would check out a branch or invoke `gh`. Project names are validated by the
    // CLI, not here — the service skips an unknown name, as the C# does.
    let server = start_test_server().await;
    server.write_config("");
    let client = reqwest::Client::new();

    let response = client
        .post(server.url("/api/vaults/default/push"))
        .bearer_auth(&server.secret)
        .json(&serde_json::json!({
            "projectNames": ["Nope"],
            "version": "2026.09.14.101500",
            "prTitle": "feat(vault): update Nope",
            "prBody": "body"
        }))
        .send()
        .await
        .expect("POST push");

    assert_eq!(
        response.status(),
        500,
        "a failed result answers 500 with the detail in the body"
    );
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["success"], false);
    assert_eq!(
        body["errorMessage"], "Vault repository is not initialized locally.",
        "got: {}",
        body
    );
}

#[tokio::test]
async fn pulling_an_uninitialized_clone_is_a_no_op_rather_than_a_git_call() {
    // Pull skips a vault with no `.git` instead of failing: a vault the user connected but has not
    // cloned yet must not break a sync across several vaults. Nothing is invoked, so this stays offline.
    let server = start_test_server().await;
    server.write_config("");
    let client = reqwest::Client::new();

    let response = client
        .post(server.url("/api/vaults/default/pull"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("POST pull");

    assert_eq!(response.status(), 200);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["success"], true);
    assert_eq!(body["updatedProjectsCount"], 0);
}

#[tokio::test]
async fn pulling_with_no_vault_configured_is_a_failure() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();

    let response = client
        .post(server.url("/api/vaults/default/pull"))
        .bearer_auth(&server.secret)
        .send()
        .await
        .expect("POST pull");

    assert_eq!(response.status(), 500);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["success"], false);
    assert_eq!(body["message"], "No vaults are configured.");
}

#[tokio::test]
async fn the_vault_routes_require_authentication() {
    let server = start_test_server().await;
    let client = reqwest::Client::new();

    let response = client
        .get(server.url("/api/vaults"))
        .send()
        .await
        .expect("GET /api/vaults without a token");

    assert_eq!(
        response.status(),
        401,
        "a vault holds team configuration; the routes must sit behind the protected router"
    );
}
