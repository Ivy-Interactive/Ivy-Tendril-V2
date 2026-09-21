//! `config_text`: the masking engine behind the in-app raw `config.yaml` editor.
//!
//! Three properties carry the whole feature, and each has its own section below.
//!
//! 1. **Masking is text-level.** A serde round-trip would strip the comments and reorder the keys
//!    that are the only reason anyone opens a raw editor, so an untouched document must come back
//!    byte for byte.
//! 2. **It fails closed.** Block scalars, flow mappings and multi-line values are the shapes a line
//!    scanner cannot read with confidence. A secret hiding in one must produce an error, never a
//!    document served with the credential still in it.
//! 3. **Unmasking resolves by path.** Two credentials both render as `********`; substituting the
//!    n-th stored secret for the n-th placeholder swaps them the moment the user reorders anything,
//!    and a swapped credential looks exactly like a successful save.

use std::path::PathBuf;
use tendril_core::config_text::{
    mask_config_text, read_config_text_masked, unmask_config_text, write_config_text_unmasked,
    SECRET_MASK,
};

/// A config in the shape real ones take: comments, blank lines, a key order no serializer would
/// choose, secrets at four different depths, and a sequence of coding agents.
const REALISTIC: &str = r#"# Tendril configuration
# Edited by hand; please keep the sections in this order.

codingAgent: claude

llm:
  # OpenRouter, because the local proxy does not carry the long-context models.
  provider: openrouter
  apiKey: sk-or-v1-llm-credential
  endpoint: https://openrouter.ai/api/v1

api:
  apiKey: sk-api-credential   # the X-Api-Key every /api call must present

auth:
  username: rory
  hashSecret: aGFzaC1wZXBwZXI=

codingAgents:
  - name: claude
    arguments: --dangerously-skip-permissions
    environmentVariables:
      ANTHROPIC_API_KEY: sk-ant-agent-zero
      ANTHROPIC_BASE_URL: https://api.anthropic.com
  - name: codex
    environmentVariables:
      OPENAI_API_KEY: sk-openai-agent-one

maxConcurrentJobs: 3
"#;

fn temp_config(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "tendril-config-text-{}-{}",
        tag,
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).expect("create fixture dir");
    dir.join("config.yaml")
}

/// Removes the fixture directory, and asserts first that it really is under the temp root — a
/// `remove_dir_all` in a test is one typo away from deleting a source tree.
struct Fixture(PathBuf);

impl Drop for Fixture {
    fn drop(&mut self) {
        let dir = self.0.parent().expect("fixture path has a parent");
        assert!(dir.starts_with(std::env::temp_dir()));
        let _ = std::fs::remove_dir_all(dir);
    }
}

// -------------------------------------------------------------------------------------------
// 1. Masking is text-level
// -------------------------------------------------------------------------------------------

#[test]
fn an_untouched_document_round_trips_byte_for_byte() {
    let masked = mask_config_text(REALISTIC).expect("the fixture must be maskable");
    let restored = unmask_config_text(&masked.text, REALISTIC).expect("nothing was edited");

    assert_eq!(
        restored, REALISTIC,
        "mask followed by unmask must be the identity function, comments and all"
    );
}

#[test]
fn comments_blank_lines_and_key_order_survive_masking() {
    let masked = mask_config_text(REALISTIC).expect("the fixture must be maskable");

    assert!(masked
        .text
        .contains("# Edited by hand; please keep the sections in this order."));
    assert!(
        masked
            .text
            .contains("# the X-Api-Key every /api call must present"),
        "a trailing comment on a masked line must survive the rewrite"
    );
    assert!(masked.text.contains(
        "  # OpenRouter, because the local proxy does not carry the long-context models."
    ));

    // Key order, verbatim: a serde round-trip would sort or regroup these.
    let order: Vec<&str> = masked
        .text
        .lines()
        .filter(|l| !l.starts_with(' ') && !l.starts_with('#') && l.contains(':'))
        .collect();
    assert_eq!(
        order,
        vec![
            "codingAgent: claude",
            "llm:",
            "api:",
            "auth:",
            "codingAgents:",
            "maxConcurrentJobs: 3",
        ]
    );

    assert_eq!(
        masked.text.lines().count(),
        REALISTIC.lines().count(),
        "no line may be added or dropped"
    );
}

#[test]
fn every_secret_is_masked_and_no_credential_survives_in_the_text() {
    let masked = mask_config_text(REALISTIC).expect("the fixture must be maskable");

    for credential in [
        "sk-or-v1-llm-credential",
        "sk-api-credential",
        "aGFzaC1wZXBwZXI=",
        "sk-ant-agent-zero",
        "sk-openai-agent-one",
    ] {
        assert!(
            !masked.text.contains(credential),
            "{} was served to the editor in cleartext",
            credential
        );
    }

    // An `environmentVariables` block masks every value whatever its own key says, so the base URL
    // goes too. That is deliberate and inherited from the bug reporter's list: the variable names in
    // an agent's environment are the agent's own, and `ANTHROPIC_AUTH_TOKEN` is not something a
    // suffix list can be trusted to have heard of.
    assert!(!masked.text.contains("https://api.anthropic.com"));
    assert!(masked.text.contains("    ANTHROPIC_BASE_URL: \"********\""));

    // Outside such a block, non-secrets are untouched — masking everything would make the editor
    // useless.
    assert!(masked
        .text
        .contains("endpoint: https://openrouter.ai/api/v1"));
    assert!(masked.text.contains("username: rory"));
    assert!(masked
        .text
        .contains("arguments: --dangerously-skip-permissions"));
}

#[test]
fn the_sentinel_is_emitted_quoted_so_the_masked_document_still_parses() {
    let masked = mask_config_text(REALISTIC).expect("the fixture must be maskable");

    assert!(
        masked
            .text
            .contains(&format!("apiKey: \"{}\"", SECRET_MASK)),
        "an unquoted sentinel would not survive validation against a String field"
    );
    serde_yaml::from_str::<serde_yaml::Value>(&masked.text)
        .expect("the masked document must itself be valid YAML");
}

#[test]
fn masked_paths_are_dotted_indexed_and_in_document_order() {
    let masked = mask_config_text(REALISTIC).expect("the fixture must be maskable");

    assert_eq!(
        masked.masked_paths,
        vec![
            "llm.apiKey",
            "api.apiKey",
            "auth.hashSecret",
            "codingAgents[0].environmentVariables.ANTHROPIC_API_KEY",
            // Not a credential by its name, but every value in an `environmentVariables` block is
            // treated as one — see `REDACT_EVERY_VALUE_MAPPINGS`.
            "codingAgents[0].environmentVariables.ANTHROPIC_BASE_URL",
            "codingAgents[1].environmentVariables.OPENAI_API_KEY",
        ]
    );
}

#[test]
fn an_empty_secret_is_not_reported_as_masked() {
    // `********` over an unset key would tell the operator a credential is configured when none is.
    let raw = "llm:\n  apiKey: \"\"\napi:\n  apiKey:\n";
    let masked = mask_config_text(raw).expect("an unset secret is not a scanning failure");

    assert_eq!(masked.text, raw);
    assert!(masked.masked_paths.is_empty());
}

#[test]
fn a_crlf_document_rejoins_byte_for_byte() {
    let raw = "llm:\r\n  apiKey: sk-crlf\r\n";
    let masked = mask_config_text(raw).expect("CRLF is not a scanning failure");

    assert!(!masked.text.contains("sk-crlf"));
    assert_eq!(
        unmask_config_text(&masked.text, raw).expect("nothing was edited"),
        raw,
        "line endings must survive the split/join"
    );
}

// -------------------------------------------------------------------------------------------
// 2. Failing closed
// -------------------------------------------------------------------------------------------

/// Every shape a one-line scanner cannot read, paired with the secret it would leak.
fn unreadable_shapes() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "literal block scalar",
            "llm:\n  apiKey: |\n    sk-block-literal\n",
            "sk-block-literal",
        ),
        (
            "folded block scalar",
            "llm:\n  apiKey: >-\n    sk-block-folded\n",
            "sk-block-folded",
        ),
        (
            "flow mapping hiding the secret key entirely",
            "llm: {provider: openrouter, apiKey: sk-flow-mapping}\n",
            "sk-flow-mapping",
        ),
        (
            "flow mapping under the secret key itself",
            "auth:\n  hashSecret: {value: sk-flow-nested}\n",
            "sk-flow-nested",
        ),
        (
            "flow sequence under a secret key",
            "llm:\n  apiKey: [sk-flow-seq]\n",
            "sk-flow-seq",
        ),
        (
            "plain scalar continued on the next line",
            "llm:\n  apiKey: sk-multi-line-start\n    continued-tail\n",
            "continued-tail",
        ),
        (
            "quoted scalar whose closing quote is on a later line",
            "llm:\n  apiKey: \"sk-open-quote\n    still-the-key\"\n",
            "still-the-key",
        ),
        (
            "secret expanded into a nested block",
            "auth:\n  hashSecret:\n    value: sk-nested-block\n",
            "sk-nested-block",
        ),
        (
            "secret behind an anchor",
            "llm:\n  apiKey: &key sk-anchored\n",
            "sk-anchored",
        ),
        (
            "secret behind an alias",
            "shared: &key sk-aliased\nllm:\n  apiKey: *key\n",
            "sk-aliased",
        ),
    ]
}

#[test]
fn a_secret_the_scanner_cannot_read_is_an_error_not_a_leak() {
    for (label, raw, credential) in unreadable_shapes() {
        match mask_config_text(raw) {
            Err(e) => {
                let message = e.to_string();
                assert!(
                    !message.contains(credential),
                    "{}: the error message leaked the credential: {}",
                    label,
                    message
                );
            }
            Ok(masked) => panic!(
                "{}: masking must fail closed, but it returned:\n{}",
                label, masked.text
            ),
        }
    }
}

#[test]
fn the_same_unreadable_shapes_are_refused_on_the_way_back_in() {
    // The read side failing closed is only half of it: a user who pastes a block scalar into the
    // editor must not be able to write a config the editor can no longer serve.
    for (label, raw, _) in unreadable_shapes() {
        assert!(
            unmask_config_text(raw, "").is_err(),
            "{}: the write path must refuse what the read path refuses",
            label
        );
    }
}

#[test]
fn unreadable_shapes_under_innocuous_keys_are_tolerated_where_they_can_be() {
    // Failing closed must not become failing always: a `planTemplate: |` block is how real configs
    // are written, and refusing to open the editor over one would be a regression against V1.
    let raw = "planTemplate: |\n  # Goal\n\n  Do the thing.\nmaxConcurrentJobs: 3\nllm:\n  apiKey: sk-after-block\n";
    let masked = mask_config_text(raw).expect("a non-secret block scalar is readable");

    assert!(masked.text.contains("  Do the thing."));
    assert!(!masked.text.contains("sk-after-block"));
    assert_eq!(
        masked.masked_paths,
        vec!["llm.apiKey"],
        "the scanner must resume at the right depth after skipping the block"
    );
}

#[test]
fn a_block_the_scanner_would_step_over_is_refused_rather_than_skipped() {
    // `- name:claude` is missing the space after the colon, so it is not a mapping key — it is a
    // plain scalar, and the indented lines below it are not its children. A scanner that treats the
    // block as something to skip walks straight past the `environmentVariables` in it, and the
    // credential is served to the webview untouched. Refusing the whole document is the only safe
    // answer, because the shape that hid this block could hide any other.
    let raw =
        "codingAgents:\n  - name:claude\n    environmentVariables:\n      K: sk-STEPPED-OVER\n";

    let error = mask_config_text(raw).expect_err("a block that cannot be scanned must be refused");
    assert!(!error.to_string().contains("sk-STEPPED-OVER"));
}

#[test]
fn a_scalar_followed_by_deeper_lines_is_refused_even_under_an_innocuous_key() {
    // The same rule, stated on its own: the key here is not a secret, and the refusal is still
    // correct, because what the scanner cannot place is the block underneath.
    let raw = "codingAgent: claude\n  environmentVariables:\n    K: sk-UNDER-INNOCUOUS\n";

    let error = mask_config_text(raw).expect_err("the block below is unscannable");
    assert!(!error.to_string().contains("sk-UNDER-INNOCUOUS"));
}

#[test]
fn a_document_whose_shape_the_scanner_cannot_follow_is_refused() {
    // Each of these puts a line where the indentation stack cannot place it. None is a valid
    // Tendril config, and the point is that an unplaceable line is an error rather than a line
    // quietly dropped from the scan — a dropped line is a secret nobody masked.
    for (label, raw) in [
        (
            "a sequence nested directly in a sequence",
            "projects:\n  - - name: p\n",
        ),
        (
            "a dedent to a column no container opened",
            "llm:\n    apiKey: sk-a\n  model: gpt\n",
        ),
        (
            "a sequence item under a mapping that never opened one",
            "a:\n  b:\n    c: 1\n  - item\n",
        ),
        (
            "a sequence at the root after a mapping",
            "llm:\n  apiKey: sk-b\n- item\n",
        ),
    ] {
        let error = mask_config_text(raw)
            .expect_err(&format!("{}: an unplaceable line must be refused", label));
        assert!(
            !error.to_string().contains("sk-"),
            "{}: the refusal leaked a credential: {}",
            label,
            error
        );
    }
}

#[test]
fn a_secret_key_is_matched_as_a_suffix_and_not_as_a_whole_word() {
    // `githubToken` and `backupApiKey` are not in the list; `token` and `apikey` are, and the list
    // is matched as a suffix precisely so that the prefixed spellings real configs use are caught.
    let raw = "githubToken: ghp-SUFFIX-ONE\nllm:\n  backupApiKey: sk-SUFFIX-TWO\n  AUTH-SECRET: sk-SUFFIX-THREE\n";
    let masked = mask_config_text(raw).expect("all three are plain scalars");

    assert_eq!(
        masked.masked_paths,
        vec!["githubToken", "llm.backupApiKey", "llm.AUTH-SECRET"],
        "suffix matching, with `-` and `_` stripped and case folded"
    );
    for credential in ["ghp-SUFFIX-ONE", "sk-SUFFIX-TWO", "sk-SUFFIX-THREE"] {
        assert!(!masked.text.contains(credential));
    }
}

#[test]
fn a_colon_inside_a_value_does_not_split_a_new_key_off() {
    // `endpoint: https://host` has two colons, and only the first separates a key from a value: a
    // colon does that only when whitespace or the end of the line follows it. A scanner that missed
    // this would path the value under a key called `endpoint: https`.
    let raw = "llm:\n  endpoint: https://openrouter.ai:443/api/v1\n  apiKey: sk-after-colons\n";
    let masked = mask_config_text(raw).expect("both lines are plain scalars");

    assert_eq!(masked.masked_paths, vec!["llm.apiKey"]);
    assert!(masked
        .text
        .contains("  endpoint: https://openrouter.ai:443/api/v1"));
}

#[test]
fn a_secret_whose_value_contains_a_colon_is_masked_whole() {
    let raw = "api:\n  apiKey: user:pass@host:5432\n";
    let masked = mask_config_text(raw).expect("a plain scalar, colons and all");

    assert_eq!(masked.text, "api:\n  apiKey: \"********\"\n");
    assert!(!masked.text.contains("pass@host"));
}

#[test]
fn an_empty_flow_collection_is_not_treated_as_unreadable() {
    let raw = "projects: []\npromptwares: {}\nllm:\n  apiKey: sk-after-flow\n";
    let masked = mask_config_text(raw).expect("empty flow collections hide nothing");

    assert_eq!(masked.masked_paths, vec!["llm.apiKey"]);
}

// -------------------------------------------------------------------------------------------
// 3. Unmasking resolves by path
// -------------------------------------------------------------------------------------------

/// Two different credentials, deliberately arranged so that positional substitution produces a
/// clean-looking save with the keys swapped.
const TWO_SECRETS: &str = "llm:\n  apiKey: sk-llm-FIRST\napi:\n  apiKey: sk-api-SECOND\n";

#[test]
fn reordering_the_document_does_not_swap_the_two_credentials() {
    let masked = mask_config_text(TWO_SECRETS).expect("both secrets are plain scalars");
    assert_eq!(masked.masked_paths, vec!["llm.apiKey", "api.apiKey"]);

    // The user moves `api` above `llm` and changes nothing else. The first placeholder in the
    // edited text is now `api.apiKey`, so positional substitution hands it `sk-llm-FIRST` and the
    // save silently swaps the two credentials.
    let edited = "api:\n  apiKey: \"********\"\nllm:\n  apiKey: \"********\"\n";
    let written =
        unmask_config_text(edited, TWO_SECRETS).expect("both paths exist in the original");

    assert_eq!(
        written, "api:\n  apiKey: sk-api-SECOND\nllm:\n  apiKey: sk-llm-FIRST\n",
        "each placeholder must resolve by its own path, not by its position in the document"
    );
}

#[test]
fn deleting_the_first_secret_does_not_shift_the_second_onto_the_wrong_key() {
    // One placeholder, and it is the second secret. Positional substitution feeds it the first.
    let edited = "api:\n  apiKey: \"********\"\n";
    let written =
        unmask_config_text(edited, TWO_SECRETS).expect("api.apiKey exists in the original");

    assert_eq!(written, "api:\n  apiKey: sk-api-SECOND\n");
    assert!(!written.contains("sk-llm-FIRST"));
}

#[test]
fn two_agents_keep_their_own_environment_credentials() {
    let masked = mask_config_text(REALISTIC).expect("the fixture must be maskable");
    let written = unmask_config_text(&masked.text, REALISTIC).expect("nothing was edited");

    let zero = written
        .find("sk-ant-agent-zero")
        .expect("agent zero keeps its own key");
    let one = written
        .find("sk-openai-agent-one")
        .expect("agent one keeps its own key");
    assert!(
        zero < one,
        "the sequence indices must keep each agent's credential under that agent"
    );
}

#[test]
fn a_value_the_user_overtyped_writes_through_as_the_new_secret() {
    let edited = "llm:\n  apiKey: sk-llm-ROTATED\napi:\n  apiKey: \"********\"\n";
    let written = unmask_config_text(edited, TWO_SECRETS).expect("the one placeholder resolves");

    assert_eq!(
        written, "llm:\n  apiKey: sk-llm-ROTATED\napi:\n  apiKey: sk-api-SECOND\n",
        "an overtyped value is a new secret; an untouched placeholder is the stored one"
    );
}

#[test]
fn an_unquoted_placeholder_still_counts_as_untouched() {
    // The editor emits `"********"`, but a user retyping the line by hand drops the quotes and
    // still means "I did not change this".
    let edited = "llm:\n  apiKey: ********\napi:\n  apiKey: '********'\n";
    let written = unmask_config_text(edited, TWO_SECRETS).expect("both placeholders resolve");

    assert_eq!(
        written,
        "llm:\n  apiKey: sk-llm-FIRST\napi:\n  apiKey: sk-api-SECOND\n"
    );
}

#[test]
fn a_placeholder_at_a_path_the_original_does_not_have_is_an_error() {
    let edited = "llm:\n  apiKey: sk-llm-FIRST\napi:\n  apiKey: sk-api-SECOND\nauth:\n  hashSecret: \"********\"\n";
    let error = unmask_config_text(edited, TWO_SECRETS)
        .expect_err("a placeholder with nothing behind it cannot be resolved");

    assert!(
        error
            .to_string()
            .contains("cannot resolve masked value for auth.hashSecret"),
        "the error must name the path the user has to retype, got: {}",
        error
    );
}

#[test]
fn a_placeholder_moved_to_a_different_key_is_an_error_rather_than_a_guess() {
    // The user renames `llm` to `llmBackup` and leaves the placeholder. There is a stored secret
    // that "looks right" at the old path, and resolving it there would silently copy a credential
    // into a key the operator never put it in.
    let edited = "llmBackup:\n  apiKey: \"********\"\napi:\n  apiKey: \"********\"\n";
    let error = unmask_config_text(edited, TWO_SECRETS).expect_err("llmBackup.apiKey is new");

    assert!(error
        .to_string()
        .contains("cannot resolve masked value for llmBackup.apiKey"));
}

#[test]
fn a_document_with_no_placeholders_never_needs_the_original_to_parse() {
    // The raw editor's main job is repairing a config.yaml too broken to load. Demanding that the
    // broken original parse before any save would lock the user out of the only screen that helps.
    let broken_on_disk = "llm:\n  apiKey: sk-old\n  apiKey: sk-duplicate-key\n";
    let edited = "llm:\n  apiKey: sk-repaired\n";

    assert_eq!(
        unmask_config_text(edited, broken_on_disk).expect("no placeholder, no lookup"),
        edited
    );
}

#[test]
fn a_key_containing_a_dot_resolves_to_its_own_node_and_not_a_nested_one() {
    // `vault.apiKey` at the root is ONE key; `vault:` then `apiKey:` is two. Both render as the
    // same dotted string, which is exactly why resolution must not work by re-splitting it — doing
    // so would hand the flat key's placeholder the nested key's credential.
    let raw = "vault.apiKey: sk-FLAT-KEY\nvault:\n  apiKey: sk-NESTED-KEY\n";
    let masked = mask_config_text(raw).expect("both are plain scalars");
    assert_eq!(
        masked.masked_paths,
        vec!["vault.apiKey", "vault.apiKey"],
        "two distinct nodes render as the same dotted path, so the rendering is for display only"
    );

    let written = unmask_config_text(&masked.text, raw).expect("both placeholders resolve");
    assert_eq!(
        written, raw,
        "each placeholder must come back with the value from its own node"
    );
}

#[test]
fn a_placeholder_resolves_only_when_the_text_index_and_the_parsed_tree_agree() {
    // Resolution consults two independently-built views of the original: the scanner's text index
    // and a `serde_yaml` tree. Agreement is required, and that is what makes a scanner bug fail
    // loudly. Suppose the indentation stack mis-numbered a sequence and both agents' credentials
    // landed under `codingAgents[0]`: without the cross-check, agent 1's placeholder resolves to
    // agent 0's key and the save looks clean while the two agents now share a credential. With it,
    // the disagreement between the index and the tree refuses the save.
    //
    // The guarantee under test is the positive one — a document whose two views DO agree resolves,
    // and every value comes back to its own node.
    let raw = "codingAgents:\n  - name: a\n    environmentVariables:\n      K: sk-AGENT-ZERO\n  - name: b\n    environmentVariables:\n      K: sk-AGENT-ONE\n";
    let masked = mask_config_text(raw).expect("both are plain scalars");
    assert_eq!(
        masked.masked_paths,
        vec![
            "codingAgents[0].environmentVariables.K",
            "codingAgents[1].environmentVariables.K",
        ],
        "the two agents must be numbered apart, or their credentials are interchangeable"
    );

    let written = unmask_config_text(&masked.text, raw).expect("both placeholders resolve");
    assert_eq!(
        written, raw,
        "each agent must get its own credential back, not the other's"
    );
}

#[test]
fn a_repeated_secret_key_is_refused_rather_than_resolved_to_a_guess() {
    // `serde_yaml` rejects a duplicate key outright, so there is no tree to resolve against and no
    // way to know which of the two the user meant. Refusing beats writing the wrong one.
    let raw = "llm:\n  apiKey: sk-FIRST-DUP\n  apiKey: sk-SECOND-DUP\n";
    let masked = mask_config_text(raw).expect("both lines are plain scalars");

    let error =
        unmask_config_text(&masked.text, raw).expect_err("a duplicate key has no one value");
    assert!(!error.to_string().contains("sk-FIRST-DUP"));
    assert!(!error.to_string().contains("sk-SECOND-DUP"));
}

// -------------------------------------------------------------------------------------------
// Disk: read, write, validate
// -------------------------------------------------------------------------------------------

#[test]
fn read_masked_then_write_unedited_leaves_the_file_byte_identical() {
    let path = temp_config("roundtrip");
    let _fx = Fixture(path.clone());
    std::fs::write(&path, REALISTIC).unwrap();

    let masked = read_config_text_masked(&path).expect("the fixture must be readable");
    assert!(!masked.text.contains("sk-or-v1-llm-credential"));

    write_config_text_unmasked(&path, &masked.text).expect("an unedited save must succeed");

    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        REALISTIC,
        "saving an untouched document must not rewrite a single byte"
    );
}

#[test]
fn the_sentinel_is_never_written_to_disk() {
    let path = temp_config("never-sentinel");
    let _fx = Fixture(path.clone());
    std::fs::write(&path, REALISTIC).unwrap();

    let masked = read_config_text_masked(&path).expect("readable");
    write_config_text_unmasked(&path, &masked.text).expect("unedited save");

    assert!(
        !std::fs::read_to_string(&path)
            .unwrap()
            .contains(SECRET_MASK),
        "a placeholder on disk is a destroyed credential"
    );
}

#[test]
fn an_unresolvable_placeholder_never_reaches_disk() {
    let path = temp_config("unresolvable");
    let _fx = Fixture(path.clone());
    std::fs::write(&path, TWO_SECRETS).unwrap();

    let edited = "llm:\n  apiKey: \"********\"\napi:\n  apiKey: \"********\"\nauth:\n  hashSecret: \"********\"\n";
    let error = write_config_text_unmasked(&path, edited).expect_err("auth.hashSecret is new");
    assert!(error.to_string().contains("auth.hashSecret"));

    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        TWO_SECRETS,
        "a refused save must leave the file exactly as it was"
    );
}

#[test]
fn invalid_yaml_is_refused_before_the_write() {
    let path = temp_config("invalid");
    let _fx = Fixture(path.clone());
    std::fs::write(&path, TWO_SECRETS).unwrap();

    let error = write_config_text_unmasked(&path, "llm:\n  apiKey: sk-new\n api: broken\n")
        .expect_err("mis-indented YAML must not be written");
    assert!(!error.to_string().is_empty());

    assert_eq!(std::fs::read_to_string(&path).unwrap(), TWO_SECRETS);
}

#[test]
fn a_validation_error_is_the_one_raised_against_what_the_user_submitted() {
    // Validation runs on the UNMASKED text, and `serde_yaml` quotes the offending value in its
    // message, so the naive implementation hands the caller an error containing a real credential.
    // The message returned must be the one the SUBMITTED (still masked) text produces.
    //
    // `maxConcurrentJobs` is the lever: it wants an `i32`, so whatever string sits there is quoted
    // back verbatim. Here the stored secret is what lands in it after unmasking.
    let path = temp_config("no-leak");
    let _fx = Fixture(path.clone());
    std::fs::write(&path, "maxConcurrentJobs: sk-live-DISK-CREDENTIAL\n").unwrap();

    // The key is a secret by suffix, so the editor served it masked; the user saves it untouched.
    let edited = "maxConcurrentJobs: \"********\"\n";
    let error = write_config_text_unmasked(&path, edited)
        .expect_err("a string where an i32 belongs is not a valid config");

    assert!(
        !error.to_string().contains("sk-live-DISK-CREDENTIAL"),
        "the validation error quoted the stored credential back to the caller: {}",
        error
    );
    assert!(
        error.to_string().contains(SECRET_MASK),
        "the error should be the one raised against the masked text, got: {}",
        error
    );
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "maxConcurrentJobs: sk-live-DISK-CREDENTIAL\n",
        "a refused save must leave the file exactly as it was"
    );
}

#[test]
fn an_original_that_does_not_parse_is_refused_without_quoting_what_is_in_it() {
    // `%VAR%` values are real — `report_bug.rs::quote_variable_references` exists because configs
    // in the wild carry them — and they do not parse: `%` opens a YAML directive, so a plain scalar
    // cannot start with one. The placeholders in the editor cannot be resolved against such a file,
    // and the refusal must not echo the line it choked on.
    let path = temp_config("unparseable");
    let _fx = Fixture(path.clone());
    let on_disk = "llm:\n  apiKey: %TENDRIL_LLM_KEY%\n";
    std::fs::write(&path, on_disk).unwrap();

    let error = write_config_text_unmasked(&path, "llm:\n  apiKey: \"********\"\n")
        .expect_err("nothing can be resolved out of a file that does not parse");

    assert!(!error.to_string().contains("%TENDRIL_LLM_KEY%"));
    assert!(
        error.to_string().contains("cannot be parsed"),
        "the user has to be told why retyping is the only way forward, got: {}",
        error
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), on_disk);
}

#[test]
fn a_write_that_holds_the_lock_does_not_deadlock_on_itself() {
    // `FileLock` does not nest (fs_lock.rs:62-65), so a write path that reached for `save_config`
    // or `update_config_raw` would burn its 5 s retry budget and fail. This finishing well under
    // that budget is the assertion.
    let path = temp_config("lock");
    let _fx = Fixture(path.clone());
    std::fs::write(&path, TWO_SECRETS).unwrap();

    let started = std::time::Instant::now();
    write_config_text_unmasked(
        &path,
        "llm:\n  apiKey: \"********\"\napi:\n  apiKey: sk-new\n",
    )
    .expect("the save must go through");
    assert!(
        started.elapsed() < std::time::Duration::from_secs(2),
        "the write path looks like it is waiting on a lock it already holds"
    );

    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "llm:\n  apiKey: sk-llm-FIRST\napi:\n  apiKey: sk-new\n"
    );
}

#[test]
fn a_concurrent_save_cannot_read_the_original_out_from_under_another() {
    // The lock has to span read-original -> unmask -> validate -> write. Without it, two saves that
    // each leave one placeholder untouched can interleave so that both read the same original and
    // the second write drops the first's edit. Holding it across the whole cycle serialises them,
    // so whichever lands second resolves its placeholder against the first one's result.
    let path = temp_config("concurrent");
    let _fx = Fixture(path.clone());
    std::fs::write(&path, TWO_SECRETS).unwrap();

    // Each writer rotates its own key and leaves the other masked.
    let writers: Vec<_> = [
        (
            "llm:\n  apiKey: sk-llm-ROTATED\napi:\n  apiKey: \"********\"\n",
            "sk-llm-ROTATED",
        ),
        (
            "llm:\n  apiKey: \"********\"\napi:\n  apiKey: sk-api-ROTATED\n",
            "sk-api-ROTATED",
        ),
    ]
    .into_iter()
    .map(|(text, _)| {
        let path = path.clone();
        std::thread::spawn(move || write_config_text_unmasked(&path, text))
    })
    .collect();

    for writer in writers {
        writer
            .join()
            .expect("no writer may panic")
            .expect("no writer may fail");
    }

    let on_disk = std::fs::read_to_string(&path).unwrap();
    assert!(
        !on_disk.contains(SECRET_MASK),
        "an interleaved read left a placeholder that resolved against nothing: {}",
        on_disk
    );
    // Whichever ran second saw the first's write, so its untouched placeholder carries that
    // rotation rather than the value the file started with.
    let rotations = ["sk-llm-ROTATED", "sk-api-ROTATED"]
        .iter()
        .filter(|r| on_disk.contains(*r))
        .count();
    assert_eq!(
        rotations, 2,
        "one save overwrote the other's edit, which is what the lock exists to prevent: {}",
        on_disk
    );
}

#[test]
fn a_config_that_does_not_exist_yet_reads_as_an_empty_document() {
    let path = temp_config("absent");
    let _fx = Fixture(path.clone());

    let masked = read_config_text_masked(&path).expect("a fresh install has no config.yaml");
    assert_eq!(masked.text, "");
    assert!(masked.masked_paths.is_empty());

    write_config_text_unmasked(&path, "codingAgent: claude\n").expect("the first save creates it");
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        "codingAgent: claude\n"
    );
}
