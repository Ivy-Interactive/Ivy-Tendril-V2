//! Is this request a share, and who is asking — a port of `Services/Share/ShareContext.cs`.
//!
//! The original reaches into `HttpContext` and Ivy's `AppContext` from inside a DI-scoped service.
//! This is the same waterfall as a pure function over the signals, so it can be unit-tested without a
//! request and so the HTTP-specific extraction stays in `tendril-server` where the request types live.
//!
//! # A note on what "share mode" is *for*
//!
//! In the original, `IsShareMode` is a **presentation** flag: it decides which nav rows to draw, which
//! actions to offer and whose name to stamp on a comment. It is not an authorisation decision — the
//! visitor's requests are not authorised at all in V1 beyond the optional `api.apiKey`.
//!
//! V2 keeps it in that role, and no further. The authorisation decision belongs to the capability token
//! and [`super::policy::share_token_allows`]. This distinction is why `?share=1` is safe to honour from
//! an untrusted query string: turning it on removes UI, it never grants anything.

/// Everything the original's `IsShareMode` looks at, resolved from the transport by the caller.
#[derive(Debug, Clone, Default)]
pub struct ShareSignals {
    /// A `share` key of any value in the query string. The original checks `Query.ContainsKey("share")`.
    pub has_share_query: bool,
    /// `?mode=share`, case-insensitively.
    pub mode_is_share: bool,
    /// An `X-Tendril-Share` request header, any value.
    pub has_share_header: bool,
    /// A `tendril_share_mode` cookie, any value.
    pub has_share_cookie: bool,
    /// The request's `Host` matches the host of the currently active share tunnel. This is the signal
    /// that makes a share work without any marker in the URL, and it is the only one that cannot be
    /// forged by a client — it is derived from an active tunnel, not from the request.
    pub host_is_tunnel: bool,
    /// A share capability token was presented and accepted. Not one of the original's signals — it has
    /// no equivalent — but a request that got in on a share token is definitionally a share.
    pub has_share_token: bool,
}

impl ShareSignals {
    /// Reads the two share markers out of a raw query string, so a caller with a `&str` query does not
    /// have to parse it twice. Port of the `Query.ContainsKey("share")` / `Query["mode"] == "share"`
    /// pair.
    pub fn from_query(query: Option<&str>) -> Self {
        let mut signals = Self::default();
        let Some(query) = query else {
            return signals;
        };
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            if key.eq_ignore_ascii_case("share") {
                signals.has_share_query = true;
            }
            if key.eq_ignore_ascii_case("mode") && value.eq_ignore_ascii_case("share") {
                signals.mode_is_share = true;
            }
        }
        signals
    }
}

/// Port of `ShareContext.IsShareMode`: any one signal is enough.
pub fn is_share_mode(signals: &ShareSignals) -> bool {
    signals.has_share_query
        || signals.mode_is_share
        || signals.has_share_header
        || signals.has_share_cookie
        || signals.host_is_tunnel
        || signals.has_share_token
}

/// Name of the cookie the original's share-mode middleware sets, so a visitor who follows a
/// `?share=1` link keeps share mode on subsequent navigations without the marker.
pub const SHARE_COOKIE: &str = "tendril_share_mode";

/// Name of the header the original honours.
pub const SHARE_HEADER: &str = "X-Tendril-Share";

/// Query parameter carrying the capability token. Not one of the original's names — V1 needed no
/// credential — so it is chosen to read as what it is.
pub const SHARE_TOKEN_PARAM: &str = "shareToken";

/// Lifetime of the original's share-mode cookie (`MaxAge = TimeSpan.FromDays(7)`).
pub const SHARE_COOKIE_MAX_AGE_DAYS: u32 = 7;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_signals_is_not_a_share() {
        assert!(!is_share_mode(&ShareSignals::default()));
    }

    #[test]
    fn each_of_the_originals_signals_is_enough_on_its_own() {
        let cases: [(&str, fn(&mut ShareSignals)); 6] = [
            ("?share", |s| s.has_share_query = true),
            ("?mode=share", |s| s.mode_is_share = true),
            ("X-Tendril-Share", |s| s.has_share_header = true),
            ("cookie", |s| s.has_share_cookie = true),
            ("tunnel host", |s| s.host_is_tunnel = true),
            ("share token", |s| s.has_share_token = true),
        ];
        for (label, set) in cases {
            let mut signals = ShareSignals::default();
            set(&mut signals);
            assert!(is_share_mode(&signals), "{label} should mean share mode");
        }
    }

    #[test]
    fn share_markers_are_read_out_of_a_query_string() {
        assert!(ShareSignals::from_query(Some("share=1")).has_share_query);
        assert!(
            ShareSignals::from_query(Some("planId=00021&share")).has_share_query,
            "the original checks for the key, not a value"
        );
        assert!(ShareSignals::from_query(Some("mode=SHARE")).mode_is_share);
        assert!(ShareSignals::from_query(Some("MODE=share")).mode_is_share);

        let none = ShareSignals::from_query(Some("planId=00021&mode=edit"));
        assert!(!none.has_share_query && !none.mode_is_share);
        assert!(!is_share_mode(&ShareSignals::from_query(None)));
    }

    /// A near-miss must not switch share mode on: `shared=1` is not `share`.
    #[test]
    fn a_similar_looking_parameter_is_not_the_share_marker() {
        let signals = ShareSignals::from_query(Some("shared=1&sharemode=1"));
        assert!(!is_share_mode(&signals));
    }
}
