//! The Apple probe arms, against a real `fm serve`.
//!
//! `#[ignore]` because it needs two things CI cannot provide: an Apple silicon machine with the
//! `fm` CLI installed, and that server already listening on port 1976. Run it on a machine that has
//! both with `cargo test -p tendril-core --test apple_probe_live_test -- --ignored`.
//!
//! It exists because the three things it asserts are each a place where the obvious implementation
//! is wrong in a way no offline test would catch: `fm` exits 64 on `--version`, it serves the bare
//! id `system` rather than the `apple/system` the catalog offers, and it authenticates nobody.

use tendril_core::agents::probe::{
    check_auth, check_install, validate_model, AuthStatus, ProbeCredentials,
};
use tendril_core::agents::provider_models::ModelValidationStatus;

#[tokio::test]
#[ignore = "needs a live `fm serve` on this machine"]
async fn apple_probes_answer_against_a_live_fm_serve() {
    let creds = ProbeCredentials::default();

    // `fm` is the binary, not the OpenCode it is launched through, and `available` is what it
    // answers -- `--version` exits 64 with empty stdout and would read as "not installed".
    let install = check_install("apple").await;
    assert!(install.is_installed, "fm should be on PATH: {install:?}");
    assert!(
        install.version.is_some(),
        "`fm available` should report something: {install:?}"
    );

    // No credential exists to check; what the probe really answers is "is the server up".
    let auth = check_auth("apple", &creds).await;
    assert_eq!(auth.status, AuthStatus::Authenticated, "{auth:?}");

    // The catalog's id validates, and is reported back under that same id rather than the wire one.
    let ok = validate_model("apple", "apple/system", &creds).await;
    assert_eq!(ok.status, ModelValidationStatus::Ok, "{ok:?}");
    assert_eq!(ok.model, "apple/system");

    // An unset model means the pinned one, which is the only one a launch can send.
    let unset = validate_model("apple", "default", &creds).await;
    assert_eq!(unset.status, ModelValidationStatus::Ok, "{unset:?}");

    // Anything else is refused locally rather than sent, because the launch would not send it.
    let bad = validate_model("apple", "gpt-5.6-sol", &creds).await;
    assert_eq!(bad.status, ModelValidationStatus::InvalidModel, "{bad:?}");
}
