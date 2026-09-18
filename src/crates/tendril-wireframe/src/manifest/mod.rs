//! The component/prop manifest that `tendril-wireframes` generates from its own TypeScript types.
//!
//! Ported from V1's `Manifest/{ComponentManifest,FlexibleString*}.cs`. Because it comes from the
//! compiler rather than hand-written docs, the props here cannot drift from the components.

pub mod agent_readme;

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::{Deserialize, Deserializer, Serialize};

use crate::assets::catalog;

/// A manifest scalar rendered as text.
///
/// V1 wraps this in a `FlexibleString` struct with a custom converter, for one reason: the
/// manifest's enum members are usually strings but sometimes numbers (`WeekDay` is 0..6). Here that
/// is a deserializer on the field instead, which needs no wrapper type.
fn flexible_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(match value {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(s),
        Some(other) => Some(other.to_string()),
    })
}

fn flexible_string_list<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Vec<serde_json::Value>>::deserialize(deserializer)?;
    Ok(value.map(|items| {
        items
            .into_iter()
            .map(|item| match item {
                serde_json::Value::String(s) => s,
                other => other.to_string(),
            })
            .collect()
    }))
}

/// One entry in the manifest's type dictionary.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TypeInfo {
    /// `"enum"`, `"object"`, `"map"` or `"alias"`: which of the fields below apply.
    #[serde(default)]
    pub kind: String,

    #[serde(default)]
    pub description: Option<String>,

    /// enum: the members, in the order they were declared.
    #[serde(default, deserialize_with = "flexible_string_list")]
    pub values: Option<Vec<String>>,

    /// object: the properties.
    #[serde(default)]
    pub properties: Option<Vec<TypeProperty>>,

    /// map: an index signature, e.g. `{ [key: string]: string | number }`.
    #[serde(default, rename = "keyType")]
    pub key_type: Option<String>,
    #[serde(default, rename = "valueType")]
    pub value_type: Option<String>,

    /// alias: what it expands to, e.g. `"number | string"`.
    #[serde(default, rename = "type")]
    pub type_name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TypeProperty {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub type_name: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComponentManifest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default, rename = "componentCount")]
    pub component_count: usize,
    #[serde(default)]
    pub categories: BTreeMap<String, usize>,

    /// Every named type the props refer to, described once: enums by their members, objects by their
    /// properties, aliases by what they expand to.
    ///
    /// This used to be unions alone, which meant a prop typed `Sizing` or `Option` named something
    /// the reference never defined -- and an agent that guessed `width={150}` meant pixels got a
    /// 600px box, silently.
    #[serde(default)]
    pub types: BTreeMap<String, TypeInfo>,

    #[serde(default)]
    pub components: Vec<ComponentInfo>,
}

impl ComponentManifest {
    pub fn parse(json: &str) -> Result<Self> {
        serde_json::from_str(json).context("tendril.manifest.json could not be parsed.")
    }

    pub fn load() -> Result<Self> {
        Self::parse(catalog::read_text("tendril.manifest.json")?)
    }

    /// The components an agent should actually use: the manifest also carries internal building
    /// blocks (SketchLayer, InputShell, ...) that are not part of the public surface.
    pub fn public_components(&self) -> Vec<&ComponentInfo> {
        let mut out: Vec<&ComponentInfo> = self.components.iter().filter(|c| !c.internal).collect();
        // Ordinal ordering, as V1 does: byte order, not locale order, so the reference is identical
        // whatever the machine's culture is.
        out.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));
        out
    }

    pub fn find(&self, name: &str) -> Option<&ComponentInfo> {
        self.components
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(name))
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComponentInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub description: Option<String>,

    /// The Ivy Framework widget this mirrors, when there is one.
    #[serde(default)]
    pub ivy: Option<String>,

    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub examples: Vec<String>,
    #[serde(default, rename = "internal")]
    pub internal: bool,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub props: Vec<PropInfo>,
}

impl ComponentInfo {
    /// Props declared on this component, excluding the shared bases (documented once rather than
    /// repeated 98 times) and the inherited React DOM surface.
    pub fn own_props(&self) -> impl Iterator<Item = &PropInfo> {
        self.props
            .iter()
            .filter(|p| prop_sources::is_own(p.inherited.as_deref()))
    }

    /// Shared bases this component pulls in, so its entry can point at them.
    pub fn shared_bases(&self) -> Vec<&str> {
        let mut out: Vec<&str> = self
            .props
            .iter()
            .filter_map(|p| p.inherited.as_deref())
            .filter(|i| prop_sources::is_shared(Some(i)))
            .collect();
        out.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        out.dedup();
        out
    }
}

/// Classifies where a prop came from.
///
/// The manifest records inheritance from React's own interfaces too, so a component that spreads
/// HTML attributes reports several hundred `aria-*`, `on*` and SVG props. Those are standard React
/// and would swamp the reference, so they are dropped rather than documented.
pub mod prop_sources {
    /// The library's own shared bases -- worth documenting, once.
    pub const SHARED: [&str; 4] = [
        "WidgetBaseProps",
        "BaseInputProps",
        "BaseChartProps",
        "CartesianChartProps",
    ];

    const NOISE: [&str; 6] = [
        "DOMAttributes",
        "SVGAttributes",
        "AriaAttributes",
        "AllHTMLAttributes",
        "HTMLAttributes",
        "LucideProps",
    ];

    pub fn is_shared(inherited: Option<&str>) -> bool {
        inherited.is_some_and(|i| SHARED.contains(&i))
    }

    pub fn is_noise(inherited: Option<&str>) -> bool {
        inherited.is_some_and(|i| NOISE.contains(&i))
    }

    /// True for props that belong in the component's own one-line signature.
    pub fn is_own(inherited: Option<&str>) -> bool {
        match inherited {
            None => true,
            Some(_) => !is_shared(inherited) && !is_noise(inherited),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PropInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub type_name: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, rename = "default", deserialize_with = "flexible_string")]
    pub default_value: Option<String>,
    #[serde(default)]
    pub description: Option<String>,

    /// `"event"` or `"slot"` where the generator could tell.
    #[serde(default)]
    pub kind: Option<String>,

    /// Set when the prop comes from a shared base interface.
    #[serde(default)]
    pub inherited: Option<String>,

    #[serde(default, deserialize_with = "flexible_string_list")]
    pub values: Option<Vec<String>>,
}

impl PropInfo {
    /// Compact `name?: Type = default` rendering.
    pub fn signature(&self) -> String {
        let type_text = match &self.values {
            Some(values) if !values.is_empty() && values.len() <= 8 => values.join("|"),
            _ => self.type_name.clone(),
        };

        let mut text = format!(
            "{}{}: {}",
            self.name,
            if self.required { "" } else { "?" },
            type_text
        );
        if let Some(default) = &self.default_value {
            text.push_str(&format!(" = {default}"));
        }
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_manifest_parses() {
        let manifest = ComponentManifest::load().unwrap();
        assert!(
            manifest.components.len() > 90,
            "got {}",
            manifest.components.len()
        );
        // The pipeline reported 99 public of 106 total when it regenerated the payload.
        let public = manifest.public_components();
        assert!(public.len() >= 90, "got {}", public.len());
        assert!(
            public.len() < manifest.components.len(),
            "internal building blocks must be filtered out"
        );
        assert!(!manifest.types.is_empty(), "named types must be described");
    }

    #[test]
    fn enum_members_survive_being_numbers() {
        // WeekDay is 0..6 in the real manifest, which is why V1 needs FlexibleString at all. A
        // strict String deserializer would fail the whole manifest on it.
        let manifest = ComponentManifest::parse(
            r#"{ "types": { "WeekDay": { "kind": "enum", "values": [0, 1, 2] },
                            "Variant": { "kind": "enum", "values": ["a", "b"] } } }"#,
        )
        .unwrap();
        assert_eq!(
            manifest.types["WeekDay"].values.as_deref(),
            Some(["0".to_string(), "1".to_string(), "2".to_string()].as_slice())
        );
        assert_eq!(
            manifest.types["Variant"].values.as_deref(),
            Some(["a".to_string(), "b".to_string()].as_slice())
        );
    }

    #[test]
    fn a_numeric_default_survives_too() {
        let component: ComponentInfo = serde_json::from_str(
            r#"{ "name": "Box", "props": [ { "name": "width", "type": "number", "default": 150 },
                                           { "name": "label", "type": "string", "default": "hi" } ] }"#,
        )
        .unwrap();
        assert_eq!(component.props[0].default_value.as_deref(), Some("150"));
        assert_eq!(component.props[1].default_value.as_deref(), Some("hi"));
    }

    #[test]
    fn react_dom_noise_is_dropped_but_shared_bases_are_remembered() {
        let component: ComponentInfo = serde_json::from_str(
            r#"{ "name": "Button", "props": [
                 { "name": "onClick", "type": "() => void", "inherited": "DOMAttributes" },
                 { "name": "aria-label", "type": "string", "inherited": "AriaAttributes" },
                 { "name": "width", "type": "Sizing", "inherited": "WidgetBaseProps" },
                 { "name": "variant", "type": "Variant" } ] }"#,
        )
        .unwrap();

        let own: Vec<&str> = component.own_props().map(|p| p.name.as_str()).collect();
        assert_eq!(own, ["variant"], "only the component's own prop is its own");
        assert_eq!(
            component.shared_bases(),
            ["WidgetBaseProps"],
            "the shared base is pointed at rather than inlined"
        );
    }

    #[test]
    fn signatures_inline_short_unions_and_fall_back_for_long_ones() {
        let short = PropInfo {
            name: "variant".into(),
            type_name: "Variant".into(),
            values: Some(vec!["primary".into(), "ghost".into()]),
            ..Default::default()
        };
        assert_eq!(short.signature(), "variant?: primary|ghost");

        let long = PropInfo {
            name: "icon".into(),
            type_name: "IconName".into(),
            values: Some((0..9).map(|i| format!("i{i}")).collect()),
            ..Default::default()
        };
        assert_eq!(
            long.signature(),
            "icon?: IconName",
            "more than eight members would swamp the line, so the type name is used"
        );

        let required = PropInfo {
            name: "label".into(),
            type_name: "string".into(),
            required: true,
            default_value: Some("\"OK\"".into()),
            ..Default::default()
        };
        assert_eq!(required.signature(), "label: string = \"OK\"");
    }

    #[test]
    fn lookup_is_case_insensitive_like_v1() {
        let manifest =
            ComponentManifest::parse(r#"{ "components": [ { "name": "Button" } ] }"#).unwrap();
        assert!(manifest.find("button").is_some());
        assert!(manifest.find("BUTTON").is_some());
        assert!(manifest.find("Buttons").is_none());
    }
}
