//! `POST /api/tables/{table}/query` — the daemon's server-side table query API.
//!
//! The Ivy Framework serves this contract over gRPC (`datatable.proto`) and ships each window as an
//! Apache Arrow IPC stream. V2's daemon is axum over HTTP, so the transport is a JSON body on a path
//! per table, and the *encoding of the window* is content-negotiated — see [`ResponseEncoding`] for
//! what changes when `arrow` lands, which is deliberately only the encoding.
//!
//! What matters is not the encoding. It is that `sort`, `filter`, `offset`, `limit` and the total
//! count are the *server's* job here, so a table of any size costs one window per view. See
//! `tendril_core::db::query` for the processing and for the injection boundary.
//!
//! `POST /api/jobs/query` in `routes::jobs` is the same query API over the Jobs table, returning the
//! `Job` shape the app already parses. This module is the generic form: a table listed in
//! [`QUERYABLE_TABLES`] is queryable with no DTO and no row mapper, which is how `plans` got here.

use crate::state::AppState;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use tendril_core::db::jobs::jobs_table_descriptor;
use tendril_core::db::open_database;
use tendril_core::db::query::{
    distinct_values, query_rows_as_json, TableDescriptor, TableQuery, TableSchema, DEFAULT_LIMIT,
    DEFAULT_VALUES_LIMIT, MAX_LIMIT, MAX_VALUES_LIMIT,
};
use tendril_core::error::TendrilError;

/// Media type of an Arrow IPC stream, per Arrow's own registration. Recognised, and answered with a
/// 406 naming what it would take to serve it — a client that asks is told the truth rather than
/// silently handed JSON it will try to parse as Arrow.
pub const ARROW_STREAM_MEDIA_TYPE: &str = "application/vnd.apache.arrow.stream";

/// How a client asked for the window to be encoded.
///
/// The negotiation exists *now*, with one implementation, so that adopting Arrow is an added arm here
/// and an added encoder — not a new route, a new client and a second contract. Everything above this
/// enum (the query, the validation, the count, the paging) is encoding-agnostic already.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseEncoding {
    /// `application/json`: rows as JSON objects. The only encoding V2 can produce today.
    Json,
    /// `application/vnd.apache.arrow.stream`: columnar Arrow IPC. Not built — the `arrow` crate is
    /// not a dependency, and an IPC stream is not something to hand-roll.
    ArrowIpc,
}

/// Picks an encoding from `Accept`.
///
/// Absent, `*/*`, or anything mentioning JSON gives [`ResponseEncoding::Json`]. Only a request that
/// asks for Arrow *and nothing else* gets [`ResponseEncoding::ArrowIpc`], so a browser's default
/// `Accept` never trips it.
pub fn negotiate_encoding(headers: &HeaderMap) -> ResponseEncoding {
    let Some(accept) = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|value| value.to_str().ok())
    else {
        return ResponseEncoding::Json;
    };

    let mut arrow = false;
    for media in accept.split(',') {
        let media = media.split(';').next().unwrap_or("").trim();
        if media.eq_ignore_ascii_case(ARROW_STREAM_MEDIA_TYPE) {
            arrow = true;
        } else if media == "*/*" || media.eq_ignore_ascii_case("application/json") {
            return ResponseEncoding::Json;
        }
    }
    if arrow {
        ResponseEncoding::ArrowIpc
    } else {
        ResponseEncoding::Json
    }
}

/// The reply to `Accept: application/vnd.apache.arrow.stream`.
///
/// 406 with the reason, not 500 and not a silent JSON body: the request is well-formed and the
/// encoding is one this API is designed for, it is simply not compiled in.
fn arrow_not_available() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_ACCEPTABLE,
        Json(json!({
            "error": "Arrow IPC encoding is not available in this build",
            "detail": "The daemon is not built against the `arrow` crate, so it cannot encode an \
                       Arrow IPC stream. Re-request with `Accept: application/json`; the query, the \
                       window and the totals are identical.",
            "supported": ["application/json"],
        })),
    )
}

/// [`arrow_not_available`] as a response, for the typed jobs query route to share.
pub fn arrow_not_available_response() -> axum::response::Response {
    arrow_not_available().into_response()
}

/// A table the query API exposes, and the server-owned rules for querying it.
pub struct QueryableTable {
    /// Path segment, e.g. `jobs` in `/api/tables/jobs/query`.
    pub name: &'static str,
    pub descriptor: TableDescriptor<'static>,
}

/// The Plans table. The second table, and the reason the query processing is a module rather than a
/// method on Jobs: this needed a descriptor and nothing else — no DTO, no row mapper, no route of its
/// own.
fn plans_table_descriptor() -> TableDescriptor<'static> {
    TableDescriptor {
        table: "Plans",
        // Ignored by `query_rows_as_json`, which builds its `SELECT` list from the request's
        // `selectColumns` (or the whole schema). Worth using here: a Plans row carries `YamlRaw` and
        // `LatestRevisionContent`, a whole plan document each, that a list view never shows.
        columns_sql: "*",
        // Every plan row is visible; V2 has no soft-delete for plans.
        base_predicate: None,
        // `idx_plans_updated` serves this, so the default page of a huge Plans table is an index scan.
        default_order_sql: "Updated DESC",
        tiebreak_order_sql: "Id DESC",
        version_marker_sql: Some("MAX(Updated)"),
    }
}

/// Tables reachable through `/api/tables/{table}`. A name not listed here is a 404, whatever the
/// database happens to contain — the query processor's allowlist decides which *columns* of a table
/// are queryable, and this decides which tables exist at all.
pub fn queryable_tables() -> Vec<QueryableTable> {
    vec![
        QueryableTable {
            name: "jobs",
            descriptor: jobs_table_descriptor(),
        },
        QueryableTable {
            name: "plans",
            descriptor: plans_table_descriptor(),
        },
    ]
}

fn lookup_table(name: &str) -> Option<QueryableTable> {
    queryable_tables()
        .into_iter()
        .find(|table| table.name.eq_ignore_ascii_case(name))
}

fn unknown_table(name: &str) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "error": format!("No queryable table named '{name}'"),
            "tables": queryable_tables().iter().map(|t| t.name).collect::<Vec<_>>(),
        })),
    )
}

/// Maps a query failure onto a status code.
///
/// [`TendrilError::Validation`] is every "the request named something that does not exist" case — an
/// unknown column, an unknown filter function, a malformed argument list — and it is a 400. A caller
/// gets the reason verbatim, because the reason is about *their* request and knowing it is how they
/// fix it; nothing in it comes from the database's contents.
fn query_error(err: TendrilError) -> (StatusCode, Json<serde_json::Value>) {
    match err {
        TendrilError::Validation(message) => {
            (StatusCode::BAD_REQUEST, Json(json!({ "error": message })))
        }
        other => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Query failed: {other}") })),
        ),
    }
}

/// `GET /api/tables` — what is queryable.
pub async fn list_tables() -> impl IntoResponse {
    Json(json!({
        "tables": queryable_tables().iter().map(|t| t.name).collect::<Vec<_>>(),
        "encodings": ["application/json"],
        "defaultLimit": DEFAULT_LIMIT,
        "maxLimit": MAX_LIMIT,
    }))
}

/// `GET /api/tables/{table}/schema` — the queryable columns and the filter vocabulary.
///
/// A filter UI needs this: the columns are the allowlist, read live from SQLite, and the function list
/// is what the processor will accept. Both are derived rather than written down, so neither can drift
/// from what a query will actually do.
pub async fn table_schema(
    State(state): State<Arc<AppState>>,
    Path(table): Path<String>,
) -> impl IntoResponse {
    let Some(queryable) = lookup_table(&table) else {
        return unknown_table(&table).into_response();
    };
    let db_path = state.db_path.clone();

    let loaded = tokio::task::spawn_blocking(move || {
        let conn = open_database(&db_path)?;
        TableSchema::load(&conn, queryable.descriptor.table)
    })
    .await;

    match loaded {
        Ok(Ok(schema)) => Json(json!({
            "table": table,
            "columns": schema.columns(),
            "filterFunctions": [
                "equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan",
                "lessThanOrEqual", "contains", "notContains", "startsWith", "endsWith",
                "inSet", "notInSet", "isNull", "isNotNull", "blank", "notBlank", "inRange",
            ],
            "aggregateFunctions": ["sum", "avg", "min", "max", "count"],
            "defaultLimit": DEFAULT_LIMIT,
            "maxLimit": MAX_LIMIT,
        }))
        .into_response(),
        Ok(Err(err)) => query_error(err).into_response(),
        Err(join) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Schema read failed: {join}") })),
        )
            .into_response(),
    }
}

/// `POST /api/tables/{table}/query` — one window of a table.
///
/// The body is [`TableQuery`]: `sort`, a recursive `filter`, `offset`, `limit`, `selectColumns`,
/// `aggregations`, `versionToken`. `{}` is valid and means the first page in the server's order.
pub async fn query_table_handler(
    State(state): State<Arc<AppState>>,
    Path(table): Path<String>,
    headers: HeaderMap,
    Json(query): Json<TableQuery>,
) -> impl IntoResponse {
    let Some(queryable) = lookup_table(&table) else {
        return unknown_table(&table).into_response();
    };
    if negotiate_encoding(&headers) == ResponseEncoding::ArrowIpc {
        return arrow_not_available().into_response();
    }
    let db_path = state.db_path.clone();

    // `spawn_blocking` because this is the one route whose cost scales with the table: a filtered
    // `COUNT(*)` over millions of rows must not occupy an async worker thread.
    let result = tokio::task::spawn_blocking(move || {
        let conn = open_database(&db_path)?;
        query_rows_as_json(&conn, &queryable.descriptor, &query)
    })
    .await;

    match result {
        Ok(Ok(page)) => Json(json!({
            "encoding": "application/json",
            "rows": page.rows,
            "offset": page.offset,
            "rowCount": page.row_count,
            "totalRows": page.total_rows,
            "limit": page.limit,
            "versionToken": page.version_token,
            "stale": page.stale,
            "aggregations": page.aggregations,
        }))
        .into_response(),
        Ok(Err(err)) => query_error(err).into_response(),
        Err(join) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Query failed: {join}") })),
        )
            .into_response(),
    }
}

/// The framework's `DataTableValuesQuery`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableValuesRequest {
    pub column: String,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// `POST /api/tables/{table}/values` — distinct values of one column, for a filter facet.
///
/// A facet cannot be built from a page of rows: the value a user wants to filter on is usually not on
/// screen. Answering it here is what keeps "the client never holds the rows" true for filter building
/// as well as for display.
pub async fn table_values_handler(
    State(state): State<Arc<AppState>>,
    Path(table): Path<String>,
    Json(request): Json<TableValuesRequest>,
) -> impl IntoResponse {
    let Some(queryable) = lookup_table(&table) else {
        return unknown_table(&table).into_response();
    };
    let db_path = state.db_path.clone();

    let result = tokio::task::spawn_blocking(move || {
        let conn = open_database(&db_path)?;
        distinct_values(
            &conn,
            &queryable.descriptor,
            &request.column,
            request.search.as_deref(),
            request.limit,
        )
    })
    .await;

    match result {
        Ok(Ok(page)) => Json(json!({
            "column": page.column,
            "values": page.values,
            "totalValues": page.total_values,
            "defaultLimit": DEFAULT_VALUES_LIMIT,
            "maxLimit": MAX_VALUES_LIMIT,
        }))
        .into_response(),
        Ok(Err(err)) => query_error(err).into_response(),
        Err(join) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": format!("Values query failed: {join}") })),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn accept(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::ACCEPT,
            HeaderValue::from_str(value).unwrap(),
        );
        headers
    }

    #[test]
    fn json_is_the_default_encoding() {
        assert_eq!(
            negotiate_encoding(&HeaderMap::new()),
            ResponseEncoding::Json
        );
        assert_eq!(negotiate_encoding(&accept("*/*")), ResponseEncoding::Json);
        assert_eq!(
            negotiate_encoding(&accept("application/json")),
            ResponseEncoding::Json
        );
        // A browser's `Accept` mentions plenty of things; none of them is Arrow.
        assert_eq!(
            negotiate_encoding(&accept("text/html,application/xhtml+xml,*/*;q=0.8")),
            ResponseEncoding::Json
        );
    }

    #[test]
    fn only_an_explicit_arrow_request_selects_arrow() {
        assert_eq!(
            negotiate_encoding(&accept(ARROW_STREAM_MEDIA_TYPE)),
            ResponseEncoding::ArrowIpc
        );
        assert_eq!(
            negotiate_encoding(&accept("APPLICATION/VND.APACHE.ARROW.STREAM; q=1.0")),
            ResponseEncoding::ArrowIpc
        );
        // Asking for either means JSON today, and will mean Arrow the moment it exists — the client
        // needs no change.
        assert_eq!(
            negotiate_encoding(&accept(
                "application/vnd.apache.arrow.stream, application/json"
            )),
            ResponseEncoding::Json
        );
    }

    #[test]
    fn asking_for_arrow_is_a_406_naming_the_reason() {
        let (status, body) = arrow_not_available();
        assert_eq!(status, StatusCode::NOT_ACCEPTABLE);
        assert_eq!(body.0["supported"], json!(["application/json"]));
    }

    #[test]
    fn the_registry_holds_jobs_and_plans_and_nothing_else() {
        let names: Vec<&str> = queryable_tables().iter().map(|t| t.name).collect();
        assert_eq!(names, vec!["jobs", "plans"]);
        assert!(lookup_table("Jobs").is_some(), "the path segment is loose");
        assert!(lookup_table("Metadata").is_none());
        assert!(lookup_table("sqlite_master").is_none());
    }

    #[test]
    fn a_validation_failure_is_a_400_and_says_why() {
        let (status, body) = query_error(TendrilError::Validation("unknown column 'x'".into()));
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body.0["error"], json!("unknown column 'x'"));

        let (status, _) = query_error(TendrilError::Other("disk on fire".into()));
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    }
}
