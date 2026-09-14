pub mod agent_instructions;
pub mod chat;
pub mod config;
pub mod confirm;
pub mod daemon_guard;
pub mod db;
pub mod doctor;
pub mod generate_certs;
pub mod hash_password;
pub mod job;
pub mod mcp;
pub mod models;
pub mod plan;
pub mod project;
pub mod project_analyzer;
pub mod promptware;
pub mod reset;
pub mod serve;
pub mod update;
pub mod update_promptwares;
pub mod vault;
pub mod verification;

use tendril_core::config::MasterInfo;

/// An HTTP client for talking to the local daemon.
///
/// When the daemon is serving TLS with the self-signed pair `tendril generate-certs` writes, no
/// certificate store will vouch for it, so verification has to be relaxed — but only for a daemon on
/// this machine, reached over loopback, where there is no network path for anyone to sit in the
/// middle of. A remote or non-loopback daemon is verified normally: relaxing it there would accept
/// any certificate at all from anyone able to answer on that address.
pub(crate) fn daemon_client(master: &MasterInfo) -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(accepts_self_signed(master))
        .build()
}

/// Whether the daemon described by `master` is one whose certificate cannot be verified but also
/// cannot be forged: TLS on a loopback address.
fn accepts_self_signed(master: &MasterInfo) -> bool {
    let is_loopback = matches!(master.host.as_str(), "127.0.0.1" | "::1" | "localhost");
    master.scheme.eq_ignore_ascii_case("https") && is_loopback
}

#[cfg(test)]
mod tests {
    use super::*;

    fn master(scheme: &str, host: &str) -> MasterInfo {
        MasterInfo {
            port: 5010,
            pid: 1,
            secret: "s".to_string(),
            started_at: String::new(),
            host: host.to_string(),
            version: "0.1.0".to_string(),
            api_version: 1,
            capabilities: Vec::new(),
            scheme: scheme.to_string(),
        }
    }

    #[test]
    fn base_url_follows_the_recorded_scheme() {
        assert_eq!(
            master("http", "127.0.0.1").base_url(),
            "http://127.0.0.1:5010"
        );
        assert_eq!(
            master("https", "127.0.0.1").base_url(),
            "https://127.0.0.1:5010"
        );
    }

    #[test]
    fn a_master_file_without_a_scheme_reads_as_http() {
        let json = r#"{"port":5010,"pid":42,"host":"127.0.0.1"}"#;
        let parsed: MasterInfo = serde_json::from_str(json).unwrap();

        assert_eq!(parsed.scheme, "http");
        assert_eq!(parsed.base_url(), "http://127.0.0.1:5010");
    }

    #[test]
    fn certificate_verification_is_relaxed_only_for_a_loopback_https_daemon() {
        for host in ["127.0.0.1", "::1", "localhost"] {
            assert!(
                accepts_self_signed(&master("https", host)),
                "{host} is this machine, and generate-certs writes a self-signed pair"
            );
            assert!(
                !accepts_self_signed(&master("http", host)),
                "there is no certificate to accept over plaintext"
            );
        }
        for host in ["tendril.example.com", "10.0.0.5", "0.0.0.0"] {
            assert!(
                !accepts_self_signed(&master("https", host)),
                "{host} is reached over a network and must be verified"
            );
        }
    }

    /// Construction only — building a client opens no connection, and nothing here makes a request.
    #[test]
    fn a_client_is_built_for_every_scheme_and_host() {
        for (scheme, host) in [
            ("http", "127.0.0.1"),
            ("https", "127.0.0.1"),
            ("https", "tendril.example.com"),
        ] {
            assert!(
                daemon_client(&master(scheme, host)).is_ok(),
                "{scheme}://{host} should still produce a client"
            );
        }
    }
}
