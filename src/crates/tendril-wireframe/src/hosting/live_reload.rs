//! The live-reload channel: the browser client, and the hub that broadcasts to it.
//!
//! Ported from V1's `Hosting/LiveReloadClient.cs`. The client script is V1's bytes, extracted rather
//! than retyped, and kept as `templates/live-reload-client.js`.

use serde::Serialize;
use tokio::sync::broadcast;

/// Served at `<base>/__wireframe/client.js` and injected into the page by the index builder.
pub const CLIENT_SOURCE: &str = include_str!("../../templates/live-reload-client.js");

/// What the hub sends to every attached page.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ReloadMessage {
    /// A rebuild started, so the page can show a pending state before the result arrives.
    BuildStarted,
    /// A rebuild finished and the bundle on disk is new.
    Reload,
    /// A rebuild failed; `output` is esbuild's own diagnostic, which is better than anything we
    /// would render.
    BuildFailed {
        output: String,
        location: Option<String>,
    },
}

/// Fan-out to the pages attached to one wireframe.
///
/// A broadcast channel rather than a list of sockets: a page that falls behind is dropped by the
/// channel rather than stalling the build that is trying to notify it.
#[derive(Debug, Clone)]
pub struct LiveReloadHub {
    sender: broadcast::Sender<ReloadMessage>,
}

impl Default for LiveReloadHub {
    fn default() -> Self {
        Self::new()
    }
}

impl LiveReloadHub {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(32);
        Self { sender }
    }

    /// A send with no attached pages is not a failure: `serve` starts building before anyone opens
    /// the browser, and the first build routinely finishes with nothing listening.
    pub fn broadcast(&self, message: ReloadMessage) {
        let _ = self.sender.send(message);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<ReloadMessage> {
        self.sender.subscribe()
    }

    pub fn attached(&self) -> usize {
        self.sender.receiver_count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_client_reconnects_and_reports_rather_than_dying_quietly() {
        // Each of these is a behaviour the preview depends on, so a template that lost one would be
        // a silent regression in the plan view.
        assert!(
            CLIENT_SOURCE.contains("__wireframe/hmr"),
            "it must know its socket"
        );
        // The index builder writes `data-base`; the client reads it as `dataset.base`.
        assert!(
            CLIENT_SOURCE.contains("dataset.base"),
            "it is scoped by the injected base"
        );
        // Framed in a plan preview, it talks to the parent page.
        assert!(CLIENT_SOURCE.contains("postMessage"));
        assert!(CLIENT_SOURCE.contains("tendril-wireframe"));
        // Scroll position survives a reload, so editing feels continuous.
        assert!(CLIENT_SOURCE.contains("__wireframe_scroll"));
    }

    #[test]
    fn the_socket_scheme_follows_the_page() {
        // A wireframe served over HTTPS -- which is exactly what a plan preview behind a share link
        // is -- cannot open a ws:// socket. Getting this wrong breaks live reload only in the
        // deployment where it is hardest to debug.
        assert!(CLIENT_SOURCE.contains("https:"), "got no scheme check");
        assert!(CLIENT_SOURCE.contains("wss:"));
    }

    #[test]
    fn messages_serialize_the_way_the_client_reads_them() {
        assert_eq!(
            serde_json::to_string(&ReloadMessage::Reload).unwrap(),
            r#"{"type":"reload"}"#
        );
        assert_eq!(
            serde_json::to_string(&ReloadMessage::BuildStarted).unwrap(),
            r#"{"type":"build-started"}"#
        );
        let failed = ReloadMessage::BuildFailed {
            output: "x".into(),
            location: Some("src/App.tsx:1:1".into()),
        };
        let json = serde_json::to_string(&failed).unwrap();
        assert!(json.contains(r#""type":"build-failed""#), "got {json}");
        assert!(
            json.contains(r#""location":"src/App.tsx:1:1""#),
            "got {json}"
        );
    }

    #[test]
    fn broadcasting_with_nobody_listening_is_not_an_error() {
        // `serve` builds before the browser is open, so the first build routinely has no audience.
        let hub = LiveReloadHub::new();
        assert_eq!(hub.attached(), 0);
        hub.broadcast(ReloadMessage::Reload);
    }

    #[tokio::test]
    async fn an_attached_page_receives_what_the_build_reports() {
        let hub = LiveReloadHub::new();
        let mut page = hub.subscribe();
        assert_eq!(hub.attached(), 1);

        hub.broadcast(ReloadMessage::BuildStarted);
        hub.broadcast(ReloadMessage::Reload);

        assert_eq!(page.recv().await.unwrap(), ReloadMessage::BuildStarted);
        assert_eq!(page.recv().await.unwrap(), ReloadMessage::Reload);
    }
}
