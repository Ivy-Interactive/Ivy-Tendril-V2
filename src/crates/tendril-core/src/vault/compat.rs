//! Lenient timestamp handling for vault YAML written by the C# app.
//!
//! YamlDotNet serializes `DateTimeOffset` as a 22-key map (`dateTime`, `utcDateTime`,
//! `localDateTime`, `day`, `dayOfWeek`, ...), so a plain `Option<DateTime<Utc>>` field cannot read
//! the live `~/.tendril/Vaults/*/vault.yaml` or the `vault:`/`vaults:` blocks in `config.yaml`.
//! These helpers accept either an RFC3339 string or that map, and always serialize back as RFC3339
//! (which YamlDotNet parses into `DateTimeOffset` again).

use chrono::{DateTime, Datelike, TimeZone, Utc};
use serde::de::{MapAccess, Visitor};
use serde::{Deserializer, Serializer};
use std::fmt;

/// The C# `default(DateTimeOffset)` sentinel (`0001-01-01`) means "never" and maps to `None`.
fn nullify_sentinel(value: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if value.year() <= 1 {
        None
    } else {
        Some(value)
    }
}

fn parse_timestamp(raw: &str) -> Option<DateTime<Utc>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(parsed) = DateTime::parse_from_rfc3339(trimmed) {
        return nullify_sentinel(parsed.with_timezone(&Utc));
    }

    // C# writes `dateTime` without an offset (e.g. `2026-09-14T08:13:34.1084350`); treat it as UTC.
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(trimmed, format) {
            return nullify_sentinel(Utc.from_utc_datetime(&naive));
        }
    }

    None
}

struct LenientTimestampVisitor;

impl<'de> Visitor<'de> for LenientTimestampVisitor {
    type Value = Option<DateTime<Utc>>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an RFC3339 timestamp string or a C# DateTimeOffset map")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(parse_timestamp(value))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(parse_timestamp(&value))
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(None)
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        Ok(None)
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(LenientTimestampVisitor)
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        // Prefer `utcDateTime`, fall back to `dateTime`; ignore the other 20 keys.
        let mut utc_date_time: Option<String> = None;
        let mut date_time: Option<String> = None;

        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "utcDateTime" => utc_date_time = map.next_value::<Option<String>>()?,
                "dateTime" => date_time = map.next_value::<Option<String>>()?,
                _ => {
                    let _ = map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
        }

        Ok(utc_date_time
            .as_deref()
            .and_then(parse_timestamp)
            .or_else(|| date_time.as_deref().and_then(parse_timestamp)))
    }
}

/// `deserialize_with` for `Option<DateTime<Utc>>` fields that may arrive as a string or a C# map.
pub fn deserialize_optional_timestamp<'de, D>(
    deserializer: D,
) -> Result<Option<DateTime<Utc>>, D::Error>
where
    D: Deserializer<'de>,
{
    deserializer.deserialize_any(LenientTimestampVisitor)
}

/// `deserialize_with` for required timestamps; a missing or sentinel value becomes the Unix epoch's
/// C# equivalent of "unset", represented here as `Utc::now()`-free `DateTime::UNIX_EPOCH`.
pub fn deserialize_timestamp<'de, D>(deserializer: D) -> Result<DateTime<Utc>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(deserialize_optional_timestamp(deserializer)?.unwrap_or_else(default_timestamp))
}

pub fn default_timestamp() -> DateTime<Utc> {
    DateTime::UNIX_EPOCH
}

/// Always emit RFC3339 with a `Z` suffix so the C# app can read it back as a `DateTimeOffset`.
pub fn serialize_optional_timestamp<S>(
    value: &Option<DateTime<Utc>>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(ts) => serializer.serialize_str(&format_timestamp(ts)),
        None => serializer.serialize_none(),
    }
}

pub fn serialize_timestamp<S>(value: &DateTime<Utc>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.serialize_str(&format_timestamp(value))
}

pub fn format_timestamp(value: &DateTime<Utc>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
