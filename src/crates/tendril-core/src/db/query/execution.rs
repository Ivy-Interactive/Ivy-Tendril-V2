//! Execution — running a plan and assembling the window, the total and the aggregates.

use super::descriptor::TableDescriptor;
use super::planning::QueryPlan;
use super::request::{AggregateFunction, Aggregation, TableQuery};
use super::response::{AggregationResult, QueryPage};
use super::schema::{quote_ident, TableSchema};
use crate::error::{Result, TendrilError};
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, Row};
use serde_json::Value as JsonValue;

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
pub(super) fn json_from_sql(value: ValueRef<'_>) -> Result<Option<JsonValue>> {
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

#[cfg(test)]
mod tests {
    use super::super::planning::{clamp_limit, MAX_FILTER_DEPTH};
    use super::super::request::{
        Condition, Filter, FilterFunction, FilterGroup, FilterNode, LogicalOperator, SortDirection,
        DEFAULT_LIMIT, MAX_LIMIT,
    };
    use super::super::values::distinct_values;
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
