//! `InboxProposals` reads and writes: the durable record of every assigned issue the auto-importer
//! has seen. See [`crate::inbox`] for what puts rows here and why a `Dismissed` row is never deleted.

use crate::error::Result;
use crate::inbox::{InboxProposal, ProposalState};
use rusqlite::{params, Connection, Row};

const PROPOSAL_SELECT: &str = "SELECT Id, Number, Repository, Title, Body, IssueUrl, Project, \
                               State, JobId, Discovered, Updated FROM InboxProposals";

fn row_to_proposal(row: &Row) -> rusqlite::Result<InboxProposal> {
    let state: String = row.get(7)?;
    Ok(InboxProposal {
        id: row.get(0)?,
        number: row.get::<_, i64>(1)? as u64,
        repository: row.get(2)?,
        title: row.get(3)?,
        body: row.get(4)?,
        issue_url: row.get(5)?,
        project: row.get(6)?,
        // An unrecognised state degrades to `Pending` rather than failing the read: a row written by
        // a future version must still be listable.
        state: ProposalState::from_str_loose(&state).unwrap_or_default(),
        job_id: row.get(8)?,
        discovered: row.get(9)?,
        updated: row.get(10)?,
    })
}

/// Inserts a proposal and returns its new id. `proposal.id` is ignored — the table assigns it.
///
/// `(Repository, Number)` is unique, so a concurrent sweep that already recorded this issue makes the
/// insert a no-op and the existing row's id comes back. That keeps a racing manual trigger from
/// producing a second proposal for one issue.
pub fn insert_proposal(conn: &Connection, proposal: &InboxProposal) -> Result<i64> {
    conn.execute(
        "INSERT INTO InboxProposals \
         (Number, Repository, Title, Body, IssueUrl, Project, State, JobId, Discovered, Updated) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
         ON CONFLICT (Repository, Number) DO NOTHING",
        params![
            proposal.number as i64,
            proposal.repository,
            proposal.title,
            proposal.body,
            proposal.issue_url,
            proposal.project,
            proposal.state.as_str(),
            proposal.job_id,
            proposal.discovered,
            proposal.updated,
        ],
    )?;

    let id: i64 = conn.query_row(
        "SELECT Id FROM InboxProposals WHERE Repository = ?1 AND Number = ?2",
        params![proposal.repository, proposal.number as i64],
        |row| row.get(0),
    )?;
    Ok(id)
}

/// Proposals, newest first. `state_filter` of `None` returns every state.
pub fn list_proposals(
    conn: &Connection,
    state_filter: Option<ProposalState>,
) -> Result<Vec<InboxProposal>> {
    let mut sql = PROPOSAL_SELECT.to_string();
    let mut rows = Vec::new();

    match state_filter {
        Some(state) => {
            sql.push_str(" WHERE State = ?1 ORDER BY Id DESC");
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map(params![state.as_str()], row_to_proposal)?;
            for proposal in mapped {
                rows.push(proposal?);
            }
        }
        None => {
            sql.push_str(" ORDER BY Id DESC");
            let mut stmt = conn.prepare(&sql)?;
            let mapped = stmt.query_map([], row_to_proposal)?;
            for proposal in mapped {
                rows.push(proposal?);
            }
        }
    }

    Ok(rows)
}

pub fn get_proposal(conn: &Connection, id: i64) -> Result<Option<InboxProposal>> {
    let sql = format!("{} WHERE Id = ?1", PROPOSAL_SELECT);
    let mut stmt = conn.prepare(&sql)?;
    let mut mapped = stmt.query_map(params![id], row_to_proposal)?;
    match mapped.next() {
        Some(proposal) => Ok(Some(proposal?)),
        None => Ok(None),
    }
}

/// Moves a proposal to `state`, stamping `Updated`. `job_id` of `None` leaves any existing job id
/// alone, so dismissing never erases the record of a job that already ran.
pub fn set_proposal_state(
    conn: &Connection,
    id: i64,
    state: ProposalState,
    job_id: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE InboxProposals SET State = ?1, JobId = COALESCE(?2, JobId), Updated = ?3 \
         WHERE Id = ?4",
        params![state.as_str(), job_id, chrono::Utc::now().to_rfc3339(), id],
    )?;
    Ok(())
}

/// Whether this issue has ever been swept, in any state. The sweep's first dedup channel.
pub fn proposal_exists(conn: &Connection, repository: &str, number: u64) -> Result<bool> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM InboxProposals WHERE LOWER(Repository) = LOWER(?1) \
         AND Number = ?2)",
        params![repository, number as i64],
        |row| row.get(0),
    )?;
    Ok(exists)
}
