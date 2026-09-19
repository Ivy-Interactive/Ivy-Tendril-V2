use crate::plans::reader::read_plan_yaml;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DuplicateCandidate {
    pub folder_name: String,
    pub title: String,
    pub state: String,
}

pub struct DuplicateCandidateFinder;

impl DuplicateCandidateFinder {
    const MINIMUM_TOKEN_LENGTH: usize = 4;

    const STOPWORDS: &'static [&'static str] = &[
        "the", "a", "an", "and", "or", "of", "to", "in", "for", "with", "on", "at", "is", "by",
        "from", "that", "this", "it", "as", "be",
    ];

    pub fn find(
        plans_dir: &Path,
        title: &str,
        project: &str,
        exclude_folder_name: Option<&str>,
    ) -> Vec<DuplicateCandidate> {
        let query_tokens = Self::tokenize(title);
        if query_tokens.is_empty() {
            return Vec::new();
        }

        let mut candidates = Vec::new();

        let entries = match std::fs::read_dir(plans_dir) {
            Ok(e) => e,
            Err(_) => return Vec::new(),
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let folder_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };

            if let Some(exclude) = exclude_folder_name {
                if folder_name.eq_ignore_ascii_case(exclude) {
                    continue;
                }
            }

            // Attempt to read plan.yaml
            if let Ok((plan, _)) = read_plan_yaml(&path) {
                if !plan.project.eq_ignore_ascii_case(project) {
                    continue;
                }

                if plan.title.trim().is_empty() {
                    continue;
                }

                let plan_tokens = Self::tokenize(&plan.title);
                if Self::is_match(&query_tokens, &plan_tokens) {
                    candidates.push(DuplicateCandidate {
                        folder_name: folder_name.to_string(),
                        title: plan.title,
                        state: plan.state,
                    });
                }
            }
        }

        // `read_dir` yields whatever order the filesystem happens to hand back - APFS returns these
        // sorted, ext4 does not - and `format_block` prints this list straight to the operator and
        // to the CreatePlan promptware that parses it. Folder names are `NNNNN-Title`, so a name
        // sort is an id sort, matching how plans are listed everywhere else.
        candidates.sort_by(|a, b| a.folder_name.cmp(&b.folder_name));

        candidates
    }

    pub fn format_block(candidates: &[DuplicateCandidate]) -> String {
        if candidates.is_empty() {
            return String::new();
        }

        let mut lines = vec!["DuplicateCandidates:".to_string()];
        for c in candidates {
            lines.push(format!("{}|{}|{}", c.folder_name, c.title, c.state));
        }
        lines.join("\n")
    }

    fn is_match(query_tokens: &HashSet<String>, other_tokens: &HashSet<String>) -> bool {
        let mut significant_overlap = 0;

        for token in query_tokens {
            if !other_tokens.contains(token) {
                continue;
            }

            if Self::is_plan_id(token) {
                return true;
            }

            if token.len() >= Self::MINIMUM_TOKEN_LENGTH {
                significant_overlap += 1;
                if significant_overlap >= 2 {
                    return true;
                }
            }
        }

        false
    }

    fn is_plan_id(token: &str) -> bool {
        token.len() >= 4 && token.chars().all(|c| c.is_ascii_digit())
    }

    pub fn tokenize(title: &str) -> HashSet<String> {
        let mut tokens = HashSet::new();
        if title.trim().is_empty() {
            return tokens;
        }

        let lowered = title.to_ascii_lowercase();
        let chars: Vec<char> = lowered.chars().collect();
        let mut start: Option<usize> = None;

        for (i, &c) in chars.iter().enumerate() {
            let is_word_char = c.is_ascii_alphanumeric();

            if is_word_char {
                if start.is_none() {
                    start = Some(i);
                }
            } else if let Some(s) = start {
                let token: String = chars[s..i].iter().collect();
                start = None;
                if !Self::STOPWORDS.contains(&token.as_str()) {
                    tokens.insert(token);
                }
            }
        }

        if let Some(s) = start {
            let token: String = chars[s..].iter().collect();
            if !Self::STOPWORDS.contains(&token.as_str()) {
                tokens.insert(token);
            }
        }

        tokens
    }
}
