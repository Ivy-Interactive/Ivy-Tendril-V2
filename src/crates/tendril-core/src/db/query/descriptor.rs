//! The descriptor: everything about a table that is the server's business, never the request's.

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
