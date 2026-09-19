//! Native consumer of one job's `/api/jobs/:id/events` SSE stream.
//!
//! The webview cannot read this stream itself. The route sits in the daemon's `protected` router, the
//! bearer secret lives in `.master` and is deliberately never handed to the webview, and `invoke`
//! cannot stream — so a `fetch` from the React side is answered with a 401 and the job session view
//! shows nothing but whatever the 5 s status poll happens to know. That is what this module fixes:
//! the stream is consumed here, with the credential, and re-emitted as Tauri events, exactly as
//! [`super::changes_bridge`] and [`super::review_action_bridge`] already do for their streams.
//!
//! One reader exists per job id, so several open job tabs cost one stream each. Frames carry the job
//! id, which is what lets the webview route them without a per-job Tauri channel.
//!
//! Unlike a review action this stream *is* reconnectable — reading a log twice starts nothing — so a
//! broken connection climbs a backoff ladder and resumes with `since_line`, the line index the daemon
//! puts in every frame's SSE `id:`. Without that resume the reconnect would replay the whole run.

use crate::error::BridgeError;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::Emitter;

/// Tauri event carrying `{ jobId, event, data, line }` for one SSE frame.
pub const JOB_STREAM_EVENT: &str = "job-stream-event";

/// Backoff ladder for a stream that dropped before the job finished, matching `ChangeBridge`.
const INITIAL_BACKOFF: Duration = Duration::from_millis(500);
const MAX_BACKOFF: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, serde::Serialize)]
struct JobStreamFrame {
    #[serde(rename = "jobId")]
    job_id: String,
    /// `event` for a payload frame, `end` for the terminal one.
    event: String,
    /// The frame's payload, verbatim. Not parsed here: a job's log lines are the agent's own JSON and
    /// re-encoding them is a way to corrupt them, not to help.
    data: String,
    /// The frame's index in the job's log, from the SSE `id:`. `None` for a frame the daemon did not
    /// number, which is the `end` frame.
    line: Option<usize>,
}

/// Reader tasks by job id, so a closed job tab can stop the stream it opened.
static READERS: LazyLock<Mutex<HashMap<String, tokio::task::AbortHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Opens the stream for `job_id` and keeps consuming it in the background.
///
/// The first connection is made before returning, so a daemon that is down, or a credential the
/// daemon rejects, surfaces as an error on the `invoke` rather than as a stream that silently never
/// delivers. Later drops are handled by the reader's own ladder.
///
/// Subscribing twice for the same job replaces the first reader: a remount must not leave two streams
/// running against the same log.
pub async fn subscribe<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    discovery: super::MasterDiscovery,
    job_id: String,
    kinds: Option<String>,
    since_line: Option<usize>,
) -> Result<(), BridgeError> {
    // No timeout: a job that is thinking produces nothing for minutes at a time, and the daemon's
    // 15 s keep-alive comment is what distinguishes "quiet" from "dead". A `TendrilClient` cannot be
    // used here for exactly that reason — its client carries a 10 s request timeout, which for a
    // streaming body is a 10 s cap on the whole job.
    let client = reqwest::Client::new();
    let mut next_line = since_line.unwrap_or(0);

    let response = connect(&client, &discovery, &job_id, kinds.as_deref(), next_line).await?;

    // Replace any previous reader only once the new connection is known good, so a failed
    // resubscription does not also kill the stream that was working.
    close(&job_id);

    let key = job_id.clone();
    let reader = tokio::spawn(async move {
        let mut response = Some(response);
        let mut backoff = INITIAL_BACKOFF;

        loop {
            let open = match response.take() {
                Some(open) => open,
                None => {
                    match connect(&client, &discovery, &job_id, kinds.as_deref(), next_line).await {
                        Ok(open) => {
                            backoff = INITIAL_BACKOFF;
                            open
                        }
                        Err(e) => {
                            tracing::debug!(
                            "Job {job_id} event stream unavailable: {e}. Retrying in {backoff:?}"
                        );
                            tokio::time::sleep(backoff).await;
                            backoff = std::cmp::min(backoff * 2, MAX_BACKOFF);
                            continue;
                        }
                    }
                }
            };

            match pump(&app_handle, open, &job_id, &mut next_line).await {
                // The `end` frame arrived: the job is over and there is nothing to reconnect to.
                Outcome::Ended => break,
                Outcome::Dropped => {
                    tokio::time::sleep(backoff).await;
                    backoff = std::cmp::min(backoff * 2, MAX_BACKOFF);
                }
            }
        }

        lock(&READERS).remove(&job_id);
    });

    lock(&READERS).insert(key, reader.abort_handle());
    Ok(())
}

/// Stops consuming a job's stream. Returns whether a reader was running, so closing twice is not an
/// error — a view can unmount after the job has already ended.
pub fn unsubscribe(job_id: &str) -> bool {
    close(job_id)
}

fn close(job_id: &str) -> bool {
    match lock(&READERS).remove(job_id) {
        Some(handle) => {
            handle.abort();
            true
        }
        None => false,
    }
}

enum Outcome {
    /// The daemon sent its `end` frame.
    Ended,
    /// The connection went away with the job still running.
    Dropped,
}

/// Opens one connection, resolving the daemon's origin and secret from `.master` each time.
///
/// Re-reading `.master` per attempt is what lets a daemon that restarted on a different port be
/// picked up without restarting the app, the same way `ChangeBridge` does it.
async fn connect(
    client: &reqwest::Client,
    discovery: &super::MasterDiscovery,
    job_id: &str,
    kinds: Option<&str>,
    since_line: usize,
) -> Result<reqwest::Response, BridgeError> {
    let master = discovery.read_master().map_err(|e| {
        BridgeError::with_details(
            "DISCONNECTED",
            "Tendril service is not running: daemon metadata (.master) not found",
            e,
        )
    })?;

    let mut url = format!(
        "{}://{}:{}/api/jobs/{}/events",
        master.scheme,
        master.host,
        master.port,
        urlencoding_path(job_id)
    );
    let mut query: Vec<String> = Vec::new();
    if let Some(kinds) = kinds.filter(|k| !k.is_empty()) {
        query.push(format!("kinds={}", urlencoding_query(kinds)));
    }
    if since_line > 0 {
        query.push(format!("since_line={since_line}"));
    }
    if !query.is_empty() {
        url.push('?');
        url.push_str(&query.join("&"));
    }

    let response = client
        .get(&url)
        .bearer_auth(&master.secret)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(BridgeError::new(
            "JOB_EVENT_STREAM_FAILED",
            format!("Job {job_id} event stream was refused ({status}): {body}"),
        ));
    }

    Ok(response)
}

/// Consumes one open response, emitting every frame, until it ends.
async fn pump<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    mut response: reqwest::Response,
    job_id: &str,
    next_line: &mut usize,
) -> Outcome {
    let mut buffer = String::new();

    loop {
        match response.chunk().await {
            Ok(Some(bytes)) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));
                for frame in parse_frames(&mut buffer) {
                    if let Some(line) = frame.line {
                        // The next connection resumes after the highest line actually delivered, so a
                        // reconnect costs nothing and repeats nothing.
                        *next_line = line + 1;
                    }
                    let ended = frame.event == "end";
                    let _ = app_handle.emit(
                        JOB_STREAM_EVENT,
                        JobStreamFrame {
                            job_id: job_id.to_string(),
                            event: frame.event,
                            data: frame.data,
                            line: frame.line,
                        },
                    );
                    if ended {
                        return Outcome::Ended;
                    }
                }
            }
            Ok(None) => return Outcome::Dropped,
            Err(e) => {
                tracing::warn!("Job {job_id} event stream read failed: {e}");
                return Outcome::Dropped;
            }
        }
    }
}

/// One parsed SSE frame, with the `id:` this stream uses to number log lines.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Frame {
    pub event: String,
    pub data: String,
    pub line: Option<usize>,
}

/// Pulls every complete frame out of `buffer`, leaving any partial trailing frame behind.
///
/// A near-copy of `changes_bridge::parse_sse_frames`, which discards the `id:` field. This stream
/// cannot: the id *is* the resume point, and without it a reconnect has no choice but to replay the
/// whole log. Generalising the shared parser to carry the id would let this go — see the note in the
/// handover for that change.
pub(crate) fn parse_frames(buffer: &mut String) -> Vec<Frame> {
    let mut frames = Vec::new();

    // Frames are separated by a blank line. Anything after the last separator is incomplete, and a
    // chunk boundary can fall anywhere — including mid-`data:` — so it has to stay in the buffer.
    while let Some(end) = buffer.find("\n\n") {
        let raw: String = buffer.drain(..end + 2).collect();

        let mut event = String::new();
        let mut line = None;
        let mut data_lines: Vec<&str> = Vec::new();

        for text in raw.lines() {
            let text = text.trim_end_matches('\r');
            // A line starting with ':' is a comment — which is exactly what the keep-alive is.
            if text.is_empty() || text.starts_with(':') {
                continue;
            }
            if let Some(rest) = text.strip_prefix("event:") {
                event = rest.trim().to_string();
            } else if let Some(rest) = text.strip_prefix("id:") {
                line = rest.trim().parse::<usize>().ok();
            } else if let Some(rest) = text.strip_prefix("data:") {
                data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
            }
        }

        if data_lines.is_empty() {
            continue;
        }
        frames.push(Frame {
            event: if event.is_empty() {
                "message".to_string()
            } else {
                event
            },
            // Per the SSE spec, multiple data lines in one frame join with newlines.
            data: data_lines.join("\n"),
            line,
        });
    }

    frames
}

/// Percent-encodes a path segment. A job id is five digits today, but it reaches this function from
/// the webview, so it is not trusted to stay one.
fn urlencoding_path(segment: &str) -> String {
    segment
        .bytes()
        .flat_map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![b as char]
            }
            _ => format!("%{b:02X}").chars().collect(),
        })
        .collect()
}

/// As [`urlencoding_path`], but a comma is left alone: the `kinds` parameter is a comma-separated
/// list and the daemon splits on it.
fn urlencoding_query(value: &str) -> String {
    value
        .bytes()
        .flat_map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b',' => {
                vec![b as char]
            }
            _ => format!("%{b:02X}").chars().collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsubscribing_an_unknown_job_is_not_an_error() {
        assert!(!unsubscribe("never-subscribed"));
    }

    #[test]
    fn parse_frames_carries_the_line_id_across_chunk_boundaries() {
        let mut buffer = String::new();

        // The chunk cuts the frame mid-`data:`. A per-chunk parser would lose it outright.
        buffer.push_str("id: 7\nevent: event\ndata: {\"kind\":\"te");
        assert!(parse_frames(&mut buffer).is_empty());

        buffer.push_str("xt\",\"text\":\"hi\"}\n\n");
        let frames = parse_frames(&mut buffer);
        assert_eq!(
            frames,
            vec![Frame {
                event: "event".to_string(),
                data: r#"{"kind":"text","text":"hi"}"#.to_string(),
                line: Some(7),
            }]
        );

        // The keep-alive is a bare comment and carries no data, so it must not surface as a frame.
        buffer.push_str(": keep-alive\n\n");
        assert!(parse_frames(&mut buffer).is_empty());

        // The `end` frame is unnumbered, which is how a resume point is told apart from a terminator.
        buffer.push_str("event: end\ndata: {\"status\":\"Completed\"}\n\n");
        let frames = parse_frames(&mut buffer);
        assert_eq!(frames[0].event, "end");
        assert_eq!(frames[0].line, None);
    }

    #[test]
    fn a_job_id_is_encoded_before_it_reaches_the_path() {
        assert_eq!(urlencoding_path("00123"), "00123");
        assert_eq!(
            urlencoding_path("../../etc/passwd"),
            "..%2F..%2Fetc%2Fpasswd"
        );
        assert_eq!(urlencoding_query("tool_use,text"), "tool_use,text");
        assert_eq!(urlencoding_query("a b"), "a%20b");
    }
}
