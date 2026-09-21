//! Distinct values — the proto's `Values` rpc, feeding a filter dropdown.

use super::descriptor::TableDescriptor;
use super::execution::json_from_sql;
use super::planning::escape_like;
use super::request::{DEFAULT_VALUES_LIMIT, MAX_VALUES_LIMIT};
use super::schema::{quote_ident, TableSchema};
use crate::error::{Result, TendrilError};
use rusqlite::types::Value;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value as JsonValue;

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
