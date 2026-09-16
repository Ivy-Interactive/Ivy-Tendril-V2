//! Port of `Services/Share/AnonymousPersonaGenerator.cs`.
//!
//! A share visitor has no account, but a comment with no author is useless, so they get a stable
//! adjective-animal name. The word lists are copied verbatim, in-jokes included: they are what the
//! original's users see, and changing them would rename people's existing comments.
//!
//! **One deliberate deviation.** The original seeds its deterministic branch with
//! `string.GetHashCode()`, which .NET randomises per process — so "deterministic" there means "stable
//! within one run of the app", and a reviewer who reconnects gets a different name. This uses FNV-1a,
//! which is stable forever and across machines, so the same browser really does keep the same persona.

/// Verbatim from the original, in the original's order — the order is what maps a seed to a name.
const ADJECTIVES: [&str; 21] = [
    "Spectating",
    "Browsing",
    "Curious",
    "Observant",
    "Thoughtful",
    "Insightful",
    "Helpful",
    "Diligent",
    "Friendly",
    "Clever",
    "Wise",
    "Nimble",
    "Inquiring",
    "Attentive",
    "Sharp",
    "Prudent",
    "Vigilant",
    "Polite",
    "Calm",
    "Eager",
    "Spooky",
];

/// Verbatim from the original, including the three colleagues at the end.
const ANIMALS: [&str; 23] = [
    "Zebra", "Otter", "Capybara", "Falcon", "Fox", "Panda", "Koala", "Penguin", "Dolphin",
    "Badger", "Beaver", "Hedgehog", "Owl", "Lynx", "Giraffe", "Lemur", "Meerkat", "Platypus",
    "Quokka", "Wombat", "Niels", "Mikael", "Joel",
];

/// A stable persona for `seed`. Port of `Generate(seed)`'s deterministic branch.
pub fn generate(seed: &str) -> String {
    let hash = fnv1a(seed.trim());
    let adjective = ADJECTIVES[(hash % ADJECTIVES.len() as u64) as usize];
    let animal = ANIMALS[((hash / ADJECTIVES.len() as u64) % ANIMALS.len() as u64) as usize];
    format!("{adjective} {animal}")
}

/// Port of `Generate(null)`: a random persona, for a visitor with nothing stable to key off.
pub fn generate_random() -> String {
    generate(&crate::config::generate_bearer_secret())
}

/// A persona for a visitor, preferring an explicitly supplied name, then a stable seed, then chance.
/// Port of the `ShareContext.Persona` waterfall, with the HTTP-specific sources (cookie, query, machine
/// id, connection id, remote address) resolved by the caller and handed in already in priority order.
pub fn resolve(explicit: Option<&str>, seeds: &[Option<&str>]) -> String {
    if let Some(name) = explicit.map(str::trim).filter(|name| !name.is_empty()) {
        return name.to_string();
    }
    for seed in seeds {
        if let Some(seed) = seed.map(str::trim).filter(|seed| !seed.is_empty()) {
            return generate(seed);
        }
    }
    generate_random()
}

/// Port of `GetInitials`. Used for the avatar beside a share visitor's comments.
pub fn initials(name: Option<&str>) -> String {
    let Some(name) = name.map(str::trim).filter(|name| !name.is_empty()) else {
        return "?".to_string();
    };
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.as_slice() {
        [] => "?".to_string(),
        [single] => single
            .chars()
            .take(2)
            .flat_map(char::to_uppercase)
            .collect(),
        [first, .., last] => {
            let mut out = String::new();
            out.extend(
                first
                    .chars()
                    .next()
                    .into_iter()
                    .flat_map(char::to_uppercase),
            );
            out.extend(last.chars().next().into_iter().flat_map(char::to_uppercase));
            out
        }
    }
}

/// FNV-1a, 64-bit. Chosen over `sha2` (also available) because a name generator does not need a
/// cryptographic hash and this one is trivially reproducible in the frontend if it ever has to be.
fn fnv1a(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_persona_is_two_words_from_the_original_lists() {
        let persona = generate("machine-abc");
        let (adjective, animal) = persona.split_once(' ').expect("two words");
        assert!(ADJECTIVES.contains(&adjective), "{adjective}");
        assert!(ANIMALS.contains(&animal), "{animal}");
    }

    /// The whole point of the deterministic branch: a reviewer keeps their name across reconnects.
    #[test]
    fn the_same_seed_always_gives_the_same_persona() {
        assert_eq!(generate("machine-abc"), generate("machine-abc"));
        assert_eq!(generate(" machine-abc "), generate("machine-abc"));
        assert_ne!(generate("machine-abc"), generate("machine-abd"));
    }

    /// A generator that collapses onto one name would attribute every visitor's comments to the same
    /// person, so the spread is asserted rather than assumed.
    #[test]
    fn different_seeds_spread_over_the_lists() {
        let personas: std::collections::HashSet<String> =
            (0..200).map(|i| generate(&format!("seed-{i}"))).collect();
        assert!(
            personas.len() > 100,
            "only {} distinct personas from 200 seeds",
            personas.len()
        );
    }

    #[test]
    fn an_explicit_name_wins_over_every_seed() {
        assert_eq!(
            resolve(Some("  Reviewer Rita "), &[Some("machine-abc")]),
            "Reviewer Rita"
        );
        assert_eq!(
            resolve(Some("   "), &[Some("machine-abc")]),
            generate("machine-abc"),
            "a blank name is not a name"
        );
    }

    #[test]
    fn seeds_are_tried_in_order_and_blanks_are_skipped() {
        assert_eq!(
            resolve(None, &[None, Some(""), Some("second"), Some("third")]),
            generate("second")
        );
    }

    #[test]
    fn with_nothing_to_go_on_a_persona_is_still_produced() {
        let persona = resolve(None, &[]);
        assert!(persona.contains(' '), "{persona}");
    }

    #[test]
    fn initials_match_the_originals_rules() {
        assert_eq!(initials(Some("Curious Otter")), "CO");
        assert_eq!(initials(Some("Otter")), "OT");
        assert_eq!(initials(Some("o")), "O");
        assert_eq!(initials(Some("Spectating Capybara Extra")), "SE");
        assert_eq!(initials(None), "?");
        assert_eq!(initials(Some("   ")), "?");
    }
}
