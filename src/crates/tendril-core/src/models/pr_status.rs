//! Tracked pull-request state, plus the URL helpers every call site that touches a PR URL needs.
//!
//! The string forms of [`PrState`] are the ones the `PrStatuses` table has always stored, so a
//! database carried over from V1 reads back unchanged.

use chrono::{DateTime, Utc};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PrState {
    Open,
    Closed,
    Merged,
    /// The PR could not be resolved on this pass. Never a guess about the real state — a tracked URL
    /// missing from a repository's response lands here rather than defaulting to `Open`.
    Unknown,
}

impl PrState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Open => "Open",
            Self::Closed => "Closed",
            Self::Merged => "Merged",
            Self::Unknown => "Unknown",
        }
    }

    /// Accepts both GitHub's `OPEN` / `CLOSED` / `MERGED` and the stored `Open` / `Closed` /
    /// `Merged`. Anything else — including an empty string — is [`PrState::Unknown`].
    pub fn from_str_loose(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "open" => Self::Open,
            "closed" => Self::Closed,
            "merged" => Self::Merged,
            _ => Self::Unknown,
        }
    }
}

impl fmt::Display for PrState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One row of the `PrStatuses` cache. `number` is derived from `pr_url` rather than stored — the
/// table keys on the URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrStatusRecord {
    pub pr_url: String,
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub status: PrState,
    pub branch: Option<String>,
    pub last_checked: DateTime<Utc>,
}

/// Splits `https://github.com/{owner}/{repo}/pull/{number}` into its parts.
///
/// A trailing segment (`/files`), a fragment (`#issuecomment-1`) and a query string (`?w=1`) are all
/// tolerated, so the same PR recorded in two different forms parses to the same triple.
pub fn parse_pr_url(url: &str) -> Option<(String, String, u64)> {
    let trimmed = url.trim();
    // Drop the fragment and query first: they can be glued straight onto the number segment.
    let without_fragment = trimmed.split('#').next().unwrap_or(trimmed);
    let without_query = without_fragment
        .split('?')
        .next()
        .unwrap_or(without_fragment);

    let path = without_query
        .strip_prefix("https://github.com/")
        .or_else(|| without_query.strip_prefix("http://github.com/"))
        .or_else(|| without_query.strip_prefix("https://www.github.com/"))
        .or_else(|| without_query.strip_prefix("github.com/"))?;

    let mut parts = path.split('/').filter(|p| !p.is_empty());
    let owner = parts.next()?;
    let repo = parts.next()?;
    if !parts.next()?.eq_ignore_ascii_case("pull") {
        return None;
    }
    let number: u64 = parts.next()?.parse().ok()?;

    Some((owner.to_string(), repo.to_string(), number))
}

/// The canonical URL form used as the `PrStatuses` primary key, so `/pull/7/files` and `/pull/7`
/// collapse to one row.
pub fn canonical_pr_url(url: &str) -> Option<String> {
    let (owner, repo, number) = parse_pr_url(url)?;
    Some(format!(
        "https://github.com/{}/{}/pull/{}",
        owner, repo, number
    ))
}

/// `"owner/repo#number"` — the short form used when deduping or reporting a PR.
pub fn canonical_pr_key(url: &str) -> Option<String> {
    let (owner, repo, number) = parse_pr_url(url)?;
    Some(format!("{}/{}#{}", owner, repo, number))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_plain_pr_url() {
        assert_eq!(
            parse_pr_url("https://github.com/acme/widgets/pull/7"),
            Some(("acme".to_string(), "widgets".to_string(), 7))
        );
    }

    #[test]
    fn tolerates_trailing_segments_and_fragments() {
        for url in [
            "https://github.com/acme/widgets/pull/7/files",
            "https://github.com/acme/widgets/pull/7#issuecomment-42",
            "https://github.com/acme/widgets/pull/7?w=1",
            "https://github.com/acme/widgets/pull/7/files#diff-abc",
            "  https://github.com/acme/widgets/pull/7  ",
        ] {
            assert_eq!(
                canonical_pr_url(url).as_deref(),
                Some("https://github.com/acme/widgets/pull/7"),
                "{url} should canonicalise"
            );
        }
    }

    #[test]
    fn rejects_non_pr_urls() {
        for url in [
            "https://github.com/acme/widgets/issues/7",
            "https://github.com/acme/widgets",
            "https://gitlab.com/acme/widgets/pull/7",
            "not a url",
            "",
        ] {
            assert_eq!(parse_pr_url(url), None, "{url} should not parse");
        }
    }

    #[test]
    fn canonical_key_is_the_short_form() {
        assert_eq!(
            canonical_pr_key("https://github.com/acme/widgets/pull/7/files").as_deref(),
            Some("acme/widgets#7")
        );
    }

    #[test]
    fn state_strings_round_trip_through_the_loose_parser() {
        for state in [
            PrState::Open,
            PrState::Closed,
            PrState::Merged,
            PrState::Unknown,
        ] {
            assert_eq!(PrState::from_str_loose(state.as_str()), state);
        }
        assert_eq!(PrState::from_str_loose("MERGED"), PrState::Merged);
        assert_eq!(PrState::from_str_loose("open"), PrState::Open);
        assert_eq!(PrState::from_str_loose("DRAFT"), PrState::Unknown);
    }
}
