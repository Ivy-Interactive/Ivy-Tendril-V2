//! Request shape — the proto's `DataTableQuery`, adapted to HTTP/JSON.
//!
//! Everything here is deserialized straight from a client, so the filter vocabulary is a closed set
//! of enums: an unknown function or operator fails to parse rather than reaching the SQL text. See
//! the injection-safety note in [`super`].

use crate::error::{Result, TendrilError};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

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
    pub(super) fn as_sql(self) -> &'static str {
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

    pub(super) fn as_sql(self) -> &'static str {
        match self {
            Self::Sum => "SUM",
            Self::Avg => "AVG",
            Self::Min => "MIN",
            Self::Max => "MAX",
            Self::Count => "COUNT",
        }
    }

    pub(super) fn canonical_name(self) -> &'static str {
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
pub(super) fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Lowercases and strips `_`, `-` and spaces, so one vocabulary serves callers that spell it
/// `camelCase`, `snake_case` or `Title Case`.
pub(super) fn normalize_token(raw: &str) -> String {
    raw.chars()
        .filter(|c| *c != '_' && *c != '-' && *c != ' ')
        .flat_map(char::to_lowercase)
        .collect()
}
