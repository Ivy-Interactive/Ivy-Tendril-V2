//! Schema: the column allowlist, read from SQLite itself.
//!
//! This is the half of the injection defence that covers *identifiers* — a caller's column name is
//! resolved to the `&str` SQLite reported, and it is that string, never the caller's bytes, that is
//! formatted into SQL.

use super::request::{is_identifier, normalize_token};
use crate::error::{Result, TendrilError};
use rusqlite::Connection;
use serde::Serialize;

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
pub(super) fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
