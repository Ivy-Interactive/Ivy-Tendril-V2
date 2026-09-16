//! Ordering for a model catalogue, ported from V1's `Helpers/ModelCatalogSorter.cs`.
//!
//! V1 sorts every list it shows in a picker rather than showing declaration order, so the newest
//! flagship of each family leads and the aliases trail. The comparison is, in order:
//!
//! 1. provider group (Anthropic, then OpenAI, then Google, …),
//! 2. family tier (Fable before Opus before Sonnet before Haiku; GPT-6/5.6 flagships before
//!    GPT-5.x before GPT-4.x before the o-series),
//! 3. sub-tier, which only separates the OpenAI flagships (Sol, Terra, Luna),
//! 4. version **descending**, so 5.1 precedes 5,
//! 5. variant (full/pro, then flash, then mini/lite, then nano, then preview),
//! 6. display name, so the order is total.
//!
//! An id of `default` always sorts last, and [`sort_models`] can instead pin it first — V1's
//! `preserveDefault`, which is how the "whatever the provider defaults to" row stays at the head of
//! a picker.
//!
//! V1 does the version and family extraction with regexes carrying lookarounds, which the `regex`
//! crate does not support, so the parsing here is hand-rolled. The V1 test vectors in
//! `Ivy.Tendril.Agents.Test/Helpers/ModelCatalogSorterTests.cs` are reproduced in this module's
//! tests to keep the two implementations honest.

use std::cmp::Ordering;

use super::catalog::DEFAULT_OPTION_ID;

/// Anything the sorter can order: a model id and the name shown for it.
pub trait SortableModel {
    fn model_id(&self) -> &str;
    fn model_display_name(&self) -> &str;
}

/// The provider a model id belongs to. V1 `ModelCatalogSorter.GetProviderKey`, minus its
/// `ModelInfo.Provider` branch: V2's catalogue rows carry no provider field, so the id is the only
/// evidence — which is also the branch V1 falls back to for every row whose provider is `custom`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ProviderGroup {
    Anthropic,
    OpenAi,
    Google,
    Moonshot,
    DeepSeek,
    Qwen,
    Other,
}

impl ProviderGroup {
    pub fn of(model_id: &str) -> Self {
        let id = model_id.to_ascii_lowercase();
        let has = |needle: &str| id.contains(needle);

        if has("claude") || has("fable") || has("opus") || has("sonnet") || has("haiku") {
            return Self::Anthropic;
        }
        if has("gpt")
            || id.starts_with("o1")
            || id.starts_with("o3")
            || id.starts_with("o4")
            || has("codex")
            || has("astra")
        {
            return Self::OpenAi;
        }
        if has("gemini") {
            return Self::Google;
        }
        if has("kimi") || has("moonshot") {
            return Self::Moonshot;
        }
        if has("deepseek") {
            return Self::DeepSeek;
        }
        if has("qwen") {
            return Self::Qwen;
        }
        Self::Other
    }

    /// V1's `ProviderOrder`, the first key `CompareModels` compares on.
    fn order(self) -> u32 {
        match self {
            Self::Anthropic => 1,
            Self::OpenAi => 2,
            Self::Google => 3,
            Self::Moonshot => 4,
            Self::DeepSeek => 5,
            Self::Qwen => 6,
            Self::Other => 10,
        }
    }
}

/// A `major.minor` pair. Absent or unparseable versions are `0.0`, which sorts last because
/// versions compare descending.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
struct Version {
    major: u32,
    minor: u32,
}

impl Version {
    fn new(major: u32, minor: u32) -> Self {
        Self { major, minor }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ModelRank {
    provider_order: u32,
    tier: u32,
    sub_tier: u32,
    version: Version,
    variant: u32,
}

/// V1 `ModelCatalogSorter.CompareModels`.
pub fn compare_models<T: SortableModel + ?Sized>(x: &T, y: &T) -> Ordering {
    let x_default = x.model_id().eq_ignore_ascii_case(DEFAULT_OPTION_ID);
    let y_default = y.model_id().eq_ignore_ascii_case(DEFAULT_OPTION_ID);
    match (x_default, y_default) {
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        (false, false) => {}
    }

    let rank_x = model_rank(x.model_id(), x.model_display_name());
    let rank_y = model_rank(y.model_id(), y.model_display_name());

    rank_x
        .provider_order
        .cmp(&rank_y.provider_order)
        .then(rank_x.tier.cmp(&rank_y.tier))
        .then(rank_x.sub_tier.cmp(&rank_y.sub_tier))
        // Version descending: the newer model leads.
        .then(rank_y.version.cmp(&rank_x.version))
        .then(rank_x.variant.cmp(&rank_y.variant))
        .then_with(|| {
            let left = if x.model_display_name().is_empty() {
                x.model_id()
            } else {
                x.model_display_name()
            };
            let right = if y.model_display_name().is_empty() {
                y.model_id()
            } else {
                y.model_display_name()
            };
            left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase())
        })
}

/// Orders `models` in place.
///
/// V1 groups by the provider group's *first appearance* in the incoming list, so a catalogue that
/// leads with its own provider keeps it at the top (Copilot's GPT rows before its Claude rows) even
/// though Anthropic outranks OpenAI inside a group. V2's rows come from one shared spec table rather
/// than a per-agent declaration, so `group_order` supplies the appearance order the agent's V1
/// catalogue would have had; groups it does not name keep V1's first-appearance behaviour and follow
/// the named ones.
///
/// `preserve_default` pins the `default` row at the head instead of the tail — V1's `preserveDefault`,
/// used by every picker.
pub fn sort_models<T: SortableModel>(
    models: &mut Vec<T>,
    group_order: &[ProviderGroup],
    preserve_default: bool,
) {
    if models.len() <= 1 {
        return;
    }

    let pinned = if preserve_default {
        models
            .iter()
            .position(|model| model.model_id().eq_ignore_ascii_case(DEFAULT_OPTION_ID))
            .map(|index| models.remove(index))
    } else {
        None
    };

    let mut groups: Vec<(ProviderGroup, Vec<T>)> = group_order
        .iter()
        .map(|group| (*group, Vec::new()))
        .collect();

    for model in models.drain(..) {
        let group = ProviderGroup::of(model.model_id());
        match groups.iter_mut().find(|(known, _)| *known == group) {
            Some((_, bucket)) => bucket.push(model),
            None => groups.push((group, vec![model])),
        }
    }

    if let Some(default_row) = pinned {
        models.push(default_row);
    }
    for (_, mut bucket) in groups {
        bucket.sort_by(compare_models);
        models.append(&mut bucket);
    }
}

fn model_rank(id: &str, display_name: &str) -> ModelRank {
    let id = id.to_ascii_lowercase();
    let name = display_name.to_ascii_lowercase();
    let combined = format!("{} {}", id, name);

    match ProviderGroup::of(&id) {
        ProviderGroup::Anthropic => anthropic_rank(&id, &name, &combined),
        ProviderGroup::OpenAi => openai_rank(&id, &name, &combined),
        ProviderGroup::Google => google_rank(&id, &name, &combined),
        ProviderGroup::Moonshot => keyword_rank(
            ProviderGroup::Moonshot,
            kimi_version(&combined).unwrap_or_default(),
        ),
        ProviderGroup::DeepSeek => keyword_rank(
            ProviderGroup::DeepSeek,
            deepseek_version(&combined).unwrap_or_default(),
        ),
        ProviderGroup::Qwen => keyword_rank(
            ProviderGroup::Qwen,
            qwen_version(&combined).unwrap_or_default(),
        ),
        ProviderGroup::Other => keyword_rank(
            ProviderGroup::Other,
            generic_version(&combined).unwrap_or_default(),
        ),
    }
}

fn keyword_rank(group: ProviderGroup, version: Version) -> ModelRank {
    ModelRank {
        provider_order: group.order(),
        tier: 0,
        sub_tier: 0,
        version,
        variant: 0,
    }
}

/// Fable, then Opus, then Sonnet, then Haiku, then anything else Anthropic.
fn anthropic_rank(id: &str, name: &str, combined: &str) -> ModelRank {
    let tier = if combined.contains("fable") {
        0
    } else if combined.contains("opus") {
        1
    } else if combined.contains("sonnet") {
        2
    } else if combined.contains("haiku") {
        3
    } else {
        4
    };

    ModelRank {
        provider_order: ProviderGroup::Anthropic.order(),
        tier,
        sub_tier: 0,
        version: anthropic_version(id, name),
        variant: u32::from(combined.contains("alt")),
    }
}

const ANTHROPIC_TIERS: [&str; 4] = ["fable", "opus", "sonnet", "haiku"];

fn anthropic_version(id: &str, name: &str) -> Version {
    for tier in ANTHROPIC_TIERS {
        if let Some(version) = version_after(id, tier, &['-'], &['-', '.', '_'], true) {
            return version;
        }
    }
    for tier in ANTHROPIC_TIERS {
        if let Some(version) = version_after(id, tier, &['-'], &[], false) {
            return version;
        }
    }
    if let Some(version) = version_after(id, "claude", &['-'], &['-', '.', '_'], true) {
        return version;
    }
    if let Some(version) = version_after(id, "claude", &['-'], &[], false) {
        return version;
    }
    for tier in ANTHROPIC_TIERS {
        if let Some(version) = version_after(name, tier, &[' '], &['.'], false) {
            return version;
        }
    }
    generic_version(name).unwrap_or_default()
}

/// GPT-6/5.6 flagships, then GPT-5.x, then GPT-4.x, then the o-series, then everything else.
fn openai_rank(id: &str, name: &str, combined: &str) -> ModelRank {
    let mut sub_tier = 0;
    let mut variant = 0;
    let tier;
    let version;

    if combined.contains("astra") {
        tier = 0;
        version = openai_version(id, name, Version::new(6, 0));
    } else if combined.contains("sol") {
        tier = 0;
        version = openai_version(id, name, Version::new(5, 6));
    } else if combined.contains("terra") {
        tier = 0;
        sub_tier = 1;
        version = openai_version(id, name, Version::new(5, 6));
    } else if combined.contains("luna") {
        tier = 0;
        sub_tier = 2;
        version = openai_version(id, name, Version::new(5, 6));
    } else if combined.contains("gpt-5") || combined.contains("gpt 5") {
        tier = 1;
        version = openai_version(id, name, Version::new(5, 0));
        if combined.contains("mini") {
            variant = 1;
        }
    } else if combined.contains("gpt-4") || combined.contains("gpt 4") {
        tier = 2;
        version = openai_version(id, name, Version::new(4, 0));
        if combined.contains("nano") {
            variant = 2;
        } else if combined.contains("mini") {
            variant = 1;
        }
    } else if let Some(o_version) = o_series_version(id) {
        tier = 3;
        version = o_version;
        if combined.contains("mini") {
            variant = 1;
        }
    } else {
        tier = 4;
        version = openai_version(id, name, Version::default());
    }

    ModelRank {
        provider_order: ProviderGroup::OpenAi.order(),
        tier,
        sub_tier,
        version,
        variant,
    }
}

fn openai_version(id: &str, name: &str, fallback: Version) -> Version {
    version_after(id, "gpt", &['-'], &['-', '.', '_'], true)
        .or_else(|| version_after(id, "gpt", &['-'], &[], false))
        .or_else(|| version_after(name, "gpt", &['-'], &['.'], false))
        .or_else(|| generic_version(name))
        .unwrap_or(fallback)
}

fn google_rank(id: &str, name: &str, combined: &str) -> ModelRank {
    // `pro` is tested first, exactly as V1 does, so `gemini-3-pro-preview` ranks as a Pro rather
    // than as a preview.
    let variant = if combined.contains("pro") {
        0
    } else if combined.contains("flash-lite") || combined.contains("flash lite") {
        2
    } else if combined.contains("flash") {
        1
    } else if combined.contains("preview") {
        3
    } else {
        0
    };

    ModelRank {
        provider_order: ProviderGroup::Google.order(),
        tier: 0,
        sub_tier: 0,
        version: version_after(id, "gemini", &['-'], &['-', '.', '_'], true)
            .or_else(|| version_after(id, "gemini", &['-'], &[], false))
            .or_else(|| version_after(name, "gemini", &[' '], &['.'], false))
            .or_else(|| generic_version(name))
            .unwrap_or_default(),
        variant,
    }
}

fn kimi_version(combined: &str) -> Option<Version> {
    for keyword in ["kimi", "k"] {
        let mut from = 0;
        while let Some(offset) = combined[from..].find(keyword) {
            let after = from + offset + keyword.len();
            let rest = &combined[after..];
            // `[.\-_]?k?` — both optional, so `kimi-k3`, `kimi k3` and `k3` all parse.
            let rest = rest.strip_prefix(is_id_separator).unwrap_or(rest);
            let rest = rest.strip_prefix('k').unwrap_or(rest);
            if let Some(version) = version_here(rest, &['-', '.', '_']) {
                return Some(version);
            }
            from = after;
            if from >= combined.len() {
                break;
            }
        }
    }
    None
}

fn deepseek_version(combined: &str) -> Option<Version> {
    let mut from = 0;
    while let Some(offset) = combined[from..].find("deepseek-") {
        let after = from + offset + "deepseek-".len();
        let rest = &combined[after..];
        if let Some(rest) = rest.strip_prefix('v').or_else(|| rest.strip_prefix('r')) {
            if let Some(version) = version_here(rest, &['-', '.', '_']) {
                return Some(version);
            }
        }
        from = after;
        if from >= combined.len() {
            break;
        }
    }
    None
}

fn qwen_version(combined: &str) -> Option<Version> {
    let mut from = 0;
    while let Some(offset) = combined[from..].find("qwen") {
        let after = from + offset + "qwen".len();
        let rest = &combined[after..];
        let rest = rest.strip_prefix(is_id_separator).unwrap_or(rest);
        if let Some(version) = version_here(rest, &['-', '.', '_']) {
            return Some(version);
        }
        from = after;
        if from >= combined.len() {
            break;
        }
    }
    None
}

/// V1's `OSeriesRegex`: an `o` at the start or after a non-alphanumeric, followed by digits.
fn o_series_version(id: &str) -> Option<Version> {
    let bytes = id.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b'o' {
            continue;
        }
        if index > 0 && bytes[index - 1].is_ascii_alphanumeric() {
            continue;
        }
        if let Some(version) = version_here(&id[index + 1..], &['-', '.', '_']) {
            return Some(version);
        }
    }
    None
}

fn is_id_separator(c: char) -> bool {
    matches!(c, '-' | '.' | '_')
}

/// The version starting at `rest`: leading digits, then optionally one of `minor_seps` and more
/// digits.
fn version_here(rest: &str, minor_seps: &[char]) -> Option<Version> {
    let (major, tail) = leading_number(rest)?;
    let minor = tail
        .strip_prefix(|c: char| minor_seps.contains(&c))
        .and_then(leading_number)
        .map(|(minor, _)| minor)
        .unwrap_or(0);
    Some(Version::new(major, minor))
}

/// The version that follows the first occurrence of `keyword` that carries one: one character from
/// `seps`, then the digits. `require_minor` rejects a match with no minor part, which is how V1
/// tries `opus-5-1` before falling back to `opus-5`.
fn version_after(
    haystack: &str,
    keyword: &str,
    seps: &[char],
    minor_seps: &[char],
    require_minor: bool,
) -> Option<Version> {
    let mut from = 0;
    while let Some(offset) = haystack[from..].find(keyword) {
        let after = from + offset + keyword.len();
        let rest = &haystack[after..];
        if let Some(rest) = rest.strip_prefix(|c: char| seps.contains(&c)) {
            if let Some((major, tail)) = leading_number(rest) {
                let minor = tail
                    .strip_prefix(|c: char| minor_seps.contains(&c))
                    .and_then(leading_number)
                    .map(|(minor, _)| minor);
                match minor {
                    Some(minor) => return Some(Version::new(major, minor)),
                    None if !require_minor => return Some(Version::new(major, 0)),
                    None => {}
                }
            }
        }
        from = after;
        if from >= haystack.len() {
            break;
        }
    }
    None
}

/// The first `<digits>.<digits>` in `haystack`. Taking maximal digit runs is what V1's `(?<!\d)` and
/// `(?!\d)` guards buy it.
fn generic_version(haystack: &str) -> Option<Version> {
    let bytes = haystack.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index < bytes.len() && bytes[index] == b'.' {
            let minor_start = index + 1;
            let mut end = minor_start;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end > minor_start {
                return Some(Version::new(
                    haystack[start..index].parse().ok()?,
                    haystack[minor_start..end].parse().ok()?,
                ));
            }
        }
    }
    None
}

fn leading_number(text: &str) -> Option<(u32, &str)> {
    let end = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    if end == 0 {
        return None;
    }
    text[..end].parse().ok().map(|value| (value, &text[end..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Row(&'static str, &'static str);

    impl SortableModel for Row {
        fn model_id(&self) -> &str {
            self.0
        }
        fn model_display_name(&self) -> &str {
            self.1
        }
    }

    fn sorted(rows: Vec<Row>) -> Vec<&'static str> {
        let mut rows = rows;
        sort_models(&mut rows, &[], false);
        rows.iter().map(|row| row.0).collect()
    }

    /// V1 `ModelCatalogSorterTests.Sort_ClaudeModels_SortsByTierAndDescendingVersion`.
    #[test]
    fn claude_models_sort_by_tier_then_descending_version() {
        let rows = vec![
            Row("claude-3-5-sonnet", "Claude Sonnet 3.5"),
            Row("claude-opus-4-5", "Claude Opus 4.5"),
            Row("claude-sonnet-5", "Claude Sonnet 5"),
            Row("claude-opus-5", "Claude Opus 5"),
            Row("claude-haiku-4-5", "Claude Haiku 4.5"),
            Row("claude-opus-4-8", "Claude Opus 4.8"),
            Row("claude-fable-5", "Claude Fable 5"),
            Row("claude-opus-5-1", "Claude Opus 5.1"),
            Row("claude-sonnet-5-1", "Claude Sonnet 5.1"),
            Row("claude-haiku-5-1", "Claude Haiku 5.1"),
            Row("claude-sonnet-4-6", "Claude Sonnet 4.6"),
            Row("claude-3.7-sonnet", "Claude Sonnet 3.7"),
            Row("claude-3-haiku", "Claude Haiku 3"),
        ];

        assert_eq!(
            sorted(rows),
            vec![
                "claude-fable-5",
                "claude-opus-5-1",
                "claude-opus-5",
                "claude-opus-4-8",
                "claude-opus-4-5",
                "claude-sonnet-5-1",
                "claude-sonnet-5",
                "claude-sonnet-4-6",
                "claude-3.7-sonnet",
                "claude-3-5-sonnet",
                "claude-haiku-5-1",
                "claude-haiku-4-5",
                "claude-3-haiku",
            ]
        );
    }

    /// V1 `ModelCatalogSorterTests.Sort_OpenAiModels_SortsFlagshipsGpt5Gpt4AndOSeries`.
    #[test]
    fn openai_models_sort_flagships_then_gpt5_then_gpt4_then_o_series() {
        let rows = vec![
            Row("gpt-4.1", "GPT-4.1"),
            Row("gpt-5.4", "GPT-5.4"),
            Row("o1", "O1"),
            Row("gpt-6-astra", "GPT-6 Astra"),
            Row("gpt-5.6-terra", "GPT-5.6-Terra"),
            Row("o4-mini", "O4 Mini"),
            Row("gpt-5.6-sol", "GPT-5.6-Sol"),
            Row("gpt-5.6-luna", "GPT-5.6-Luna"),
            Row("gpt-5.5", "GPT-5.5"),
            Row("o3", "O3"),
        ];

        assert_eq!(
            sorted(rows),
            vec![
                "gpt-6-astra",
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "gpt-5.4",
                "gpt-4.1",
                "o4-mini",
                "o3",
                "o1",
            ]
        );
    }

    /// V1 `ModelCatalogSorterTests.Sort_GeminiModels_SortsDescendingVersion`.
    #[test]
    fn gemini_models_sort_by_descending_version() {
        let rows = vec![
            Row("gemini-2.0-flash", "Gemini 2.0 Flash"),
            Row("gemini-3.7-flash", "Gemini 3.7 Flash"),
            Row("gemini-2.5-flash", "Gemini 2.5 Flash"),
            Row("gemini-3.1-pro", "Gemini 3.1 Pro"),
        ];

        assert_eq!(
            sorted(rows),
            vec![
                "gemini-3.7-flash",
                "gemini-3.1-pro",
                "gemini-2.5-flash",
                "gemini-2.0-flash",
            ]
        );
    }

    /// V1 `ModelCatalogSorterTests.Sort_MixedVersionDelimiters_HandlesHyphensAndDotsCorrectly`.
    #[test]
    fn hyphenated_and_dotted_versions_compare_the_same() {
        let rows = vec![
            Row("claude-3-5-sonnet", "Claude Sonnet 3.5"),
            Row("claude-3.7-sonnet", "Claude Sonnet 3.7"),
            Row("claude-sonnet-4-6", "Claude Sonnet 4.6"),
            Row("claude-opus-4.7", "Claude Opus 4.7"),
            Row("claude-opus-4-8", "Claude Opus 4.8"),
        ];

        assert_eq!(
            sorted(rows),
            vec![
                "claude-opus-4-8",
                "claude-opus-4.7",
                "claude-sonnet-4-6",
                "claude-3.7-sonnet",
                "claude-3-5-sonnet",
            ]
        );
    }

    /// V1 `ModelCatalogSorterTests.Sort_AstraModel_ResolvesProviderAndSortsAtTop`: `gpt-6-astra`
    /// carries no provider, so the id alone has to place it with OpenAI.
    #[test]
    fn astra_is_recognised_as_openai_from_its_id_alone() {
        let rows = vec![
            Row("gpt-5.6-sol", "GPT-5.6-Sol"),
            Row("gpt-6-astra", "GPT-6 Astra"),
        ];
        assert_eq!(sorted(rows), vec!["gpt-6-astra", "gpt-5.6-sol"]);
    }

    #[test]
    fn providers_are_grouped_by_first_appearance() {
        let rows = vec![
            Row("gpt-5.5", "GPT-5.5"),
            Row("claude-opus-5", "Claude Opus 5"),
            Row("gemini-3.7-flash", "Gemini 3.7 Flash"),
            Row("gpt-4.1", "GPT-4.1"),
        ];
        // OpenAI appeared first even though Anthropic outranks it inside a group.
        assert_eq!(
            sorted(rows),
            vec!["gpt-5.5", "gpt-4.1", "claude-opus-5", "gemini-3.7-flash"]
        );
    }

    #[test]
    fn a_named_group_order_overrides_first_appearance() {
        let mut rows = vec![
            Row("gpt-5.5", "GPT-5.5"),
            Row("claude-opus-5", "Claude Opus 5"),
            Row("kimi-k3", "Kimi K3"),
        ];
        sort_models(
            &mut rows,
            &[ProviderGroup::Moonshot, ProviderGroup::Anthropic],
            false,
        );
        assert_eq!(
            rows.iter().map(|row| row.0).collect::<Vec<_>>(),
            vec!["kimi-k3", "claude-opus-5", "gpt-5.5"]
        );
    }

    /// V1 `ModelCatalogSorterTests.Sort_PreserveDefault_KeepsDefaultModelAtTop`, expressed the way
    /// V2 carries a default: a synthetic `default` row rather than an `IsDefault` flag.
    #[test]
    fn preserve_default_pins_the_default_row_first() {
        let mut rows = vec![
            Row("gemini-2.5-flash", "Gemini 2.5 Flash"),
            Row("default", "Default"),
            Row("gemini-3.7-flash", "Gemini 3.7 Flash"),
        ];
        sort_models(&mut rows, &[], true);
        assert_eq!(
            rows.iter().map(|row| row.0).collect::<Vec<_>>(),
            vec!["default", "gemini-3.7-flash", "gemini-2.5-flash"]
        );
    }

    /// V1 puts `default` last in `CompareModels`, i.e. inside its own provider group — grouping by
    /// appearance still runs first, exactly as it does for every other row.
    #[test]
    fn an_unpinned_default_row_compares_last() {
        assert_eq!(
            compare_models(
                &Row("default", "Default"),
                &Row("claude-opus-5", "Claude Opus 5")
            ),
            Ordering::Greater
        );
        assert_eq!(
            compare_models(
                &Row("claude-opus-5", "Claude Opus 5"),
                &Row("default", "Default")
            ),
            Ordering::Less
        );
        let rows = vec![Row("default", "Default"), Row("llama-4", "Llama 4")];
        assert_eq!(sorted(rows), vec!["llama-4", "default"]);
    }

    #[test]
    fn open_weight_families_sort_by_descending_version() {
        let rows = vec![
            Row("deepseek-r1", "DeepSeek R1"),
            Row("deepseek-v4-pro", "DeepSeek V4 Pro"),
            Row("deepseek-v3", "DeepSeek V3"),
            Row("deepseek-chat", "DeepSeek Chat"),
        ];
        assert_eq!(
            sorted(rows),
            vec![
                "deepseek-v4-pro",
                "deepseek-v3",
                "deepseek-r1",
                "deepseek-chat",
            ]
        );
    }

    #[test]
    fn provider_groups_are_read_off_the_id() {
        assert_eq!(ProviderGroup::of("sonnet"), ProviderGroup::Anthropic);
        assert_eq!(ProviderGroup::of("codex-mini"), ProviderGroup::OpenAi);
        assert_eq!(ProviderGroup::of("o3-mini"), ProviderGroup::OpenAi);
        assert_eq!(ProviderGroup::of("gemini-3.7-flash"), ProviderGroup::Google);
        assert_eq!(ProviderGroup::of("kimi-k3"), ProviderGroup::Moonshot);
        assert_eq!(ProviderGroup::of("deepseek-v3"), ProviderGroup::DeepSeek);
        assert_eq!(
            ProviderGroup::of("qwen2.5-coder-32b-instruct"),
            ProviderGroup::Qwen
        );
        assert_eq!(ProviderGroup::of("llama-4"), ProviderGroup::Other);
    }

    #[test]
    fn versions_come_off_ids_the_way_v1_reads_them() {
        assert_eq!(
            anthropic_version("claude-haiku-4-5-20251001", "Claude Haiku 4.5"),
            Version::new(4, 5)
        );
        assert_eq!(
            anthropic_version("claude-fable-5-1", "Claude Fable 5.1"),
            Version::new(5, 1)
        );
        assert_eq!(
            anthropic_version("claude-opus-5", "Claude Opus 5"),
            Version::new(5, 0)
        );
        assert_eq!(
            anthropic_version("claude-3-7-sonnet", "Claude Sonnet 3.7"),
            Version::new(3, 7)
        );
        // A bare alias carries no version at all, which is why it trails its family.
        assert_eq!(anthropic_version("opus", "Claude Opus"), Version::default());
        assert_eq!(
            openai_version("gpt-6-astra", "GPT-6 Astra", Version::default()),
            Version::new(6, 0)
        );
        assert_eq!(
            openai_version("gpt-4o", "GPT-4o", Version::default()),
            Version::new(4, 0)
        );
        assert_eq!(kimi_version("kimi-k3 kimi k3"), Some(Version::new(3, 0)));
        assert_eq!(
            qwen_version("qwen2.5-coder-32b-instruct"),
            Some(Version::new(2, 5))
        );
    }
}
