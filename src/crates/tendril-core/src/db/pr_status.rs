//! The `PrStatuses` cache: what each tracked pull request was last seen to be.
//!
//! Every write keys on the canonical PR URL, so `/pull/7`, `/pull/7/files` and
//! `/pull/7#issuecomment-1` are one row rather than three.

use crate::models::{canonical_pr_url, parse_pr_url, PrState, PrStatusRecord};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, Result, Row};

pub fn upsert_pr_status(conn: &Connection, rec: &PrStatusRecord) -> Result<()> {
    let key = canonical_pr_url(&rec.pr_url).unwrap_or_else(|| rec.pr_url.clone());
    conn.execute(
        r#"
        INSERT INTO PrStatuses (PrUrl, Owner, Repo, Status, LastChecked, Branch)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(PrUrl) DO UPDATE SET
            Owner = excluded.Owner,
            Repo = excluded.Repo,
            Status = excluded.Status,
            LastChecked = excluded.LastChecked,
            Branch = excluded.Branch;
        "#,
        params![
            key,
            rec.owner,
            rec.repo,
            rec.status.as_str(),
            rec.last_checked.to_rfc3339(),
            rec.branch,
        ],
    )?;
    Ok(())
}

pub fn get_all_pr_statuses(conn: &Connection) -> Result<Vec<PrStatusRecord>> {
    let mut stmt = conn.prepare(
        "SELECT PrUrl, Owner, Repo, Status, LastChecked, Branch FROM PrStatuses \
         ORDER BY Owner, Repo, PrUrl",
    )?;
    let rows = stmt.query_map([], row_to_record)?;
    rows.collect()
}

pub fn get_pr_status(conn: &Connection, pr_url: &str) -> Result<Option<PrStatusRecord>> {
    let key = canonical_pr_url(pr_url).unwrap_or_else(|| pr_url.to_string());
    let mut stmt = conn.prepare(
        "SELECT PrUrl, Owner, Repo, Status, LastChecked, Branch FROM PrStatuses WHERE PrUrl = ?1",
    )?;
    let mut rows = stmt.query_map(params![key], row_to_record)?;
    match rows.next() {
        Some(rec) => Ok(Some(rec?)),
        None => Ok(None),
    }
}

/// Every cached URL that is not `Merged`. A merge is terminal on GitHub's side, so those are the
/// only rows a reconciliation pass ever needs to re-check.
pub fn get_unmerged_pr_urls(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT PrUrl FROM PrStatuses WHERE Status != ?1 ORDER BY PrUrl")?;
    let rows = stmt.query_map(params![PrState::Merged.as_str()], |row| row.get(0))?;
    rows.collect()
}

pub fn delete_pr_status(conn: &Connection, pr_url: &str) -> Result<usize> {
    let key = canonical_pr_url(pr_url).unwrap_or_else(|| pr_url.to_string());
    conn.execute("DELETE FROM PrStatuses WHERE PrUrl = ?1", params![key])
}

fn row_to_record(row: &Row<'_>) -> Result<PrStatusRecord> {
    let pr_url: String = row.get(0)?;
    let status: String = row.get(3)?;
    let last_checked: String = row.get(4)?;
    let number = parse_pr_url(&pr_url).map(|(_, _, n)| n).unwrap_or(0);

    Ok(PrStatusRecord {
        number,
        owner: row.get(1)?,
        repo: row.get(2)?,
        status: PrState::from_str_loose(&status),
        branch: row.get(5)?,
        last_checked: parse_timestamp(&last_checked),
        pr_url,
    })
}

/// An unparseable timestamp reads back as the epoch, which makes the row look stale and gets it
/// re-checked — the safe direction to fail in.
fn parse_timestamp(raw: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(raw)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| DateTime::<Utc>::from_timestamp_nanos(0))
}
