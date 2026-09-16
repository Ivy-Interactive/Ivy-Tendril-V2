//! Staging a file into `<TendrilHome>/Attachments/`, and the rules that keep it there.
//!
//! `store_attachment` takes a file name and a session id off the wire (`POST /api/attachments/:id`),
//! joins them onto the Tendril home and writes bytes. So the cases that matter are the ones that must
//! *not* write: a name that climbs out of the directory, a session id that does, and a body over the
//! cap. The staged path is what the daemon then serves back through `GET /ivy/local-file`, which is the
//! whole reason a file is copied here at all.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tendril_core::jobs::attachments::{
    attachment_session_dir, clean_stale_attachment_sessions, safe_attachment_name,
    store_attachment, AttachmentError, MAX_ATTACHMENT_BYTES,
};

/// A fresh, empty Tendril home that removes itself. `tempfile` is not a dependency of this crate, so
/// the fixture is built the way `local_file_roots_test` builds its own.
struct Home(PathBuf);

impl Home {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "tendril-attachment-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create fixture home");
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Every shape that could place a file somewhere other than the session directory. Each is refused
/// outright rather than stripped down to something writable: see `safe_attachment_name`.
const ESCAPING_NAMES: &[&str] = &[
    "..",
    ".",
    "../escaped.png",
    "../../../../../../tmp/escaped.png",
    "..\\escaped.png",
    "sub/escaped.png",
    "sub\\escaped.png",
    "/etc/passwd",
    "/tmp/escaped.png",
    "C:\\Windows\\escaped.png",
    "C:escaped.png",
    "\\\\host\\share\\escaped.png",
    "shot.png:stream",
    "",
    "   ",
];

#[test]
fn an_upload_lands_in_the_session_directory() {
    let home = Home::new("lands");
    let stored = store_attachment(home.path(), "session-1", "shot.png", b"pretend png")
        .expect("a plain name stages");

    assert_eq!(
        stored,
        home.path()
            .join("Attachments")
            .join("session-1")
            .join("shot.png")
    );
    assert_eq!(std::fs::read(&stored).expect("read back"), b"pretend png");
}

#[test]
fn a_name_that_could_escape_the_session_directory_is_refused() {
    let home = Home::new("escaping-name");
    let escape_target = home.path().join("escaped.png");

    for name in ESCAPING_NAMES {
        match store_attachment(home.path(), "session-1", name, b"payload") {
            Ok(path) => panic!("{name:?} must not stage (wrote {})", path.display()),
            Err(err) => assert!(
                matches!(err, AttachmentError::InvalidName),
                "{name:?}: {err}"
            ),
        }
        assert!(
            !escape_target.exists(),
            "{name:?} must not have written outside the session directory"
        );
    }

    // Nothing above created anything at all, not even the directory it was aimed at.
    assert!(
        !home.path().join("Attachments").join("session-1").exists(),
        "a refused name must not leave a session directory behind"
    );
}

/// The session id is joined onto the path exactly as the file name is, and arrives from the same
/// request, so it gets the same rule.
#[test]
fn a_session_id_that_could_escape_the_attachments_directory_is_refused() {
    let home = Home::new("escaping-session");

    for session in ["..", "../..", "../elsewhere", "a/b", "a\\b", "/tmp", ""] {
        match store_attachment(home.path(), session, "shot.png", b"payload") {
            Ok(path) => panic!(
                "session {session:?} must not stage (wrote {})",
                path.display()
            ),
            Err(err) => assert!(
                matches!(err, AttachmentError::InvalidSession),
                "{session:?}: {err}"
            ),
        }
    }

    assert!(
        !home.path().join("shot.png").exists()
            && !home.path().join("Attachments/shot.png").exists(),
        "no escaping session id may write above its own directory"
    );
    assert!(attachment_session_dir(home.path(), "..").is_none());
    assert!(attachment_session_dir(home.path(), "session-1").is_some());
}

/// Whatever a caller-supplied name is, the staged file is a direct child of the session directory —
/// the property every path returned from here is relied on for.
#[test]
fn every_staged_path_is_a_direct_child_of_the_session_directory() {
    let home = Home::new("direct-child");
    let dir = attachment_session_dir(home.path(), "session-1").expect("session dir");

    for name in ["shot.png", ".hidden", "a b.png", "shot.PNG", "no-extension"] {
        let stored = store_attachment(home.path(), "session-1", name, b"payload")
            .unwrap_or_else(|e| panic!("{name:?} should stage: {e}"));
        assert_eq!(stored.parent(), Some(dir.as_path()), "{name:?}");
    }
}

#[test]
fn the_size_cap_holds() {
    let home = Home::new("size-cap");

    let at_cap = vec![0u8; MAX_ATTACHMENT_BYTES];
    assert!(
        store_attachment(home.path(), "session-1", "at-cap.png", &at_cap).is_ok(),
        "exactly the cap is allowed"
    );

    let over_cap = vec![0u8; MAX_ATTACHMENT_BYTES + 1];
    let err = store_attachment(home.path(), "session-1", "over-cap.png", &over_cap)
        .expect_err("one byte over the cap is refused");
    assert!(matches!(err, AttachmentError::TooLarge), "{err}");
    assert!(
        !home
            .path()
            .join("Attachments/session-1/over-cap.png")
            .exists(),
        "a refused body must not be partly written"
    );
}

/// Two files of the same name, from different folders, must not become one file with two chips
/// pointing at it.
#[test]
fn a_second_file_of_the_same_name_does_not_overwrite_the_first() {
    let home = Home::new("same-name");

    let first = store_attachment(home.path(), "session-1", "shot.png", b"first").expect("first");
    let second = store_attachment(home.path(), "session-1", "shot.png", b"second").expect("second");

    assert_ne!(first, second);
    assert_eq!(std::fs::read(&first).expect("first"), b"first");
    assert_eq!(std::fs::read(&second).expect("second"), b"second");
    assert_eq!(
        second.file_name().and_then(|n| n.to_str()),
        Some("shot_1.png"),
        "the extension is kept, so the copy stays previewable"
    );
}

/// The name is accepted as given — the daemon and the app both apply this rule, so it has to agree
/// with itself about what a plain file name is.
#[test]
fn a_plain_name_survives_unchanged() {
    for name in [
        "shot.png",
        "Screenshot 2026-09-16 at 10.41.11.png",
        "a.b.c.pdf",
    ] {
        assert_eq!(safe_attachment_name(name).as_deref(), Some(name));
    }
    // Surrounding whitespace is not part of a file name.
    assert_eq!(
        safe_attachment_name("  shot.png  ").as_deref(),
        Some("shot.png")
    );
    // A name long enough to break a filesystem is not a name.
    assert!(safe_attachment_name(&"a".repeat(201)).is_none());
}

/// V1's `CleanStaleAttachmentsDirectory`: staged files have no owner that deletes them, so a startup
/// sweep is what bounds the directory.
#[test]
fn the_stale_sweep_removes_old_sessions_and_keeps_new_ones() {
    let home = Home::new("stale-sweep");
    let fresh = store_attachment(home.path(), "fresh-session", "shot.png", b"payload")
        .expect("stage fresh");
    let stale = store_attachment(home.path(), "stale-session", "shot.png", b"payload")
        .expect("stage stale");

    // Nothing is old yet, so a 24-hour sweep is a no-op — the case that runs on almost every start.
    assert_eq!(
        clean_stale_attachment_sessions(home.path(), Duration::from_secs(24 * 60 * 60)),
        0
    );
    assert!(fresh.exists() && stale.exists());

    // A zero threshold makes every existing directory stale, which is the sweep's other end.
    assert_eq!(
        clean_stale_attachment_sessions(home.path(), Duration::ZERO),
        2
    );
    assert!(!fresh.exists() && !stale.exists());
    assert!(
        home.path().join("Attachments").is_dir(),
        "the sweep removes session directories, never the directory holding them"
    );
}

#[test]
fn the_stale_sweep_is_a_no_op_without_an_attachments_directory() {
    let home = Home::new("no-directory");
    assert_eq!(
        clean_stale_attachment_sessions(home.path(), Duration::ZERO),
        0
    );
    assert!(!Path::new(&home.path().join("Attachments")).exists());
}
