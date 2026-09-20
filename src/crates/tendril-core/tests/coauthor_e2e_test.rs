//! End-to-end proof that the `coAuthor` setting actually reaches a real commit.
//!
//! The unit tests in `git::coauthor_hooks` check the shape of the env pairs and the
//! contents of the shim files. They cannot check the thing that actually matters:
//! that git, run for real with those pairs exported, appends the trailer -- and that
//! it still runs the customer's own hooks while doing so. Both of those are properties
//! of git's behaviour, not of our string building, so they need a real repo.

use std::collections::HashMap;

use tendril_core::config::TendrilSettings;
use tendril_core::git::coauthor_hooks::coauthor_env;

const IDENTITY: &str = "ivy-tendril <tendril@ivy.app>";

struct Scratch {
    home: std::path::PathBuf,
    repo: std::path::PathBuf,
}

impl Scratch {
    fn new(tag: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "tendril-coauthor-e2e-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&home);
        let repo = home.join("repo");
        std::fs::create_dir_all(&repo).expect("create scratch repo");
        let me = Self { home, repo };
        me.git(&["init", "-q"], &[]).expect("git init");
        me
    }

    /// Runs git with a fixed identity so the test does not depend on the machine's
    /// `user.name` -- and, importantly, does not read the developer's own git config.
    fn git(&self, args: &[&str], extra: &[(String, String)]) -> Result<String, String> {
        let mut cmd = std::process::Command::new("git");
        cmd.current_dir(&self.repo)
            .args(args)
            .env("GIT_AUTHOR_NAME", "Tester")
            .env("GIT_AUTHOR_EMAIL", "tester@example.com")
            .env("GIT_COMMITTER_NAME", "Tester")
            .env("GIT_COMMITTER_EMAIL", "tester@example.com");
        for (key, value) in extra {
            cmd.env(key, value);
        }
        let out = cmd.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).to_string())
        }
    }

    fn commit(&self, file: &str, message: &str, env: &[(String, String)]) -> Result<(), String> {
        std::fs::write(self.repo.join(file), file).map_err(|e| e.to_string())?;
        self.git(&["add", "."], &[])?;
        self.git(&["commit", "-q", "-m", message], env).map(|_| ())
    }

    fn last_message(&self) -> String {
        self.git(&["log", "-1", "--pretty=%B"], &[]).expect("git log")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

fn configured_env(home: &std::path::Path) -> Vec<(String, String)> {
    let settings = TendrilSettings {
        co_author: Some(IDENTITY.to_string()),
        ..Default::default()
    };
    let env = coauthor_env(&settings, home, &HashMap::new());
    assert!(
        !env.is_empty(),
        "a configured coAuthor must produce git env pairs"
    );
    env
}

#[test]
fn a_commit_made_under_the_coauthor_env_carries_the_trailer() {
    let scratch = Scratch::new("trailer");
    let env = configured_env(&scratch.home);

    scratch
        .commit("a.txt", "subject line", &env)
        .expect("commit under coauthor env");

    let message = scratch.last_message();
    assert!(
        message.contains(&format!("Co-Authored-By: {IDENTITY}")),
        "commit message lacked the trailer:\n{message}"
    );
}

#[test]
fn a_commit_made_without_the_env_stays_untouched() {
    // The whole point of binding through `GIT_CONFIG_*` rather than writing to the
    // repo's `.git/config` is that a human committing in the same checkout is
    // unaffected. Prove the repo itself was not mutated.
    let scratch = Scratch::new("untouched");
    let env = configured_env(&scratch.home);

    scratch.commit("a.txt", "from tendril", &env).expect("commit");
    scratch.commit("b.txt", "by hand", &[]).expect("commit");

    let message = scratch.last_message();
    assert!(
        !message.contains("Co-Authored-By"),
        "a hand-made commit must not be trailered:\n{message}"
    );
}

#[test]
fn an_unconfigured_install_produces_no_env_and_no_trailer() {
    let scratch = Scratch::new("unset");
    let settings = TendrilSettings::default();
    let env = coauthor_env(&settings, &scratch.home, &HashMap::new());
    assert!(
        env.is_empty(),
        "an unset coAuthor must not install anything: {env:?}"
    );

    scratch.commit("a.txt", "plain", &env).expect("commit");
    assert!(!scratch.last_message().contains("Co-Authored-By"));
}

#[test]
fn the_customers_own_hooks_still_run_and_can_still_block_the_commit() {
    // The trap this guards: pointing `core.hooksPath` at our shim directory replaces
    // the customer's hooks wholesale unless the shims delegate. A pre-commit hook that
    // refuses must still refuse.
    let scratch = Scratch::new("delegate");
    let env = configured_env(&scratch.home);

    let hooks = scratch.repo.join(".git/hooks");
    std::fs::create_dir_all(&hooks).expect("hooks dir");
    let marker = scratch.home.join("pre-commit-ran");
    let pre_commit = hooks.join("pre-commit");
    std::fs::write(
        &pre_commit,
        format!(
            "#!/bin/sh\ntouch '{}'\nif [ -f '{}' ]; then exit 7; fi\nexit 0\n",
            marker.display(),
            scratch.home.join("please-fail").display()
        ),
    )
    .expect("write hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&pre_commit, std::fs::Permissions::from_mode(0o755))
            .expect("chmod hook");
    }

    scratch
        .commit("a.txt", "should pass hooks", &env)
        .expect("commit with a passing customer hook");
    assert!(
        marker.exists(),
        "the customer's pre-commit hook never ran -- the shim is not delegating"
    );
    assert!(scratch.last_message().contains("Co-Authored-By"));

    // Now make the same hook fail. A non-zero exit must abort the commit.
    std::fs::write(scratch.home.join("please-fail"), "").expect("arm failure");
    let err = scratch
        .commit("c.txt", "should be blocked", &env)
        .expect_err("a failing pre-commit hook must abort the commit");
    assert!(!err.is_empty() || scratch.last_message().contains("should pass hooks"));
    assert!(
        !scratch.last_message().contains("should be blocked"),
        "the commit went through despite a failing pre-commit hook"
    );
}
