//! What a share visitor may reach. The V2 expression of `ShareAllowedAppIds`.
//!
//! # What the original actually enforces
//!
//! `AppShell/TendrilAppShell.cs` holds `ShareAllowedAppIds = { "review", "plans" }` and uses it twice:
//!
//! - `BuildMenuItems` runs every menu item through `FilterMenuItemForShare`, so a share visitor's
//!   sidebar contains only Review and Plans, and
//! - `OpenApp` rewrites any navigation whose `AppId` is not in the set to `"review"`, so a hand-typed
//!   `/settings` lands on Review instead.
//!
//! Plus, in the same file and in the two apps that stay reachable: the chat pane is not rendered
//! (`isShareMode ? null : new PlanChatView(...)`), the settings button leaves the sidebar footer
//! (`ShowInboxInFooter(isShareMode) == false`), and `ReviewActions`/`DraftActions` return early with a
//! two-item action list — Share Plan and Copy — instead of Request Changes, Reset to Draft, Discard and
//! Discuss-with-agent.
//!
//! **That is the whole of it, and in V1 it is enough**, because V1 renders the UI on the server: an app
//! the shell will not route to is an app whose `ViewBase.Build()` never runs, and V1's HTTP API is
//! wide open unless an operator sets `api.apiKey`, but there is no client-side bundle to drive it from.
//!
//! # Why V2 cannot enforce it the same way
//!
//! V2's frontend is a bundle the visitor downloads and fully controls. Hiding a nav row hides nothing:
//! `fetch('/api/jobs', ...)` from the browser console is the same request either way. So the app-id
//! allowlist has to become a *route* allowlist, checked server-side, and that is what this module is.
//!
//! # The allowlist
//!
//! Derived from what the two allowed apps actually read and write:
//!
//! - **read**: the plan list and one plan's detail, git/diff data, revisions, verifications,
//!   recommendations, diff comments and annotations, and `GET /ivy/local-file` for the images a plan's
//!   markdown references (that endpoint has its own guard on top — see
//!   `tendril_server::local_file_guard`).
//! - **write**: diff comments and annotations only. That is the "read-only & comment-only" the share
//!   dialog promises, and it is the mechanism behind V1's share-mode `ChangesTabView`, which sets
//!   `CurrentAuthor = shareContext.Persona` and stamps the persona onto any comment saved without one.
//!
//! Everything else is refused, including things a reviewer might plausibly want, because each of them
//! leaks or does more than a reviewer was invited to do:
//!
//! | Refused | Why |
//! |---|---|
//! | `GET /api/config` | returns `config.yaml`, including `llm`, `api` and project paths |
//! | `GET /api/ws`, `/api/events*` | carries every job's log lines and every chat delta, from every plan |
//! | `/api/jobs/**` | starting, cancelling and reading the output of agent runs |
//! | `/api/chat/**` | the operator's conversations, and the ability to send a prompt to an agent |
//! | `/api/projects/**`, `/api/vaults/**` | repository paths, credentials, review actions that execute shell commands |
//! | `/api/agents`, `/api/models*`, `/api/costs/**`, `/api/dashboard/**` | spend and installed-tooling inventory |
//! | `/api/plans` mutations (`PUT`/`DELETE`/`reset`/`validate`/state) | a reviewer must not move a plan |
//! | `/api/auth/**`, `/api/onboarding*`, `/api/doctor`, `/api/newsletter/**` | credentials, host diagnostics |
//!
//! The list is expressed as a match on `(method, path)` rather than as a set of prefixes, so a route
//! added later is refused by default. A new route becoming reachable to anonymous visitors because
//! nobody remembered this file is the failure mode worth designing against.

use std::borrow::Cow;

/// Port of `TendrilAppShell.ShareAllowedAppIds`. Still the source of truth for the *nav*: the app
/// filters its sidebar with this, and the route allowlist below is what makes the filtering matter.
pub const SHARE_ALLOWED_APP_IDS: [&str; 2] = ["review", "plans"];

/// Port of `FilterMenuItemForShare`'s membership test (case-insensitive, as the original's
/// `HashSet` is).
pub fn is_share_allowed_app(app_id: &str) -> bool {
    SHARE_ALLOWED_APP_IDS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(app_id))
}

/// Port of `OpenApp`'s rewrite: any app a share may not open becomes Review.
pub fn redirect_app_for_share(app_id: &str) -> &str {
    if is_share_allowed_app(app_id) {
        app_id
    } else {
        "review"
    }
}

/// Whether a share visitor's capability token authorises `method path`.
///
/// `path` is the request path with no query string. `method` is compared case-insensitively.
///
/// This is a *deny-by-default* decision function: anything not explicitly listed is refused.
pub fn share_token_allows(method: &str, path: &str) -> bool {
    let method = method.to_ascii_uppercase();
    let path = normalise(path);
    let path = path.as_ref();

    match method.as_str() {
        "GET" | "HEAD" => allows_read(path),
        "POST" => allows_comment_write(path),
        // No PUT, PATCH or DELETE at all. A reviewer replaces nothing and deletes nothing — including
        // their own comment, which the original also does not let them do (`ChangesTabView` gives a
        // share visitor no delete affordance).
        _ => false,
    }
}

fn allows_read(path: &str) -> bool {
    // The plan list and everything hanging off one plan that Review and Plans render.
    if path == "/api/plans" {
        return true;
    }
    if let Some(rest) = plan_subpath(path) {
        return matches!(
            rest,
            "" | "/git"
                | "/repo-status"
                | "/revisions"
                | "/diff-comments"
                | "/annotations"
                | "/verifications"
                | "/recommendations"
                | "/prs"
        );
    }

    // Images and PDFs a plan's markdown links to. Guarded again, and much more tightly, by
    // `tendril_server::local_file_guard`: host, origin, `Sec-Fetch-Site`, an extension allowlist and
    // root confinement all still apply.
    if path == "/ivy/local-file" {
        return true;
    }

    // Liveness only. Both are already unauthenticated for everyone, so listing them changes nothing;
    // they are here so a share page can tell "daemon is down" from "you are not allowed".
    matches!(path, "/api/ping" | "/api/health")
}

fn allows_comment_write(path: &str) -> bool {
    matches!(
        plan_subpath(path),
        Some("/diff-comments") | Some("/annotations")
    )
}

/// For `/api/plans/<id>...`, the part after the id. `None` for anything that is not a plan path.
///
/// The id is not validated here — the routes do that — but a *nested* id is refused: `/api/plans/1/2`
/// has no allowed shape, so it falls through to `false` rather than matching a prefix.
fn plan_subpath(path: &str) -> Option<&str> {
    let rest = path.strip_prefix("/api/plans/")?;
    let (id, tail) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, ""),
    };
    if id.is_empty() {
        return None;
    }
    Some(tail)
}

/// Collapses a trailing slash and any `..`/`.` segment, so `/api/plans/1/../../jobs` cannot be dressed
/// up as a plan path. A path that traverses at all is normalised to something the allowlist will not
/// match rather than resolved, because the only correct answer for such a path is "no".
fn normalise(path: &str) -> Cow<'_, str> {
    if path.contains("..") || path.contains("/./") || path.contains("//") {
        return Cow::Borrowed("/refused");
    }
    match path.len() > 1 && path.ends_with('/') {
        true => Cow::Borrowed(path.trim_end_matches('/')),
        false => Cow::Borrowed(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_allowed_app_ids_are_the_originals() {
        assert!(is_share_allowed_app("review"));
        assert!(is_share_allowed_app("plans"));
        assert!(
            is_share_allowed_app("REVIEW"),
            "the original's set is case-insensitive"
        );
        for denied in [
            "settings",
            "jobs",
            "chat",
            "agent",
            "icebox",
            "dashboard",
            "inbox",
            "",
        ] {
            assert!(
                !is_share_allowed_app(denied),
                "{denied} must not be shareable"
            );
        }
    }

    #[test]
    fn a_disallowed_app_is_redirected_to_review() {
        assert_eq!(redirect_app_for_share("settings"), "review");
        assert_eq!(redirect_app_for_share("plans"), "plans");
        assert_eq!(redirect_app_for_share("review"), "review");
    }

    #[test]
    fn a_reviewer_can_read_the_two_apps_they_were_invited_to() {
        for path in [
            "/api/plans",
            "/api/plans/00021",
            "/api/plans/00021/git",
            "/api/plans/00021/repo-status",
            "/api/plans/00021/revisions",
            "/api/plans/00021/diff-comments",
            "/api/plans/00021/annotations",
            "/api/plans/00021/verifications",
            "/api/plans/00021/recommendations",
            "/api/plans/00021/prs",
            "/ivy/local-file",
            "/api/ping",
            "/api/health",
        ] {
            assert!(
                share_token_allows("GET", path),
                "GET {path} should be allowed"
            );
        }
    }

    #[test]
    fn a_reviewer_can_leave_comments_and_annotations_and_nothing_else() {
        assert!(share_token_allows("POST", "/api/plans/00021/diff-comments"));
        assert!(share_token_allows("POST", "/api/plans/00021/annotations"));

        for path in [
            "/api/plans",
            "/api/plans/00021",
            "/api/plans/00021/events",
            "/api/plans/00021/reset",
            "/api/plans/00021/validate",
            "/api/plans/00021/recommendations",
            "/api/jobs",
            "/api/chat/sessions",
        ] {
            assert!(
                !share_token_allows("POST", path),
                "POST {path} must be refused"
            );
        }
    }

    /// The list that matters most: everything a reviewer must not reach even though a nav filter would
    /// have "hidden" it.
    #[test]
    fn everything_outside_review_and_plans_is_refused() {
        for path in [
            "/api/config",
            "/api/config/text",
            "/api/ws",
            "/api/events",
            "/api/events/backfill",
            "/api/jobs",
            "/api/jobs/00021",
            "/api/jobs/00021/logs",
            "/api/jobs/queue",
            "/api/chat/sessions",
            "/api/chat/sessions/abc/messages",
            "/api/projects",
            "/api/projects/tendril/issues",
            "/api/vaults",
            "/api/vaults/default/catalog",
            "/api/agents",
            "/api/models",
            "/api/costs/summary",
            "/api/dashboard/activity",
            "/api/recommendations",
            "/api/verifications",
            "/api/pull-requests",
            "/api/inbox/proposals",
            "/api/onboarding",
            "/api/doctor",
            "/api/version",
            "/api/auth/status",
            "/api/newsletter/subscribe",
            "/webviewer",
            "/",
        ] {
            assert!(
                !share_token_allows("GET", path),
                "GET {path} must be refused"
            );
        }
    }

    /// The in-app config editor's route, called out on its own because it is the newest way to read
    /// `config.yaml` and the deny-by-default is exactly the protection this module's header warns not to
    /// lean on: nothing stops a later edit from adding a `/api/config` prefix rule for some benign
    /// reason and sweeping the editor in with it.
    ///
    /// What is behind it: `GET` serves the whole file including `llm`, `api` and every project path —
    /// secrets are masked, but the structure, the hostnames and the paths are not — and `PUT` writes the
    /// daemon's own configuration, which is remote code execution one `codingAgent` entry later. Neither
    /// is anything a reviewer was invited to do.
    #[test]
    fn the_config_editor_is_not_something_a_share_may_read_or_write() {
        for method in ["GET", "HEAD", "PUT", "POST", "PATCH", "DELETE"] {
            for path in [
                "/api/config/text",
                "/api/config/text/",
                "/API/CONFIG/TEXT",
                "/api/config/text?baseHash=abc",
            ] {
                assert!(
                    !share_token_allows(method, path),
                    "{method} {path} must be refused"
                );
            }
        }
    }

    /// The WebViewer proxy sits *outside* the daemon's auth layer, so it is already reachable with no
    /// credential at all — including over a share tunnel. This allowlist refusing it does not close
    /// that hole, because nothing consults this function for those paths yet; the assertion is here so
    /// that when the enforcement layer lands, a share token cannot become a licence to drive a proxy
    /// that reaches loopback services on the daemon's host. See the security note in
    /// [`crate::tunnel`].
    #[test]
    fn the_webviewer_proxy_is_never_something_a_share_may_drive() {
        for path in [
            "/__proxy",
            "/__view/anything",
            "/__lib/sw.js",
            "/__capture",
            "/__captures/a.png",
            "/__resolve",
            "/sw.js",
        ] {
            assert!(
                !share_token_allows("GET", path),
                "GET {path} must be refused"
            );
            assert!(
                !share_token_allows("POST", path),
                "POST {path} must be refused"
            );
        }
    }

    /// A share token is never a write credential beyond comments, whatever the verb.
    #[test]
    fn no_verb_other_than_get_and_post_is_ever_allowed() {
        for method in ["PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"] {
            for path in [
                "/api/plans/00021",
                "/api/plans/00021/diff-comments",
                "/api/plans/00021/annotations",
                "/api/config",
                "/api/config/text",
            ] {
                assert!(
                    !share_token_allows(method, path),
                    "{method} {path} must be refused"
                );
            }
        }
    }

    #[test]
    fn the_method_is_matched_case_insensitively() {
        assert!(share_token_allows("get", "/api/plans"));
        assert!(share_token_allows("Post", "/api/plans/00021/annotations"));
    }

    /// Path trickery must not turn a refused route into an allowed one.
    #[test]
    fn traversal_and_odd_spellings_do_not_widen_the_allowlist() {
        for path in [
            "/api/plans/00021/../../jobs",
            "/api/plans/00021/..",
            "/api/plans//00021",
            "/api/plans/./00021",
            "/api/plans/00021/git/../../../config",
            "/api/plansx",
            "/api/plans-secret",
            "/api/plans/00021/git/extra",
            "/api/plans/00021/1/git",
        ] {
            assert!(
                !share_token_allows("GET", path),
                "GET {path} must be refused"
            );
        }
    }

    /// A trailing slash is the same route, not a bypass and not a refusal.
    #[test]
    fn a_trailing_slash_is_tolerated() {
        assert!(share_token_allows("GET", "/api/plans/"));
        assert!(share_token_allows("GET", "/api/plans/00021/git/"));
    }

    #[test]
    fn a_plan_path_with_no_id_is_not_a_plan_path() {
        assert!(!share_token_allows("GET", "/api/plans//"));
        assert_eq!(plan_subpath("/api/plans/"), None);
    }
}
