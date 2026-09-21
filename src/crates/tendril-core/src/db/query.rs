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

mod descriptor;
mod execution;
mod planning;
mod request;
mod response;
mod schema;
mod values;

pub use descriptor::TableDescriptor;
pub use execution::{query_rows_as_json, query_table};
pub use planning::QueryPlan;
pub use request::{
    AggregateFunction, Aggregation, Condition, Filter, FilterFunction, FilterGroup, FilterNode,
    LogicalOperator, SortDirection, SortOrder, TableQuery, DEFAULT_LIMIT, DEFAULT_VALUES_LIMIT,
    MAX_LIMIT, MAX_VALUES_LIMIT,
};
pub use response::{AggregationResult, QueryPage};
pub use schema::{ColumnInfo, TableSchema};
pub use values::{distinct_values, ValuesPage};
