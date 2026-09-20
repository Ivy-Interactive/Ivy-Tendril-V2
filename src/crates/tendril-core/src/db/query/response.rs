//! Response shape — one window of a table, its total, and its aggregates.

use serde::Serialize;
use serde_json::Value as JsonValue;

/// One window of a table, plus everything a pager needs to draw a footer.
///
/// `total_rows` is counted *after* the filter and *before* the window, which is exactly what makes a
/// server-paged table honest: the footer says "41–50 of 3,214,908" without a client ever seeing
/// 3,214,908 rows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPage<T> {
    pub rows: Vec<T>,
    /// The applied offset, after clamping. Echoed so a client can tell its request was adjusted.
    pub offset: i64,
    /// `rows.len()`, i.e. how many rows this window actually holds.
    pub row_count: usize,
    /// Rows matching the filter across the whole table.
    pub total_rows: i64,
    /// The applied limit, after clamping.
    pub limit: i64,
    /// Opaque marker of this filtered result set's shape. See [`TableQuery::version_token`].
    pub version_token: String,
    /// `true` when the request carried a `version_token` that no longer matches.
    pub stale: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub aggregations: Vec<AggregationResult>,
}

impl<T> QueryPage<T> {
    /// Replaces the rows, keeping the window metadata. Used by the route layer to turn mapped
    /// entities into projected JSON without duplicating the counters.
    pub fn map_rows<U>(self, f: impl FnOnce(Vec<T>) -> Vec<U>) -> QueryPage<U> {
        QueryPage {
            rows: f(self.rows),
            offset: self.offset,
            row_count: self.row_count,
            total_rows: self.total_rows,
            limit: self.limit,
            version_token: self.version_token,
            stale: self.stale,
            aggregations: self.aggregations,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregationResult {
    pub column: String,
    pub function: String,
    /// `null` when the aggregate has no value — an empty set, or `SUM` over all-NULL rows.
    pub value: Option<JsonValue>,
}
