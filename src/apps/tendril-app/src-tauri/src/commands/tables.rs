//! The webview's one way into the daemon's server-paged table API.
//!
//! `POST /api/jobs/query` and `POST /api/tables/{table}/query` are how a table of any size costs one
//! window per view — SQLite does the sort, the filter and the paging, and the reply carries the
//! filtered total. None of that is reachable from the webview directly: the daemon's bearer secret is
//! read from `.master` natively and never crosses into the webview, and there is no `/api` proxy in the
//! packaged app, so a relative `fetch("/api/jobs/query")` resolves against the asset origin and gets
//! neither the daemon nor a credential. A `#[tauri::command]` is the only caller that can authenticate,
//! which is why this exists.
//!
//! It is deliberately one delegation and no row mapping. The row shape belongs to the route being
//! queried, and `api/tableQuery.ts` is the single place a page is decoded — the seam an Arrow encoding
//! would slot into later without any call site changing. A jobs-specific mapper wedged in here would
//! cost that on both counts, which is why `POST /api/jobs/query` projects the app's `Job` shape
//! server-side instead (`tendril-server/src/routes/jobs.rs`).

use super::get_client_from_master;
use crate::error::BridgeError;

/// Whether `path` is one of the query API's own paths.
///
/// The path is caller-supplied, and a command that forwarded any path would be an authenticated proxy
/// onto every route the daemon has — including the ones that start jobs and write plans — reachable by
/// anything running in the webview. So the shape is checked here rather than trusted: the two query
/// paths and the values path, and nothing else.
///
/// The table segment is left to the daemon to resolve, which answers 404 naming the tables that do
/// exist. What is enforced is that it *is* one segment: a segment carrying `/` could name a different
/// route entirely, and `..` could climb out of `/api`. A percent-encoded segment is fine — axum decodes
/// it into a table name that then fails the daemon's own allowlist.
fn is_query_path(path: &str) -> bool {
    if path == "/api/jobs/query" {
        return true;
    }
    let Some(rest) = path.strip_prefix("/api/tables/") else {
        return false;
    };
    let Some((table, action)) = rest.rsplit_once('/') else {
        return false;
    };
    if !matches!(action, "query" | "values") {
        return false;
    }
    // One segment, non-empty, and not a climb. `%2F` is left alone deliberately: the daemon decodes it
    // and 404s, which is a clearer answer than a refusal here would be.
    !table.is_empty() && !table.contains('/') && table != ".." && table != "."
}

/// One window of a table, or one column's distinct values, from the daemon's query API.
///
/// `path` is the route (`/api/jobs/query`, `/api/tables/{table}/query`, `/api/tables/{table}/values`)
/// and `body` is its JSON body — the daemon's `TableQuery` for a query, `{ column, search, limit }` for
/// values. Both are forwarded as they arrive and the reply is handed back untouched.
///
/// A rejected query keeps the daemon's own reason: `TABLE_QUERY_FAILED` whose message names the column
/// or function that was wrong, because that sentence is what a filter UI has to show the operator.
#[tauri::command]
pub async fn cmd_query_table(
    path: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, BridgeError> {
    if !is_query_path(&path) {
        return Err(BridgeError::validation(format!(
            "'{path}' is not a table query path. Use /api/jobs/query, \
             /api/tables/{{table}}/query or /api/tables/{{table}}/values."
        )));
    }

    get_client_from_master()?.post_query(&path, body).await
}

#[cfg(test)]
mod tests {
    use super::is_query_path;

    #[test]
    fn the_query_api_paths_are_allowed() {
        assert!(is_query_path("/api/jobs/query"));
        assert!(is_query_path("/api/tables/jobs/query"));
        assert!(is_query_path("/api/tables/plans/query"));
        assert!(is_query_path("/api/tables/jobs/values"));
        // Encoded by the caller, resolved (and refused) by the daemon.
        assert!(is_query_path("/api/tables/..%2Fjobs/query"));
    }

    #[test]
    fn nothing_else_is() {
        for path in [
            // The whole point of the check: a command that forwarded these would let anything in the
            // webview start jobs and write plans with the daemon's own credential.
            "/api/jobs",
            "/api/jobs/00021/cancel",
            "/api/plans",
            "/api/config",
            // Not one segment, or climbing out of it.
            "/api/tables/../jobs/query",
            "/api/tables//query",
            "/api/tables/jobs/schema",
            "/api/tables/jobs",
            // Not this daemon at all.
            "http://evil.example/api/jobs/query",
            "//evil.example/api/jobs/query",
            "",
        ] {
            assert!(!is_query_path(path), "{path} must be refused");
        }
    }
}
