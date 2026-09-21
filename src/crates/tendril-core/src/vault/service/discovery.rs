//! GitHub discovery: which accounts the signed-in user can create a vault under, and which of
//! their existing repositories already look like vaults.// ---------------------------------------------------------------------------------------------

use super::internals::{argv, load_state, production_gh, GhRunner};
use crate::error::Result;
use crate::vault::models::*;
use crate::vault::settings::normalize_repo_url;
use std::collections::BTreeSet;
use std::path::Path;

// GitHub discovery
// ---------------------------------------------------------------------------------------------

/// The signed-in user (as `Personal`) followed by their organizations.
pub async fn list_github_accounts() -> Result<Vec<GitHubAccountOption>> {
    list_github_accounts_with(&production_gh).await
}

pub async fn list_github_accounts_with(gh: GhRunner<'_>) -> Result<Vec<GitHubAccountOption>> {
    let mut accounts = Vec::new();

    let (code, stdout, _) = gh(argv(&["api", "user", "--jq", ".login"]), None).await?;
    let login = stdout.trim().to_string();
    // A `{`-prefixed body is a JSON error payload, not a login.
    if code == 0 && !login.is_empty() && !login.starts_with('{') {
        accounts.push(GitHubAccountOption {
            login,
            account_type: "Personal".to_string(),
        });
    }

    let (code, stdout, _) = gh(argv(&["api", "user/orgs", "--jq", ".[].login"]), None).await?;
    if code == 0 {
        for org in stdout.lines().map(str::trim).filter(|org| !org.is_empty()) {
            accounts.push(GitHubAccountOption {
                login: org.to_string(),
                account_type: "Organization".to_string(),
            });
        }
    }

    Ok(accounts)
}

/// Looks for vault repositories across the user's accounts and organizations: the conventional
/// `Tendril-Vault` first, then any repository whose name contains `vault`. Already-connected repos are
/// filtered out by normalized URL, so the SSH and HTTPS spellings of one repo cannot both show up.
pub async fn discover_existing_vaults(tendril_home: &Path) -> Result<Vec<DiscoveredVaultRepo>> {
    discover_existing_vaults_with(tendril_home, &production_gh).await
}

pub async fn discover_existing_vaults_with(
    tendril_home: &Path,
    gh: GhRunner<'_>,
) -> Result<Vec<DiscoveredVaultRepo>> {
    let (_, state) = load_state(tendril_home)?;
    let mut seen: BTreeSet<String> = state
        .vaults
        .iter()
        .filter(|vault| !vault.repo_url.trim().is_empty())
        .map(|vault| normalize_repo_url(&vault.repo_url))
        .collect();

    let mut discovered = Vec::new();

    for account in list_github_accounts_with(gh).await? {
        let (code, stdout, _) = gh(
            argv(&[
                "api",
                &format!("repos/{}/Tendril-Vault", account.login),
                "--jq",
                "{fullName: .full_name, url: .html_url, isPrivate: .private}",
            ]),
            None,
        )
        .await?;

        if code == 0 && !stdout.trim().is_empty() {
            match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
                Ok(value) => {
                    let full_name = value
                        .get("fullName")
                        .and_then(|value| value.as_str())
                        .map(|name| name.to_string())
                        .unwrap_or_else(|| format!("{}/Tendril-Vault", account.login));
                    let url = value
                        .get("url")
                        .and_then(|value| value.as_str())
                        .map(|url| url.to_string())
                        .unwrap_or_else(|| format!("https://github.com/{}.git", full_name));
                    let is_private = value
                        .get("isPrivate")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);

                    if seen.insert(normalize_repo_url(&url)) {
                        discovered.push(DiscoveredVaultRepo {
                            full_name,
                            repo_url: url,
                            owner: account.login.clone(),
                            name: "Tendril-Vault".to_string(),
                            is_private,
                            account_type: account.account_type.clone(),
                        });
                    }
                }
                Err(e) => tracing::debug!(
                    "Failed parsing Tendril-Vault for account {}: {}",
                    account.login,
                    e
                ),
            }
        }

        let (code, stdout, _) = gh(
            argv(&[
                "repo",
                "list",
                &account.login,
                "--limit",
                "30",
                "--json",
                "nameWithOwner,url,isPrivate,name",
            ]),
            None,
        )
        .await?;

        if code != 0 || stdout.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
            Ok(serde_json::Value::Array(items)) => {
                for item in items {
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let full_name = item
                        .get("nameWithOwner")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default();
                    let url = item.get("url").and_then(|v| v.as_str()).unwrap_or_default();
                    let is_private = item
                        .get("isPrivate")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    if !name.to_lowercase().contains("vault") {
                        continue;
                    }
                    if seen.insert(normalize_repo_url(url)) {
                        discovered.push(DiscoveredVaultRepo {
                            full_name: full_name.to_string(),
                            repo_url: url.to_string(),
                            owner: account.login.clone(),
                            name: name.to_string(),
                            is_private,
                            account_type: account.account_type.clone(),
                        });
                    }
                }
            }
            Ok(_) => {}
            Err(e) => tracing::debug!(
                "Failed parsing repo list for account {}: {}",
                account.login,
                e
            ),
        }
    }

    Ok(discovered)
}
