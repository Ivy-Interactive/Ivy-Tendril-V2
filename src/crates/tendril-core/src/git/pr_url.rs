use regex::Regex;
use std::sync::LazyLock;

static PR_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^https?://github\.com/(?P<owner>[^/\s]+)/(?P<repo>[^/\s]+)/pull/(?P<number>\d+)",
    )
    .unwrap()
});

/// `owner/repo#number`, lower cased, or None when the string is not a GitHub PR URL.
pub fn canonical_pr_key(url: &str) -> Option<String> {
    let captures = PR_URL.captures(url.trim())?;
    Some(
        format!(
            "{}/{}#{}",
            &captures["owner"], &captures["repo"], &captures["number"]
        )
        .to_lowercase(),
    )
}

/// True when both strings name the same PR, or are equal ignoring case and surrounding
/// whitespace. The literal comparison is the fallback for a value that never parsed, so a
/// malformed entry can still be addressed by exactly what is stored.
pub fn same_pr(a: &str, b: &str) -> bool {
    match (canonical_pr_key(a), canonical_pr_key(b)) {
        (Some(key_a), Some(key_b)) => key_a == key_b,
        _ => a.trim().eq_ignore_ascii_case(b.trim()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_trailing_slash_files_and_fragment_share_a_key() {
        let base = canonical_pr_key("https://github.com/Owner/Repo/pull/42").unwrap();
        assert_eq!(
            base,
            canonical_pr_key("https://github.com/owner/repo/pull/42/").unwrap()
        );
        assert_eq!(
            base,
            canonical_pr_key("https://github.com/owner/repo/pull/42/files").unwrap()
        );
        assert_eq!(
            base,
            canonical_pr_key("https://github.com/owner/repo/pull/42#discussion_r1").unwrap()
        );
    }

    #[test]
    fn mixed_case_host_and_owner_share_a_key() {
        let a =
            canonical_pr_key("HTTPS://GitHub.com/Ivy-Interactive/Ivy-Tendril-V2/pull/7").unwrap();
        let b =
            canonical_pr_key("https://github.com/ivy-interactive/ivy-tendril-v2/pull/7").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn non_pr_url_yields_none() {
        assert_eq!(
            canonical_pr_key("https://github.com/owner/repo/issues/1"),
            None
        );
        assert_eq!(canonical_pr_key("not a url"), None);
    }

    #[test]
    fn malformed_identical_strings_are_same_pr() {
        assert!(same_pr("not a url", "not a url"));
        assert!(same_pr("Not A Url", " not a url "));
    }

    #[test]
    fn malformed_and_valid_url_are_not_same_pr() {
        assert!(!same_pr(
            "not a url",
            "https://github.com/owner/repo/pull/1"
        ));
    }
}
