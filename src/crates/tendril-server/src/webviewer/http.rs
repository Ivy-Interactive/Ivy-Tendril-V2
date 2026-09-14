//! The one way the WebViewer fetches a URL a caller named, and the reason the shared client follows
//! no redirects of its own.
//!
//! A redirect is a second URL, chosen by the upstream rather than by us, and the allow-list is only
//! ever consulted on the first one. With the client following redirects, an allow-list that permits
//! a developer's own `localhost:3000` still fetches whatever that server answers a request with —
//! the cloud metadata endpoint included — and hands the body back. Following them here puts every
//! hop through the same gate.
//!
//! Method rewriting matches what a browser does: 303, and 301/302 on a non-idempotent method,
//! continue as a bodiless GET; 307/308 preserve method and body.

use axum::body::Bytes;
use reqwest::header::LOCATION;
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode, Url};
use std::sync::LazyLock;

use super::rewriter::authority;

/// Hops past this are a redirect loop, whatever the upstream believes.
pub(crate) const MAX_REDIRECTS: usize = 10;

/// One client for the lifetime of the process. Content is decompressed (the `gzip`/`brotli`/
/// `deflate` features) because we re-emit a rewritten body rather than relaying the original bytes.
///
/// Redirects are NOT followed by the client: each hop is a URL the upstream chose, and [`send`] is
/// where every one of them goes past the allow-list.
///
/// Cookies are off — reqwest's default without the `cookies` feature — and no `Set-Cookie` is
/// relayed back. Every proxied site shares the Tendril app's single origin, so one cookie jar would
/// be one jar for all of them, readable by any page any viewer is pointed at.
pub(crate) static UPSTREAM: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("building the WebViewer upstream client cannot fail")
});

/// Why a caller-named fetch produced no upstream response.
#[derive(Debug)]
pub(crate) enum SendError {
    /// The request never completed: DNS, connect, TLS, read.
    Transport(reqwest::Error),
    /// A redirect hop pointed somewhere the allow-list refuses. Carries the refused authority, which
    /// is safe to show — unlike the full URL, which can carry a token in its query.
    RedirectBlocked(String),
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SendError::Transport(e) => write!(f, "{e}"),
            SendError::RedirectBlocked(authority) => {
                write!(
                    f,
                    "Redirect to {authority} blocked by the target allow-list"
                )
            }
        }
    }
}

/// Fetch `url`, following redirects by hand so each hop passes `is_allowed`.
pub(crate) async fn send(
    client: &Client,
    method: Method,
    url: Url,
    body: Option<Bytes>,
    configure: impl Fn(RequestBuilder) -> RequestBuilder,
    is_allowed: impl Fn(&Url) -> bool,
) -> Result<Response, SendError> {
    let mut current_method = method;
    let mut current_url = url;
    let mut current_body = body;
    let mut hop = 0usize;

    loop {
        let mut request = client.request(current_method.clone(), current_url.clone());
        if let Some(bytes) = current_body.clone() {
            request = request.body(bytes);
        }
        let response = configure(request)
            .send()
            .await
            .map_err(SendError::Transport)?;

        let status = response.status();
        if hop >= MAX_REDIRECTS || !is_redirect(status) {
            return Ok(response);
        }

        let Some(location) = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
        else {
            return Ok(response);
        };
        let Ok(next) = current_url.join(location) else {
            return Ok(response);
        };
        if next.scheme() != "http" && next.scheme() != "https" {
            return Ok(response);
        }
        if !is_allowed(&next) {
            return Err(SendError::RedirectBlocked(authority(&next)));
        }

        let idempotent = current_method == Method::GET || current_method == Method::HEAD;
        if status == StatusCode::SEE_OTHER
            || ((status == StatusCode::MOVED_PERMANENTLY || status == StatusCode::FOUND)
                && !idempotent)
        {
            current_method = Method::GET;
            current_body = None;
        }

        current_url = next;
        hop += 1;
    }
}

fn is_redirect(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY        // 301
            | StatusCode::FOUND              // 302
            | StatusCode::SEE_OTHER          // 303
            | StatusCode::TEMPORARY_REDIRECT // 307
            | StatusCode::PERMANENT_REDIRECT // 308
    )
}
