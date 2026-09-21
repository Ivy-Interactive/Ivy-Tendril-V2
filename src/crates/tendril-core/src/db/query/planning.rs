//! Planning — compiling a validated request into SQL fragments plus the values to bind.
//!
//! Nothing a client sent is ever formatted into the SQL text here: values become positional
//! parameters and identifiers come from [`super::schema::TableSchema`].

use super::descriptor::TableDescriptor;
use super::request::{
    Condition, Filter, FilterFunction, FilterNode, LogicalOperator, TableQuery, DEFAULT_LIMIT,
    MAX_LIMIT,
};
use super::schema::{quote_ident, TableSchema};
use crate::error::{Result, TendrilError};
use rusqlite::types::Value;
use serde_json::Value as JsonValue;

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
pub(super) fn clamp_limit(limit: Option<i64>) -> i64 {
    match limit {
        Some(n) if n > 0 => n.min(MAX_LIMIT),
        _ => DEFAULT_LIMIT,
    }
}

/// Guards against a pathological request — a filter nested thousands deep would blow the recursion
/// here and SQLite's expression-depth limit anyway.
pub(super) const MAX_FILTER_DEPTH: usize = 32;

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
pub(super) fn escape_like(needle: &str) -> String {
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
