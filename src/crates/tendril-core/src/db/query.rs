//! Server-side table query processing: sort, a recursive filter, a window, a total count and
//! aggregates, all evaluated by SQLite.
//!
//! This is V2's port of the Ivy Framework's `Ivy/Views/DataTables/QueryProcessor.cs` and the
//! `datatable.proto` contract it serves. The framework ships its result window as an Apache Arrow
//! IPC stream, and V2 will too once the dependency exists — but Arrow is not what makes a
//! million-row table work. *This module* is. A client that can push its sort, its filter and its
//! window down to the database never holds more than one screen of rows, whatever the table's size;
//! a client that cannot must fetch everything and will die at a few hundred thousand rows no matter
//! how efficiently the bytes were encoded. Arrow shrinks and speeds up the transfer of a window.
//! Server-side query processing is what makes the window exist at all.
//!
//! ## What adopting Arrow would change
//!
//! Nothing above the encoding, by design. The whole list, for whoever has a network:
//!
//! 1. `tendril-core/Cargo.toml`: add `arrow-array`, `arrow-schema` and `arrow-ipc` (one version, all
//!    three from the same release). Not the `arrow` umbrella crate — it pulls in Parquet, CSV, JSON and
//!    Flight, none of which this needs.
//! 2. A new `db/query_arrow.rs`: a `Vec<ColumnInfo>` → `arrow_schema::Schema` map (the framework's is
//!    in `QueryHelpers.GetArrowType`; for SQLite, `TEXT` → `Utf8`, `INTEGER` → `Int64`, `REAL` →
//!    `Float64`, and the RFC 3339 timestamp columns either stay `Utf8` or become
//!    `Timestamp(Microsecond, Some("UTC"))` — pick one and pin it in a test, because the frontend has
//!    to know), plus a row-major → columnar builder and `StreamWriter::write`/`finish`. Do not
//!    hand-write IPC framing.
//! 3. [`query_table`] gains a sibling that returns `Vec<u8>` instead of `Vec<T>`; the plan, the
//!    validation, the count, the version token and the aggregates are shared unchanged. That sharing
//!    is why the planning and the row mapping are separate functions here.
//! 4. `routes::tables`: fill in the `ResponseEncoding::ArrowIpc` arm that currently answers 406 —
//!    body is the IPC bytes, `Content-Type: application/vnd.apache.arrow.stream`, and the counters
//!    (`offset`, `rowCount`, `totalRows`, `versionToken`, `stale`) move into response *headers*,
//!    because the body is no longer JSON. That header naming is the only new wire decision.
//! 5. Frontend: `apache-arrow` in `packages/components`, and one branch in the app's
//!    `api/tableQuery.ts` that sets the `Accept` header, reads `arrayBuffer()` and does
//!    `tableFromIPC(bytes)` → rows. `useRemoteDataTable`, `DataTable` and every call site are
//!    untouched: a page is `{ rows, totalRows }` either way.
//! 6. Two gotchas the framework hit. `tableFromIPC` yields `BigInt` for Int64 columns and a scaled
//!    integer object for decimals, so the row mapper has to convert both — theirs does it twice, in
//!    `tableDataMapper.ts` and `arrowDecimal.ts`. And a zero-row result is still a valid, non-empty
//!    schema-only stream; "no bytes" is an error, not an empty page.
//!
//! What would *not* change: this module's request shape, the column allowlist, the filter vocabulary,
//! the SQL, the totals, `spawn_blocking`, the routes' paths, the hook, or any view. Arrow is an
//! encoding of the window, and the window is the part that matters.
//!
//! ## Injection safety
//!
//! Every part of a query arrives from a client, so the module keeps a hard line between *values* and
//! *identifiers*:
//!
//! - **Values** — filter arguments, the limit, the offset — are never formatted into SQL. They are
//!   bound as positional parameters ([`QueryPlan::params`]), including inside `IN (…)` lists, where a
//!   placeholder is emitted per argument.
//! - **Identifiers** — column names in `filter`, `sort`, `aggregations` and `selectColumns` — are
//!   never used as given. A name is *resolved* against [`TableSchema`], which is read from SQLite
//!   itself (`pragma_table_info`, with the table name bound as a parameter), and what reaches the SQL
//!   text is the `&str` the schema handed back, not the caller's bytes. An unresolvable name is a
//!   [`TendrilError::Validation`], i.e. HTTP 400.
//! - **Functions and operators** are parsed into the closed [`FilterFunction`], [`LogicalOperator`],
//!   [`SortDirection`] and [`AggregateFunction`] enums; the SQL fragment comes from a `match` arm, so
//!   an unknown function is a 400 rather than a fragment of SQL.
//! - **Table names, the projection list, the base predicate and the default sort** come from a
//!   [`TableDescriptor`] built in Rust, never from the request.

use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::error::{Result, TendrilError};

/// Rows returned when a request names no `limit`. A window, not a table dump.
pub const DEFAULT_LIMIT: i64 = 100;

/// Hard ceiling on `limit`. A larger request is clamped rather than refused, so a client asking for
/// too much still gets a usable page instead of an error. The point of the ceiling is that no single
/// response can be asked to materialise an unbounded number of rows — which is the whole reason this
/// module exists.
pub const MAX_LIMIT: i64 = 5_000;

/// Values returned by [`distinct_values`] when a request names no `limit`.
pub const DEFAULT_VALUES_LIMIT: i64 = 100;

/// Ceiling on [`distinct_values`]' `limit`.
pub const MAX_VALUES_LIMIT: i64 = 1_000;

// ---------------------------------------------------------------------------
// Request shape — the proto's `DataTableQuery`, adapted to HTTP/JSON
// ---------------------------------------------------------------------------

/// The framework's `DataTableQuery`, minus the gRPC-only fields.
///
/// `connectionId`/`sourceId` are gone: the framework needs them because one `DataTableService`
/// multiplexes every table in an app over one stream, whereas V2 routes each table to its own path
/// (`POST /api/tables/{table}/query`), so the path *is* the source id. `arrow_ipc_stream` is not
/// here because it is a property of the *response encoding*, not the query — see [`QueryPage`].
///
/// Every field has a default, so `{}` is a valid body meaning "the first page, server's order".
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TableQuery {
    /// Sort keys in precedence order. Empty means the descriptor's default sort.
    #[serde(default)]
    pub sort: Vec<SortOrder>,
    /// Recursive filter. `None` means unfiltered.
    #[serde(default)]
    pub filter: Option<Filter>,
    /// First row of the window, 0-based. Negative values clamp to 0.
    #[serde(default)]
    pub offset: i64,
    /// Window size. `None` means [`DEFAULT_LIMIT`]; values above [`MAX_LIMIT`] clamp to it, and
    /// values `<= 0` fall back to the default rather than returning an empty page.
    #[serde(default)]
    pub limit: Option<i64>,
    /// Response fields to keep. Empty means all of them. Names are validated against the schema so a
    /// typo is a 400, then applied to the serialized rows by the route layer — see
    /// [`TableSchema::resolve_all`].
    #[serde(default)]
    pub select_columns: Vec<String>,
    /// Aggregates over the *filtered* set, ignoring the window. Feeds a table footer.
    #[serde(default)]
    pub aggregations: Vec<Aggregation>,
    /// The [`QueryPage::version_token`] of the last response this client saw. When it no longer
    /// matches, the reply carries `stale: true`, meaning "rows were inserted or removed under you;
    /// the offsets you are paging through have shifted".
    #[serde(default)]
    pub version_token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

impl SortDirection {
    fn as_sql(self) -> &'static str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }
}

/// Accepts the proto's `ASC`/`DESC` and the frontend `DataTableSort`'s
/// `Ascending`/`Descending`, in any case, so neither side has to translate.
impl<'de> Deserialize<'de> for SortDirection {
    fn deserialize<D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> std::result::Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        match normalize_token(&raw).as_str() {
            "asc" | "ascending" => Ok(Self::Asc),
            "desc" | "descending" => Ok(Self::Desc),
            _ => Err(serde::de::Error::custom(format!(
                "unknown sort direction '{raw}'"
            ))),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SortOrder {
    pub column: String,
    #[serde(default = "default_sort_direction")]
    pub direction: SortDirection,
}

fn default_sort_direction() -> SortDirection {
    SortDirection::Asc
}

/// One node of the proto's recursive `Filter`: a leaf condition or a group, either of which may be
/// negated.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Filter {
    #[serde(flatten)]
    pub node: FilterNode,
    #[serde(default)]
    pub negate: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterNode {
    Condition(Condition),
    Group(FilterGroup),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Condition {
    pub column: String,
    /// One of [`FilterFunction`]'s names. Parsed, not interpolated.
    pub function: String,
    /// Scalar JSON values. Bound as parameters, one placeholder each.
    #[serde(default)]
    pub args: Vec<JsonValue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogicalOperator {
    And,
    Or,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilterGroup {
    pub op: LogicalOperator,
    #[serde(default)]
    pub filters: Vec<Filter>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Aggregation {
    pub column: String,
    pub function: String,
}

/// The comparison vocabulary, closed by construction.
///
/// The names are the framework's, checked against `QueryProcessor.BuildConditionExpression`'s switch:
/// `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`,
/// `contains`, `notContains`, `startsWith`, `endsWith`, `blank`, `notBlank`, `inRange`, `before`,
/// `after`. `before`/`after` are its aliases for `lessThan`/`greaterThan`, and `inRange` is its
/// inclusive two-argument range — kept under those names so a filter built by the framework's query
/// editor means the same thing here.
///
/// Two deliberate additions, both from `datatable.proto`'s own comment (`"inSet"`), which the
/// framework's server never implemented: `inSet`/`notInSet`. A status facet is the single most common
/// filter a jobs table needs, and expressing it as a chain of OR'd `equals` conditions makes the
/// client build SQL-shaped trees for something SQLite says as `IN (…)`. `isBlank`/`isNotBlank` are
/// accepted too, because the framework's *frontend* emits those names while its server only answers
/// to `blank`/`notBlank` — a live mismatch worth not reproducing.
///
/// Parsing is forgiving about spelling — `greaterThan`, `greater_than` and `GREATERTHAN` are one
/// function — and unforgiving about vocabulary: an unknown name is a 400, never a fragment of SQL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterFunction {
    Equals,
    NotEquals,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    InSet,
    NotInSet,
    IsNull,
    IsNotNull,
    /// `NULL` or the empty string, the framework's `blank`.
    Blank,
    NotBlank,
    /// Inclusive two-argument range, the framework's `inRange`.
    Between,
}

impl FilterFunction {
    pub fn parse(raw: &str) -> Result<Self> {
        let name = normalize_token(raw);
        Ok(match name.as_str() {
            "equals" | "eq" => Self::Equals,
            "notequals" | "ne" | "neq" => Self::NotEquals,
            "greaterthan" | "gt" | "after" => Self::GreaterThan,
            "greaterthanorequal" | "gte" | "greaterthanorequals" => Self::GreaterThanOrEqual,
            "lessthan" | "lt" | "before" => Self::LessThan,
            "lessthanorequal" | "lte" | "lessthanorequals" => Self::LessThanOrEqual,
            "contains" => Self::Contains,
            "notcontains" => Self::NotContains,
            "startswith" => Self::StartsWith,
            "endswith" => Self::EndsWith,
            "inset" | "in" => Self::InSet,
            "notinset" | "notin" => Self::NotInSet,
            "isnull" => Self::IsNull,
            "isnotnull" => Self::IsNotNull,
            "blank" | "isblank" => Self::Blank,
            "notblank" | "isnotblank" => Self::NotBlank,
            "between" | "inrange" => Self::Between,
            _ => {
                return Err(TendrilError::Validation(format!(
                    "unknown filter function '{raw}'"
                )))
            }
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggregateFunction {
    Sum,
    Avg,
    Min,
    Max,
    Count,
}

impl AggregateFunction {
    pub fn parse(raw: &str) -> Result<Self> {
        Ok(match normalize_token(raw).as_str() {
            "sum" => Self::Sum,
            "avg" | "average" | "mean" => Self::Avg,
            "min" => Self::Min,
            "max" => Self::Max,
            "count" => Self::Count,
            _ => {
                return Err(TendrilError::Validation(format!(
                    "unknown aggregate function '{raw}'"
                )))
            }
        })
    }

    fn as_sql(self) -> &'static str {
        match self {
            Self::Sum => "SUM",
            Self::Avg => "AVG",
            Self::Min => "MIN",
            Self::Max => "MAX",
            Self::Count => "COUNT",
        }
    }

    fn canonical_name(self) -> &'static str {
        match self {
            Self::Sum => "sum",
            Self::Avg => "avg",
            Self::Min => "min",
            Self::Max => "max",
            Self::Count => "count",
        }
    }
}

/// Whether `name` could be a bare SQL identifier: ASCII letters, digits and `_`, not starting with a
/// digit. Every column V2's schema declares is one.
fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Lowercases and strips `_`, `-` and spaces, so one vocabulary serves callers that spell it
/// `camelCase`, `snake_case` or `Title Case`.
fn normalize_token(raw: &str) -> String {
    raw.chars()
        .filter(|c| *c != '_' && *c != '-' && *c != ' ')
        .flat_map(char::to_lowercase)
        .collect()
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Schema: the column allowlist, read from SQLite
// ---------------------------------------------------------------------------

/// A table's real columns, as SQLite reports them.
///
/// The allowlist is *derived*, never written down twice: a column added by a migration is queryable
/// the moment it exists, and a column that does not exist cannot be named. See the module docs for
/// why this is the injection boundary.
#[derive(Debug, Clone)]
pub struct TableSchema {
    table: String,
    columns: Vec<ColumnInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    /// The column's name exactly as the schema spells it. This is what reaches the SQL text.
    pub name: String,
    /// The declared type, e.g. `TEXT`, `INTEGER`, `REAL`. Lets a client pick sensible filter
    /// functions and lets a future Arrow encoder choose a field type.
    pub declared_type: String,
}

impl TableSchema {
    /// Reads `table`'s columns.
    ///
    /// The table name is *bound as a parameter* to the `pragma_table_info` table-valued function, so
    /// even this call formats no caller-supplied text into SQL. An unknown table reports zero
    /// columns, which is rejected here rather than surfacing later as a confusing "no such column".
    pub fn load(conn: &Connection, table: &str) -> Result<Self> {
        let mut stmt = conn.prepare("SELECT name, type FROM pragma_table_info(?1)")?;
        let mut rows = stmt.query([table])?;
        let mut columns = Vec::new();
        while let Some(row) = rows.next()? {
            columns.push(ColumnInfo {
                name: row.get(0)?,
                declared_type: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
            });
        }
        if columns.is_empty() {
            return Err(TendrilError::Validation(format!("unknown table '{table}'")));
        }
        Ok(Self {
            table: table.to_string(),
            columns,
        })
    }

    pub fn table(&self) -> &str {
        &self.table
    }

    pub fn columns(&self) -> &[ColumnInfo] {
        &self.columns
    }

    /// Maps a caller-supplied name onto the schema's own spelling.
    ///
    /// Matching ignores case and separators, so the API's camelCase JSON field names line up with the
    /// database's PascalCase columns without a hand-maintained table: `planFile`, `plan_file` and
    /// `PlanFile` all resolve to `PlanFile`.
    ///
    /// The returned `&str` borrows the schema — that is the point. A caller cannot accidentally pass
    /// its own string on to SQL, because the only thing it is handed back is the schema's.
    pub fn resolve(&self, name: &str) -> Result<&str> {
        // A syntactic gate ahead of the lookup. Not a security boundary — the lookup is, since it can
        // only ever return the schema's own string — but without it the loose matching below is too
        // loose to be honest: it strips spaces and dashes, so `"Status --"` would *resolve*, and a
        // caller who wrote that meant something the query is not going to do.
        if !is_identifier(name) {
            return Err(TendrilError::Validation(format!(
                "'{name}' is not a column name"
            )));
        }
        let wanted = normalize_token(name);
        self.columns
            .iter()
            .find(|c| normalize_token(&c.name) == wanted)
            .map(|c| c.name.as_str())
            .ok_or_else(|| {
                TendrilError::Validation(format!(
                    "unknown column '{name}' for table '{}'",
                    self.table
                ))
            })
    }

    /// [`Self::resolve`] over a list, preserving order.
    pub fn resolve_all(&self, names: &[String]) -> Result<Vec<&str>> {
        names.iter().map(|n| self.resolve(n)).collect()
    }
}

/// Double-quotes an identifier that came out of [`TableSchema`].
///
/// The `"` doubling is belt-and-braces: a SQLite column name *can* contain a quote, and while none of
/// V2's do, an identifier reaching SQL should not depend on that.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

// ---------------------------------------------------------------------------
// The descriptor: everything about a table that is the server's business
// ---------------------------------------------------------------------------

/// The server-owned half of a query. None of it can come from a request.
#[derive(Debug, Clone, Copy)]
pub struct TableDescriptor<'a> {
    /// Physical table (or view) name.
    pub table: &'a str,
    /// `SELECT` list used to read a row for the mapper.
    pub columns_sql: &'a str,
    /// A predicate ANDed into every query and count — the server's own visibility rule, e.g.
    /// `Cleared = 0`. Never negotiable, and applied before the caller's filter.
    pub base_predicate: Option<&'a str>,
    /// `ORDER BY` body used when the request names no sort.
    pub default_order_sql: &'a str,
    /// `ORDER BY` body appended after every caller sort, so equal keys come back in a stable order.
    /// Without it, paging a large table can show or skip a row: two windows of an unstable sort are
    /// not slices of one sequence.
    pub tiebreak_order_sql: &'a str,
    /// SQL aggregate expression whose value, with the row count, forms [`QueryPage::version_token`].
    /// `None` means the token is the count alone.
    pub version_marker_sql: Option<&'a str>,
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/// A compiled query: SQL fragments with every value held out as a bound parameter.
///
/// Public and cheap to build so tests can assert on the generated SQL and on the parameter list
/// without touching a database.
#[derive(Debug, Clone)]
pub struct QueryPlan {
    /// `WHERE` body. Never empty — an unfiltered query plans as `1`.
    pub where_sql: String,
    /// Parameters for `where_sql`, in placeholder order.
    pub params: Vec<Value>,
    /// `ORDER BY` body.
    pub order_sql: String,
    pub limit: i64,
    pub offset: i64,
}

impl QueryPlan {
    /// Compiles a request against a schema. Fails with [`TendrilError::Validation`] on any unknown
    /// column, unknown function or malformed argument list.
    pub fn build(
        schema: &TableSchema,
        descriptor: &TableDescriptor<'_>,
        query: &TableQuery,
    ) -> Result<Self> {
        let mut params = Vec::new();
        let mut clauses = Vec::new();

        if let Some(base) = descriptor.base_predicate {
            clauses.push(format!("({base})"));
        }
        if let Some(filter) = &query.filter {
            clauses.push(filter_sql(schema, filter, &mut params, 0)?);
        }
        let where_sql = if clauses.is_empty() {
            "1".to_string()
        } else {
            clauses.join(" AND ")
        };

        let mut order_parts = Vec::new();
        for sort in &query.sort {
            let column = schema.resolve(&sort.column)?;
            order_parts.push(format!(
                "{} {}",
                quote_ident(column),
                sort.direction.as_sql()
            ));
        }
        if order_parts.is_empty() && !descriptor.default_order_sql.is_empty() {
            order_parts.push(descriptor.default_order_sql.to_string());
        }
        if !descriptor.tiebreak_order_sql.is_empty() {
            order_parts.push(descriptor.tiebreak_order_sql.to_string());
        }
        let order_sql = order_parts.join(", ");

        Ok(Self {
            where_sql,
            params,
            order_sql,
            limit: clamp_limit(query.limit),
            offset: query.offset.max(0),
        })
    }
}

/// `limit` policy in one place: absent, zero or negative means [`DEFAULT_LIMIT`]; anything above
/// [`MAX_LIMIT`] is clamped down rather than rejected.
fn clamp_limit(limit: Option<i64>) -> i64 {
    match limit {
        Some(n) if n > 0 => n.min(MAX_LIMIT),
        _ => DEFAULT_LIMIT,
    }
}

/// Guards against a pathological request — a filter nested thousands deep would blow the recursion
/// here and SQLite's expression-depth limit anyway.
const MAX_FILTER_DEPTH: usize = 32;

fn filter_sql(
    schema: &TableSchema,
    filter: &Filter,
    params: &mut Vec<Value>,
    depth: usize,
) -> Result<String> {
    if depth > MAX_FILTER_DEPTH {
        return Err(TendrilError::Validation(format!(
            "filter nested deeper than {MAX_FILTER_DEPTH} levels"
        )));
    }

    let inner = match &filter.node {
        FilterNode::Condition(condition) => condition_sql(schema, condition, params)?,
        FilterNode::Group(group) => {
            // An empty group is the identity of its operator: an empty AND matches every row, an
            // empty OR matches none. That is what lets a UI hold a group open while the user is still
            // choosing its first condition without the table's contents jumping around.
            //
            // A deliberate divergence from the framework, which builds a `null` expression for an
            // empty group and then drops it — so *both* of its empty groups match everything, and an
            // empty OR silently widens the result instead of narrowing it. `negate` is dropped there
            // too, for the same reason. Here every node contributes a real predicate, so `negate`
            // always means something.
            if group.filters.is_empty() {
                match group.op {
                    LogicalOperator::And => "1".to_string(),
                    LogicalOperator::Or => "0".to_string(),
                }
            } else {
                let joiner = match group.op {
                    LogicalOperator::And => " AND ",
                    LogicalOperator::Or => " OR ",
                };
                let parts = group
                    .filters
                    .iter()
                    .map(|f| filter_sql(schema, f, params, depth + 1))
                    .collect::<Result<Vec<_>>>()?;
                format!("({})", parts.join(joiner))
            }
        }
    };

    // `NOT (…)` is three-valued: a NULL column makes the inner comparison NULL, and `NOT NULL` is
    // still NULL, so a negated condition never matches a NULL cell. Callers who want NULLs back have
    // `isNull`, which is why it is in the vocabulary.
    Ok(if filter.negate {
        format!("NOT ({inner})")
    } else {
        inner
    })
}

fn condition_sql(
    schema: &TableSchema,
    condition: &Condition,
    params: &mut Vec<Value>,
) -> Result<String> {
    let column = quote_ident(schema.resolve(&condition.column)?);
    let function = FilterFunction::parse(&condition.function)?;

    let expect_args = |n: usize| -> Result<()> {
        if condition.args.len() == n {
            Ok(())
        } else {
            Err(TendrilError::Validation(format!(
                "filter function '{}' takes {n} argument(s), got {}",
                condition.function,
                condition.args.len()
            )))
        }
    };

    let bind = |value: &JsonValue, params: &mut Vec<Value>| -> Result<()> {
        params.push(to_sql_value(value)?);
        Ok(())
    };

    Ok(match function {
        FilterFunction::IsNull => {
            expect_args(0)?;
            format!("{column} IS NULL")
        }
        FilterFunction::IsNotNull => {
            expect_args(0)?;
            format!("{column} IS NOT NULL")
        }
        // The framework's `blank`: unset *or* empty, because a TEXT column that a writer left as `''`
        // and one it left as NULL are the same absence to a reader. Args are ignored there; here they
        // are rejected, so a caller who thinks `blank` takes a value hears about it.
        FilterFunction::Blank => {
            expect_args(0)?;
            format!("({column} IS NULL OR {column} = '')")
        }
        FilterFunction::NotBlank => {
            expect_args(0)?;
            format!("({column} IS NOT NULL AND {column} <> '')")
        }
        FilterFunction::Equals | FilterFunction::NotEquals => {
            expect_args(1)?;
            let negated = function == FilterFunction::NotEquals;
            // An explicit null argument means the null test, not `= NULL` — which SQLite evaluates to
            // NULL and which would silently match nothing.
            if condition.args[0].is_null() {
                if negated {
                    format!("{column} IS NOT NULL")
                } else {
                    format!("{column} IS NULL")
                }
            } else {
                bind(&condition.args[0], params)?;
                if negated {
                    // `NULL <> 'x'` is NULL, not true, so a plain `<>` hides every row whose value is
                    // unset — asking for "status message is not npm" dropped every job that had no
                    // status message at all. `NotContains` and `NotInSet` below already spell this out;
                    // this arm was the one that did not, and it is the one most often typed.
                    format!("({column} IS NULL OR {column} <> ?{})", params.len())
                } else {
                    format!("{column} = ?{}", params.len())
                }
            }
        }
        FilterFunction::GreaterThan
        | FilterFunction::GreaterThanOrEqual
        | FilterFunction::LessThan
        | FilterFunction::LessThanOrEqual => {
            expect_args(1)?;
            let op = match function {
                FilterFunction::GreaterThan => ">",
                FilterFunction::GreaterThanOrEqual => ">=",
                FilterFunction::LessThan => "<",
                _ => "<=",
            };
            bind(&condition.args[0], params)?;
            format!("{column} {op} ?{}", params.len())
        }
        FilterFunction::Between => {
            expect_args(2)?;
            bind(&condition.args[0], params)?;
            let low = params.len();
            bind(&condition.args[1], params)?;
            let high = params.len();
            format!("({column} >= ?{low} AND {column} <= ?{high})")
        }
        FilterFunction::Contains
        | FilterFunction::NotContains
        | FilterFunction::StartsWith
        | FilterFunction::EndsWith => {
            expect_args(1)?;
            let needle = as_pattern_text(&condition.args[0], &condition.function)?;
            let escaped = escape_like(&needle);
            let pattern = match function {
                FilterFunction::StartsWith => format!("{escaped}%"),
                FilterFunction::EndsWith => format!("%{escaped}"),
                _ => format!("%{escaped}%"),
            };
            params.push(Value::Text(pattern));
            let placeholder = params.len();
            // `LIKE` is ASCII-case-insensitive in SQLite, which is the behaviour a table's search box
            // wants. `ESCAPE '\'` is what makes a literal `%` or `_` in the needle a literal — see
            // `escape_like`.
            let like = format!("{column} LIKE ?{placeholder} ESCAPE '\\'");
            if function == FilterFunction::NotContains {
                // A NULL cell does not "contain" the needle, so it belongs in `notContains`'
                // result. Plain `NOT LIKE` would drop it, being NULL.
                format!("({column} IS NULL OR NOT ({like}))")
            } else {
                like
            }
        }
        FilterFunction::InSet | FilterFunction::NotInSet => {
            let negated = function == FilterFunction::NotInSet;
            // An empty set is not an error: it is the state a multi-select filter is in before
            // anything is ticked. `IN ()` matches nothing and `NOT IN ()` matches everything, which
            // is what the set semantics imply.
            if condition.args.is_empty() {
                return Ok(if negated {
                    "1".to_string()
                } else {
                    "0".to_string()
                });
            }
            let has_null = condition.args.iter().any(JsonValue::is_null);
            let mut placeholders = Vec::new();
            for arg in condition.args.iter().filter(|a| !a.is_null()) {
                bind(arg, params)?;
                placeholders.push(format!("?{}", params.len()));
            }
            let mut parts = Vec::new();
            if !placeholders.is_empty() {
                parts.push(format!("{column} IN ({})", placeholders.join(", ")));
            }
            // A null in the set means "or unset", which `IN` cannot express.
            if has_null {
                parts.push(format!("{column} IS NULL"));
            }
            let positive = format!("({})", parts.join(" OR "));
            if negated {
                // NULLs again: without the explicit test, `NOT (Status IN (…))` hides every row whose
                // Status is unset, which is not what "not one of these" means to a user.
                if has_null {
                    format!("NOT {positive}")
                } else {
                    format!("({column} IS NULL OR NOT {positive})")
                }
            } else {
                positive
            }
        }
    })
}

/// `%`, `_` and the escape character itself have to be neutralised, or a user typing `50%` into a
/// search box gets a wildcard instead of a percent sign.
fn escape_like(needle: &str) -> String {
    let mut out = String::with_capacity(needle.len());
    for ch in needle.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn as_pattern_text(value: &JsonValue, function: &str) -> Result<String> {
    match value {
        JsonValue::String(s) => Ok(s.clone()),
        JsonValue::Number(n) => Ok(n.to_string()),
        JsonValue::Bool(b) => Ok(b.to_string()),
        _ => Err(TendrilError::Validation(format!(
            "filter function '{function}' takes a text argument"
        ))),
    }
}

/// The only place a caller-supplied value becomes something SQLite sees, and it becomes a bound
/// parameter — never text in a statement.
fn to_sql_value(value: &JsonValue) -> Result<Value> {
    Ok(match value {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(b) => Value::Integer(i64::from(*b)),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                return Err(TendrilError::Validation(format!(
                    "filter argument {n} is not a representable number"
                )));
            }
        }
        JsonValue::String(s) => Value::Text(s.clone()),
        JsonValue::Array(_) | JsonValue::Object(_) => {
            return Err(TendrilError::Validation(
                "filter arguments must be scalars; pass a set as several args to 'inSet'"
                    .to_string(),
            ))
        }
    })
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/// Runs a query and returns one window, its total and its aggregates.
///
/// Three statements, all sharing one `WHERE` and one parameter list: the window, the count (plus the
/// version marker, folded into the same statement so it costs nothing extra), and the aggregates —
/// the last only when some were asked for.
pub fn query_table<T, F>(
    conn: &Connection,
    descriptor: &TableDescriptor<'_>,
    query: &TableQuery,
    mut map_row: F,
) -> Result<QueryPage<T>>
where
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let schema = TableSchema::load(conn, descriptor.table)?;
    let plan = QueryPlan::build(&schema, descriptor, query)?;

    // Validated for the caller's benefit even though projection happens on the serialized rows: a
    // client that misspells a column should hear about it, not receive rows missing a field.
    schema.resolve_all(&query.select_columns)?;

    let order_clause = if plan.order_sql.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", plan.order_sql)
    };
    let sql = format!(
        "SELECT {} FROM {}{}{} LIMIT ?{} OFFSET ?{}",
        descriptor.columns_sql,
        quote_ident(schema.table()),
        where_clause(&plan.where_sql),
        order_clause,
        plan.params.len() + 1,
        plan.params.len() + 2,
    );

    let mut row_params = plan.params.clone();
    row_params.push(Value::Integer(plan.limit));
    row_params.push(Value::Integer(plan.offset));

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(row_params.iter()))?;
    let mut mapped = Vec::new();
    while let Some(row) = rows.next()? {
        mapped.push(map_row(row)?);
    }

    let (total_rows, marker) = count_and_marker(conn, descriptor, &schema, &plan)?;
    let version_token = format!("{total_rows}:{marker}");
    let stale = query
        .version_token
        .as_ref()
        .is_some_and(|seen| seen != &version_token);

    let aggregations = if query.aggregations.is_empty() {
        Vec::new()
    } else {
        run_aggregations(conn, &schema, &plan, &query.aggregations)?
    };

    Ok(QueryPage {
        row_count: mapped.len(),
        rows: mapped,
        offset: plan.offset,
        total_rows,
        limit: plan.limit,
        version_token,
        stale,
        aggregations,
    })
}

/// [`query_table`] without a hand-written row mapper: each row comes back as a JSON object keyed by
/// its column name, camelCased.
///
/// This is what makes the shape reusable. A table gets a server-paged, sortable, filterable endpoint
/// by declaring a [`TableDescriptor`] — no DTO, no positional column mapping to keep in step. A table
/// whose rows the UI already has a DTO for (Jobs) still goes through [`query_table`] with its own
/// mapper, so the wire shape stays exactly what that UI already parses.
///
/// It is also where `selectColumns` earns its place: the projection becomes the `SELECT` list, so an
/// unasked-for column is never read. On `Plans`, whose `YamlRaw` and `LatestRevisionContent` hold a
/// whole plan document each, that is the difference between a 40 kB row and a 200 byte one.
///
/// BLOB columns come back as `null` — no V2 table has one, and base64 in a JSON row is a decision for
/// whoever needs it.
pub fn query_rows_as_json(
    conn: &Connection,
    descriptor: &TableDescriptor<'_>,
    query: &TableQuery,
) -> Result<QueryPage<JsonValue>> {
    let schema = TableSchema::load(conn, descriptor.table)?;
    let selected: Vec<String> = if query.select_columns.is_empty() {
        schema.columns().iter().map(|c| c.name.clone()).collect()
    } else {
        schema
            .resolve_all(&query.select_columns)?
            .into_iter()
            .map(str::to_string)
            .collect()
    };

    let columns_sql = selected
        .iter()
        .map(|name| quote_ident(name))
        .collect::<Vec<_>>()
        .join(", ");
    let projected = TableDescriptor {
        columns_sql: &columns_sql,
        ..*descriptor
    };
    let keys: Vec<String> = selected.iter().map(|name| to_camel_case(name)).collect();

    // The projection has been applied to the `SELECT`, so it must not be re-validated as a filter on
    // the response body.
    let inner = TableQuery {
        select_columns: Vec::new(),
        ..query.clone()
    };

    query_table(conn, &projected, &inner, |row| {
        let mut object = serde_json::Map::with_capacity(keys.len());
        for (index, key) in keys.iter().enumerate() {
            let value = json_from_sql_lossy(row.get_ref(index)?);
            object.insert(key.clone(), value);
        }
        Ok(JsonValue::Object(object))
    })
}

/// `FolderPath` → `folderPath`. V2's JSON is camelCase everywhere, and the whole point of a
/// schema-derived response is that nobody maintains a second name list.
fn to_camel_case(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn json_from_sql_lossy(value: ValueRef<'_>) -> JsonValue {
    match json_from_sql(value) {
        Ok(Some(json)) => json,
        _ => JsonValue::Null,
    }
}

fn where_clause(where_sql: &str) -> String {
    if where_sql == "1" {
        String::new()
    } else {
        format!(" WHERE {where_sql}")
    }
}

/// The total and the version marker in one pass.
///
/// The count is taken over the filtered set and *without* the window, which is what a pager needs.
/// The marker is `MAX(<descriptor expression>)` over the same set, so the token moves when a row is
/// added, removed or restamped — enough to tell a client its offsets have shifted. It is deliberately
/// not a content hash: hashing a million rows to page ten of them would be the very cost this module
/// exists to avoid.
fn count_and_marker(
    conn: &Connection,
    descriptor: &TableDescriptor<'_>,
    schema: &TableSchema,
    plan: &QueryPlan,
) -> Result<(i64, String)> {
    let marker_sql = descriptor.version_marker_sql.unwrap_or("''");
    let sql = format!(
        "SELECT COUNT(*), COALESCE(CAST({} AS TEXT), '') FROM {}{}",
        marker_sql,
        quote_ident(schema.table()),
        where_clause(&plan.where_sql),
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(plan.params.iter()))?;
    let row = rows
        .next()?
        .ok_or_else(|| TendrilError::Other("COUNT(*) returned no row".to_string()))?;
    Ok((row.get(0)?, row.get(1)?))
}

fn run_aggregations(
    conn: &Connection,
    schema: &TableSchema,
    plan: &QueryPlan,
    requested: &[Aggregation],
) -> Result<Vec<AggregationResult>> {
    let mut selects = Vec::new();
    let mut resolved = Vec::new();
    for aggregation in requested {
        let column = schema.resolve(&aggregation.column)?;
        let function = AggregateFunction::parse(&aggregation.function)?;
        selects.push(format!("{}({})", function.as_sql(), quote_ident(column)));
        resolved.push((column.to_string(), function));
    }

    let sql = format!(
        "SELECT {} FROM {}{}",
        selects.join(", "),
        quote_ident(schema.table()),
        where_clause(&plan.where_sql),
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(plan.params.iter()))?;
    let row = rows
        .next()?
        .ok_or_else(|| TendrilError::Other("aggregate query returned no row".to_string()))?;

    resolved
        .into_iter()
        .enumerate()
        .map(|(index, (column, function))| {
            Ok(AggregationResult {
                column,
                function: function.canonical_name().to_string(),
                value: json_from_sql(row.get_ref(index)?)?,
            })
        })
        .collect()
}

/// Aggregates are not all numeric — `MIN`/`MAX` over a TEXT column is a string, and `SUM` over an
/// empty set is NULL — so the value crosses the wire as whatever JSON type SQLite produced.
fn json_from_sql(value: ValueRef<'_>) -> Result<Option<JsonValue>> {
    Ok(match value {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(JsonValue::from(i)),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(JsonValue::Number),
        ValueRef::Text(bytes) => Some(JsonValue::String(
            String::from_utf8_lossy(bytes).into_owned(),
        )),
        ValueRef::Blob(_) => None,
    })
}

// ---------------------------------------------------------------------------
// Distinct values — the proto's `Values` rpc
// ---------------------------------------------------------------------------

/// Distinct values of one column, for a filter dropdown, and how many distinct values exist.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValuesPage {
    pub column: String,
    pub values: Vec<JsonValue>,
    pub total_values: i64,
}

/// The framework's `DataTableValuesQuery`: distinct values of `column`, optionally narrowed by a
/// substring, capped.
///
/// A filter UI needs this and cannot get it from a page of rows — the value a user wants to filter on
/// is usually not on screen. Doing it here keeps the "client never holds the rows" property intact
/// for filter building too.
pub fn distinct_values(
    conn: &Connection,
    descriptor: &TableDescriptor<'_>,
    column: &str,
    search: Option<&str>,
    limit: Option<i64>,
) -> Result<ValuesPage> {
    let schema = TableSchema::load(conn, descriptor.table)?;
    let resolved = schema.resolve(column)?;
    let quoted = quote_ident(resolved);

    let mut clauses = Vec::new();
    let mut params: Vec<Value> = Vec::new();
    if let Some(base) = descriptor.base_predicate {
        clauses.push(format!("({base})"));
    }
    if let Some(needle) = search.map(str::trim).filter(|s| !s.is_empty()) {
        params.push(Value::Text(format!("%{}%", escape_like(needle))));
        clauses.push(format!("{quoted} LIKE ?{} ESCAPE '\\'", params.len()));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };

    let capped = match limit {
        Some(n) if n > 0 => n.min(MAX_VALUES_LIMIT),
        _ => DEFAULT_VALUES_LIMIT,
    };

    let table = quote_ident(schema.table());
    let total: i64 = {
        let sql = format!("SELECT COUNT(DISTINCT {quoted}) FROM {table}{where_sql}");
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite::params_from_iter(params.iter()))?;
        let row = rows
            .next()?
            .ok_or_else(|| TendrilError::Other("COUNT(DISTINCT) returned no row".to_string()))?;
        row.get(0)?
    };

    let mut list_params = params.clone();
    list_params.push(Value::Integer(capped));
    let sql = format!(
        "SELECT DISTINCT {quoted} FROM {table}{where_sql} ORDER BY {quoted} LIMIT ?{}",
        list_params.len()
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(list_params.iter()))?;
    let mut values = Vec::new();
    while let Some(row) = rows.next()? {
        if let Some(value) = json_from_sql(row.get_ref(0)?)? {
            values.push(value);
        }
    }

    Ok(ValuesPage {
        column: resolved.to_string(),
        values,
        total_values: total,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Widgets (
                 Id INTEGER PRIMARY KEY,
                 Name TEXT NOT NULL,
                 PlanFile TEXT,
                 Status TEXT,
                 Cost REAL,
                 Cleared INTEGER NOT NULL DEFAULT 0
             );
             INSERT INTO Widgets (Id, Name, PlanFile, Status, Cost, Cleared) VALUES
                 (1, 'alpha', 'a/b', 'Running', 1.5, 0),
                 (2, 'beta',  NULL,  'Failed',  2.5, 0),
                 (3, '50% off', 'c/d', 'Running', NULL, 0),
                 (4, 'gamma', 'e/f', 'Completed', 4.0, 1);",
        )
        .unwrap();
        conn
    }

    fn descriptor() -> TableDescriptor<'static> {
        TableDescriptor {
            table: "Widgets",
            columns_sql: "Id, Name, Status",
            base_predicate: Some("Cleared = 0"),
            default_order_sql: "Id ASC",
            tiebreak_order_sql: "Id DESC",
            version_marker_sql: Some("MAX(Id)"),
        }
    }

    fn run(query: TableQuery) -> QueryPage<(i64, String)> {
        let conn = conn();
        query_table(&conn, &descriptor(), &query, |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .unwrap()
    }

    fn condition(column: &str, function: &str, args: Vec<JsonValue>) -> Filter {
        Filter {
            node: FilterNode::Condition(Condition {
                column: column.to_string(),
                function: function.to_string(),
                args,
            }),
            negate: false,
        }
    }

    fn names(page: &QueryPage<(i64, String)>) -> Vec<String> {
        page.rows.iter().map(|(_, name)| name.clone()).collect()
    }

    #[test]
    fn empty_query_returns_first_page_in_default_order() {
        let page = run(TableQuery::default());
        assert_eq!(names(&page), vec!["alpha", "beta", "50% off"]);
        // The base predicate hides the cleared row from both the window and the total.
        assert_eq!(page.total_rows, 3);
        assert_eq!(page.row_count, 3);
        assert_eq!(page.limit, DEFAULT_LIMIT);
    }

    #[test]
    fn total_counts_the_filtered_set_not_the_window() {
        let page = run(TableQuery {
            limit: Some(1),
            filter: Some(condition("status", "equals", vec!["Running".into()])),
            ..Default::default()
        });
        assert_eq!(page.row_count, 1);
        assert_eq!(page.total_rows, 2);
    }

    #[test]
    fn offset_and_limit_window_the_result() {
        let page = run(TableQuery {
            offset: 1,
            limit: Some(1),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta"]);
        assert_eq!(page.offset, 1);
    }

    #[test]
    fn limit_is_clamped_and_negatives_fall_back_to_the_default() {
        assert_eq!(clamp_limit(None), DEFAULT_LIMIT);
        assert_eq!(clamp_limit(Some(0)), DEFAULT_LIMIT);
        assert_eq!(clamp_limit(Some(-5)), DEFAULT_LIMIT);
        assert_eq!(clamp_limit(Some(10)), 10);
        assert_eq!(clamp_limit(Some(MAX_LIMIT + 1)), MAX_LIMIT);
        let page = run(TableQuery {
            offset: -3,
            ..Default::default()
        });
        assert_eq!(page.offset, 0);
    }

    #[test]
    fn sort_accepts_the_frontends_direction_names_and_camel_case_columns() {
        let query: TableQuery = serde_json::from_str(
            r#"{"sort":[{"column":"planFile","direction":"Descending"}],"limit":2}"#,
        )
        .unwrap();
        let conn = conn();
        let plan = QueryPlan::build(
            &TableSchema::load(&conn, "Widgets").unwrap(),
            &descriptor(),
            &query,
        )
        .unwrap();
        assert_eq!(plan.order_sql, "\"PlanFile\" DESC, Id DESC");
    }

    #[test]
    fn unknown_column_and_function_are_validation_errors() {
        let conn = conn();
        let schema = TableSchema::load(&conn, "Widgets").unwrap();
        let err = QueryPlan::build(
            &schema,
            &descriptor(),
            &TableQuery {
                filter: Some(condition(
                    "Name; DROP TABLE Widgets",
                    "equals",
                    vec![1.into()],
                )),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, TendrilError::Validation(_)), "{err}");

        let err = QueryPlan::build(
            &schema,
            &descriptor(),
            &TableQuery {
                filter: Some(condition("Name", "'; DROP TABLE Widgets --", vec![])),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, TendrilError::Validation(_)), "{err}");
    }

    #[test]
    fn filter_values_are_bound_not_interpolated() {
        let conn = conn();
        let schema = TableSchema::load(&conn, "Widgets").unwrap();
        let plan = QueryPlan::build(
            &schema,
            &descriptor(),
            &TableQuery {
                filter: Some(condition(
                    "name",
                    "equals",
                    vec!["'; DROP TABLE Widgets --".into()],
                )),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(plan.where_sql, "(Cleared = 0) AND \"Name\" = ?1");
        assert_eq!(
            plan.params,
            vec![Value::Text("'; DROP TABLE Widgets --".to_string())]
        );

        // And the injection attempt runs as a harmless comparison, leaving the table intact.
        let page = run(TableQuery {
            filter: Some(condition(
                "name",
                "equals",
                vec!["'; DROP TABLE Widgets --".into()],
            )),
            ..Default::default()
        });
        assert_eq!(page.total_rows, 0);
        assert_eq!(run(TableQuery::default()).total_rows, 3);
    }

    #[test]
    fn contains_escapes_like_wildcards() {
        let page = run(TableQuery {
            filter: Some(condition("name", "contains", vec!["50%".into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["50% off"]);

        // A bare `%` would match every row if it were not escaped.
        let page = run(TableQuery {
            filter: Some(condition("name", "contains", vec!["%".into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["50% off"]);
    }

    #[test]
    fn contains_is_case_insensitive_and_start_end_anchor() {
        let page = run(TableQuery {
            filter: Some(condition("name", "contains", vec!["ALPH".into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["alpha"]);

        let page = run(TableQuery {
            filter: Some(condition("name", "startsWith", vec!["be".into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta"]);

        let page = run(TableQuery {
            filter: Some(condition("name", "endsWith", vec!["ta".into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta"]);
    }

    #[test]
    fn not_contains_keeps_null_cells() {
        // `beta` has no PlanFile at all, so it does not contain "a/" and must come back.
        let page = run(TableQuery {
            filter: Some(condition("planFile", "notContains", vec!["a/".into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta", "50% off"]);
    }

    /// The same claim as `not_contains_keeps_null_cells`, for the operator that is typed far more often.
    ///
    /// `NULL <> 'x'` is NULL rather than true, so a plain `<>` silently dropped every row whose value
    /// was unset: asking the Jobs table for "status message is not npm" hid every job that had no
    /// status message. Its sibling negations already spelled this out; this one did not.
    #[test]
    fn not_equals_keeps_null_cells() {
        // `beta` has no PlanFile at all, so it is not equal to "a/b" and must come back.
        let page = run(TableQuery {
            filter: Some(condition("planFile", "notEquals", vec!["a/b".into()])),
            ..Default::default()
        });
        assert!(
            names(&page).contains(&"beta".to_string()),
            "a row whose value is unset is not equal to anything, got {:?}",
            names(&page)
        );

        // And it still excludes the rows that *do* equal the argument.
        let all = run(TableQuery::default()).total_rows;
        let equal = run(TableQuery {
            filter: Some(condition("status", "equals", vec!["Running".into()])),
            ..Default::default()
        })
        .total_rows;
        let not_equal = run(TableQuery {
            filter: Some(condition("status", "notEquals", vec!["Running".into()])),
            ..Default::default()
        })
        .total_rows;
        assert_eq!(
            equal + not_equal,
            all,
            "every row is either equal or not equal — none may fall between"
        );
    }

    #[test]
    fn in_set_binds_every_member_and_handles_the_empty_set() {
        let page = run(TableQuery {
            filter: Some(condition(
                "status",
                "inSet",
                vec!["Running".into(), "Failed".into()],
            )),
            ..Default::default()
        });
        assert_eq!(page.total_rows, 3);

        let page = run(TableQuery {
            filter: Some(condition("status", "inSet", vec![])),
            ..Default::default()
        });
        assert_eq!(page.total_rows, 0);

        let page = run(TableQuery {
            filter: Some(condition("status", "notInSet", vec![])),
            ..Default::default()
        });
        assert_eq!(page.total_rows, 3);
    }

    #[test]
    fn not_in_set_keeps_null_cells() {
        let page = run(TableQuery {
            filter: Some(condition("planFile", "notInSet", vec!["a/b".into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta", "50% off"]);
    }

    #[test]
    fn null_tests_and_a_null_equals_argument_agree() {
        let page = run(TableQuery {
            filter: Some(condition("planFile", "isNull", vec![])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta"]);

        let page = run(TableQuery {
            filter: Some(condition("planFile", "equals", vec![JsonValue::Null])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta"]);

        let page = run(TableQuery {
            filter: Some(condition("planFile", "isNotNull", vec![])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["alpha", "50% off"]);
    }

    #[test]
    fn comparisons_and_between_work_on_numbers() {
        let page = run(TableQuery {
            filter: Some(condition("cost", "greaterThan", vec![2.into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["beta"]);

        let page = run(TableQuery {
            filter: Some(condition("cost", "between", vec![1.into(), 2.into()])),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["alpha"]);
    }

    #[test]
    fn the_frameworks_function_names_and_aliases_all_parse() {
        // `QueryProcessor.BuildConditionExpression`'s switch, plus the two set functions the proto
        // documents. Anything that stopped parsing here would silently 400 a filter the framework's
        // own query editor produces.
        for name in [
            "equals",
            "notEquals",
            "greaterThan",
            "greaterThanOrEqual",
            "lessThan",
            "lessThanOrEqual",
            "contains",
            "notContains",
            "startsWith",
            "endsWith",
            "blank",
            "notBlank",
            "isBlank",
            "isNotBlank",
            "inRange",
            "before",
            "after",
            "inSet",
            "notInSet",
            "isNull",
            "isNotNull",
        ] {
            assert!(
                FilterFunction::parse(name).is_ok(),
                "'{name}' should be part of the vocabulary"
            );
        }
        assert_eq!(
            FilterFunction::parse("before").unwrap(),
            FilterFunction::LessThan
        );
        assert_eq!(
            FilterFunction::parse("after").unwrap(),
            FilterFunction::GreaterThan
        );
        assert_eq!(
            FilterFunction::parse("in_range").unwrap(),
            FilterFunction::Between
        );
    }

    #[test]
    fn blank_covers_null_and_empty_text() {
        let conn = conn();
        conn.execute(
            "INSERT INTO Widgets (Id, Name, PlanFile, Status, Cleared) VALUES (5, 'delta', '', 'Running', 0)",
            [],
        )
        .unwrap();

        let page = query_table(
            &conn,
            &descriptor(),
            &TableQuery {
                filter: Some(condition("planFile", "blank", vec![])),
                ..Default::default()
            },
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();
        assert_eq!(names(&page), vec!["beta", "delta"]);

        let page = query_table(
            &conn,
            &descriptor(),
            &TableQuery {
                filter: Some(condition("planFile", "isNotBlank", vec![])),
                ..Default::default()
            },
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();
        assert_eq!(names(&page), vec!["alpha", "50% off"]);
    }

    #[test]
    fn groups_nest_and_negate() {
        let filter = Filter {
            node: FilterNode::Group(FilterGroup {
                op: LogicalOperator::Or,
                filters: vec![
                    condition("status", "equals", vec!["Failed".into()]),
                    Filter {
                        node: FilterNode::Group(FilterGroup {
                            op: LogicalOperator::And,
                            filters: vec![
                                condition("status", "equals", vec!["Running".into()]),
                                condition("cost", "isNotNull", vec![]),
                            ],
                        }),
                        negate: false,
                    },
                ],
            }),
            negate: false,
        };
        let page = run(TableQuery {
            filter: Some(filter.clone()),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["alpha", "beta"]);

        let page = run(TableQuery {
            filter: Some(Filter {
                negate: true,
                ..filter
            }),
            ..Default::default()
        });
        assert_eq!(names(&page), vec!["50% off"]);
    }

    #[test]
    fn empty_groups_are_their_operators_identity() {
        let page = run(TableQuery {
            filter: Some(Filter {
                node: FilterNode::Group(FilterGroup {
                    op: LogicalOperator::And,
                    filters: vec![],
                }),
                negate: false,
            }),
            ..Default::default()
        });
        assert_eq!(page.total_rows, 3);

        let page = run(TableQuery {
            filter: Some(Filter {
                node: FilterNode::Group(FilterGroup {
                    op: LogicalOperator::Or,
                    filters: vec![],
                }),
                negate: false,
            }),
            ..Default::default()
        });
        assert_eq!(page.total_rows, 0);
    }

    #[test]
    fn deeply_nested_filters_are_rejected() {
        let mut filter = condition("status", "isNotNull", vec![]);
        for _ in 0..(MAX_FILTER_DEPTH + 2) {
            filter = Filter {
                node: FilterNode::Group(FilterGroup {
                    op: LogicalOperator::And,
                    filters: vec![filter],
                }),
                negate: false,
            };
        }
        let conn = conn();
        let schema = TableSchema::load(&conn, "Widgets").unwrap();
        let err = QueryPlan::build(
            &schema,
            &descriptor(),
            &TableQuery {
                filter: Some(filter),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, TendrilError::Validation(_)), "{err}");
    }

    #[test]
    fn aggregations_run_over_the_filtered_set_ignoring_the_window() {
        let page = run(TableQuery {
            limit: Some(1),
            aggregations: vec![
                Aggregation {
                    column: "cost".to_string(),
                    function: "sum".to_string(),
                },
                Aggregation {
                    column: "cost".to_string(),
                    function: "count".to_string(),
                },
                Aggregation {
                    column: "name".to_string(),
                    function: "max".to_string(),
                },
            ],
            ..Default::default()
        });
        assert_eq!(page.row_count, 1);
        assert_eq!(page.aggregations[0].value, Some(JsonValue::from(4.0)));
        // COUNT of a column skips its NULLs, which is why `50% off` is not counted.
        assert_eq!(page.aggregations[1].value, Some(JsonValue::from(2)));
        assert_eq!(
            page.aggregations[2].value,
            Some(JsonValue::from("beta".to_string()))
        );
    }

    #[test]
    fn version_token_reports_staleness_across_a_mutation() {
        let conn = conn();
        let first = query_table(&conn, &descriptor(), &TableQuery::default(), |row| {
            row.get::<_, i64>(0)
        })
        .unwrap();
        assert!(!first.stale);

        let same = query_table(
            &conn,
            &descriptor(),
            &TableQuery {
                version_token: Some(first.version_token.clone()),
                ..Default::default()
            },
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
        assert!(!same.stale, "an unchanged table is not stale");

        conn.execute(
            "INSERT INTO Widgets (Id, Name, Status, Cleared) VALUES (5, 'delta', 'Running', 0)",
            [],
        )
        .unwrap();
        let after = query_table(
            &conn,
            &descriptor(),
            &TableQuery {
                version_token: Some(first.version_token),
                ..Default::default()
            },
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
        assert!(after.stale, "an inserted row shifts the window");
    }

    #[test]
    fn schema_resolves_names_loosely_and_rejects_unknown_tables() {
        let conn = conn();
        let schema = TableSchema::load(&conn, "Widgets").unwrap();
        assert_eq!(schema.resolve("planfile").unwrap(), "PlanFile");
        assert_eq!(schema.resolve("plan_file").unwrap(), "PlanFile");
        assert_eq!(schema.resolve("PlanFile").unwrap(), "PlanFile");
        assert!(schema.resolve("Password").is_err());

        // The table name is bound as a parameter, so this is a clean 400 rather than SQL.
        let err = TableSchema::load(&conn, "Widgets; DROP TABLE Widgets").unwrap_err();
        assert!(matches!(err, TendrilError::Validation(_)), "{err}");
        assert_eq!(run(TableQuery::default()).total_rows, 3);
    }

    #[test]
    fn select_columns_are_validated_against_the_schema() {
        let conn = conn();
        let err = query_table(
            &conn,
            &descriptor(),
            &TableQuery {
                select_columns: vec!["nope".to_string()],
                ..Default::default()
            },
            |row| row.get::<_, i64>(0),
        )
        .unwrap_err();
        assert!(matches!(err, TendrilError::Validation(_)), "{err}");
    }

    #[test]
    fn json_rows_are_keyed_by_camel_cased_column_names() {
        let conn = conn();
        let page = query_rows_as_json(
            &conn,
            &descriptor(),
            &TableQuery {
                limit: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            page.rows[0],
            serde_json::json!({
                "id": 1,
                "name": "alpha",
                "planFile": "a/b",
                "status": "Running",
                "cost": 1.5,
                "cleared": 0
            })
        );
    }

    #[test]
    fn select_columns_becomes_the_projection_for_json_rows() {
        let conn = conn();
        let page = query_rows_as_json(
            &conn,
            &descriptor(),
            &TableQuery {
                // Deliberately out of schema order and in camelCase: the response follows the request.
                select_columns: vec!["status".to_string(), "planFile".to_string()],
                limit: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            page.rows,
            vec![
                serde_json::json!({ "status": "Running", "planFile": "a/b" }),
                serde_json::json!({ "status": "Failed", "planFile": null }),
            ]
        );
        // A projection narrows the row, never the result set.
        assert_eq!(page.total_rows, 3);
    }

    #[test]
    fn json_rows_reject_an_unknown_projection() {
        let conn = conn();
        let err = query_rows_as_json(
            &conn,
            &descriptor(),
            &TableQuery {
                select_columns: vec!["Name, (SELECT 1)".to_string()],
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, TendrilError::Validation(_)), "{err}");
    }

    #[test]
    fn distinct_values_search_and_cap() {
        let conn = conn();
        let page = distinct_values(&conn, &descriptor(), "status", None, None).unwrap();
        assert_eq!(page.column, "Status");
        assert_eq!(page.total_values, 2);
        assert_eq!(
            page.values,
            vec![JsonValue::from("Failed"), JsonValue::from("Running")]
        );

        let page = distinct_values(&conn, &descriptor(), "status", Some("run"), None).unwrap();
        assert_eq!(page.values, vec![JsonValue::from("Running")]);

        let page = distinct_values(&conn, &descriptor(), "status", None, Some(1)).unwrap();
        assert_eq!(page.values.len(), 1);
        assert_eq!(page.total_values, 2, "the total ignores the cap");

        assert!(distinct_values(&conn, &descriptor(), "nope", None, None).is_err());
    }

    #[test]
    fn a_filter_arrives_as_json_in_the_protos_shape() {
        let query: TableQuery = serde_json::from_str(
            r#"{
                "filter": {
                    "group": {
                        "op": "or",
                        "filters": [
                            { "condition": { "column": "status", "function": "inSet",
                                             "args": ["Running", "Queued"] } },
                            { "condition": { "column": "cost", "function": "greaterThan",
                                             "args": [2] }, "negate": true }
                        ]
                    }
                },
                "sort": [{ "column": "cost", "direction": "desc" }],
                "offset": 0,
                "limit": 25,
                "aggregations": [{ "column": "cost", "function": "sum" }],
                "versionToken": "3:4"
            }"#,
        )
        .unwrap();
        assert_eq!(query.limit, Some(25));
        assert_eq!(query.sort.len(), 1);
        assert_eq!(query.sort[0].direction, SortDirection::Desc);
        let conn = conn();
        let page =
            query_table(&conn, &descriptor(), &query, |row| row.get::<_, String>(1)).unwrap();
        assert_eq!(page.rows, vec!["alpha".to_string(), "50% off".to_string()]);
        assert!(page.stale, "the token in the body is not the current one");
    }

    #[test]
    fn an_unknown_request_field_is_rejected_rather_than_ignored() {
        let err = serde_json::from_str::<TableQuery>(r#"{"limitt": 5}"#).unwrap_err();
        assert!(err.to_string().contains("limitt"), "{err}");
    }
}
