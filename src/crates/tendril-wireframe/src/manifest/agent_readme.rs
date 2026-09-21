//! Renders the instructions an agent needs to drive this CLI and author wireframes.
//!
//! Ported from V1's `Manifest/AgentReadmeRenderer.cs`.
//!
//! The raw manifest is ~347 KB of JSON, which is useless in a context window. This compresses it to
//! the shape an agent actually reads: the rules that are easy to get wrong, then every public
//! component with its own props on one line each.
//!
//! The three prose sections are V1's bytes, extracted from that file rather than retyped, and kept
//! as `templates/readme/*.md` so editing the guidance is editing markdown.
//!
//! Verified against V1 by diffing the rendered output, not only by assertion: both the full
//! reference and a component detail view are byte-identical to what `AgentReadmeRenderer` produces.
//! The single deviation is newlines. V1 builds these with `AppendLine`, so its output is CRLF on
//! Windows and LF elsewhere; this always emits LF, which matches V1 on macOS and Linux and makes the
//! document reproducible on every platform. PARITY.md has the procedure.

use std::fmt::Write as _;

use crate::assets::VendorManifest;
use crate::manifest::{prop_sources, ComponentInfo, ComponentManifest, TypeInfo};

const CLI: &str = include_str!("../../templates/readme/cli.md");
const RULES: &str = include_str!("../../templates/readme/rules.md");
const STYLING: &str = include_str!("../../templates/readme/styling.md");

pub struct AgentReadmeRenderer<'a> {
    manifest: &'a ComponentManifest,
    vendor: &'a VendorManifest,
}

impl<'a> AgentReadmeRenderer<'a> {
    pub fn new(manifest: &'a ComponentManifest, vendor: &'a VendorManifest) -> Self {
        Self { manifest, vendor }
    }

    pub fn render(&self) -> String {
        let mut out = String::with_capacity(64 * 1024);
        self.header(&mut out);
        out.push_str(CLI);
        out.push_str(RULES);
        out.push_str(STYLING);
        self.shared_props(&mut out);
        self.types(&mut out);
        self.components(&mut out);
        out
    }

    /// Full detail for one component, for `--component Button`.
    pub fn render_component(&self, component: &ComponentInfo) -> String {
        let mut out = String::new();
        let _ = writeln!(out, "# {}\n", component.name);

        let mut line = format!("`{}`", component.category);
        if let Some(ivy) = &component.ivy {
            let _ = write!(line, " · mirrors `{ivy}`");
        }
        if let Some(status) = &component.status {
            let _ = write!(line, " · {status}");
        }
        let _ = writeln!(out, "{line}\n");

        if let Some(description) = &component.description {
            let _ = writeln!(out, "{}\n", flatten(description));
        }

        out.push_str("| prop | type | default | notes |\n| --- | --- | --- | --- |\n");
        for prop in &component.props {
            let type_text = match &prop.values {
                Some(values) if !values.is_empty() => values.join(" \\| "),
                _ => prop.type_name.clone(),
            };

            let mut notes: Vec<String> = Vec::new();
            if prop.required {
                notes.push("**required**".into());
            }
            if let Some(kind) = &prop.kind {
                notes.push(kind.clone());
            }
            if let Some(inherited) = &prop.inherited {
                notes.push(format!("from {inherited}"));
            }
            if let Some(description) = &prop.description {
                notes.push(flatten(description));
            }

            let default = prop
                .default_value
                .as_ref()
                .map(|d| format!("`{d}`"))
                .unwrap_or_default();
            let _ = writeln!(
                out,
                "| `{}` | `{}` | {} | {} |",
                prop.name,
                type_text,
                default,
                notes.join("; ")
            );
        }

        if !component.examples.is_empty() {
            out.push_str("\n```tsx\n");
            for example in &component.examples {
                let _ = writeln!(out, "{example}");
            }
            out.push_str("```\n");
        }

        out
    }

    fn header(&self, out: &mut String) {
        out.push_str("# Building wireframes with `tendril wireframe`\n\n");
        let _ = writeln!(
            out,
            "`tendril-wireframes@{}` is a React component library that draws itself by hand: every \
             border, fill and chart is a rough.js path, so the output reads as a pencil sketch rather \
             than a finished design. Use it to mock up screens that nobody should mistake for a final \
             UI.\n",
            self.manifest.version
        );
        let _ = writeln!(
            out,
            "The CLI bundles React {}, the component library and a Tailwind utility sheet. **There is \
             no `node_modules`, no `npm install` and no network access required**: do not try to add \
             dependencies, and do not write a `package.json`.\n",
            self.vendor.react_version()
        );
    }

    fn shared_props(&self, out: &mut String) {
        out.push_str("## Shared prop sets\n\n");
        out.push_str(
            "Documented once here and omitted from the per-component listings. Components that take \
             them are marked, e.g. `+BaseInputProps`.\n\n",
        );

        for source in prop_sources::SHARED {
            // First occurrence of each name wins, as V1's GroupBy(...).Select(g => g.First()) does.
            let mut seen = std::collections::BTreeMap::new();
            for component in &self.manifest.components {
                for prop in &component.props {
                    if prop.inherited.as_deref() == Some(source) {
                        seen.entry(prop.name.clone()).or_insert(prop);
                    }
                }
            }
            if seen.is_empty() {
                continue;
            }

            let _ = writeln!(
                out,
                "**{source}**{}",
                if source == "WidgetBaseProps" {
                    ": every component accepts these"
                } else {
                    ""
                }
            );
            for prop in seen.values() {
                let note = prop
                    .description
                    .as_ref()
                    .map(|d| format!(": {}", flatten(d)))
                    .unwrap_or_default();
                let _ = writeln!(out, "  - `{}`{note}", prop.signature());
            }
            out.push('\n');
        }

        out.push_str(
            "Every component also takes `className`, `style` and `data-testid`, and most forward the \
             standard React DOM attributes (`onClick`, `aria-*`, ...), which are not listed.\n\n",
        );
    }

    /// Every named type the prop signatures use.
    ///
    /// Enums are one line each and there are dozens of them, so they stay a flat list. Objects and
    /// aliases get their own block: a prop typed `Sizing` or `Option` is meaningless without one, and
    /// leaving them out is what let an agent read `width: Sizing`, assume pixels, and render a box
    /// four times too big.
    fn types(&self, out: &mut String) {
        out.push_str("## Types\n\nReferenced by the prop signatures below.\n\n");

        // BTreeMap iteration is already ordinal order, which is V1's OrderBy with StringComparer.Ordinal.
        let enums: Vec<(&String, &TypeInfo)> = self
            .manifest
            .types
            .iter()
            .filter(|(_, info)| info.kind == "enum" && info.values.is_some())
            .collect();

        if !enums.is_empty() {
            out.push_str("### Enums\n\n");
            for (name, info) in &enums {
                let _ = writeln!(
                    out,
                    "- `{name}` = {}",
                    info.values.as_ref().unwrap().join(" | ")
                );
            }
            out.push('\n');
        }

        let shapes: Vec<(&String, &TypeInfo)> = self
            .manifest
            .types
            .iter()
            .filter(|(_, info)| info.kind != "enum")
            .collect();
        if shapes.is_empty() {
            return;
        }

        out.push_str("### Shapes and aliases\n\n");

        for (name, info) in shapes {
            match info.kind.as_str() {
                "alias" => {
                    // A union written across lines starts with a leading "|" in the source, which is
                    // idiomatic TypeScript and noise on one line.
                    let expansion = info
                        .type_name
                        .as_deref()
                        .unwrap_or("")
                        .trim_start_matches('|')
                        .trim_start();
                    let members = split_union(expansion);

                    // A union of object shapes on one line is technically documented and practically
                    // unreadable: `SketchShape` came out as a single 600-character run, and an agent
                    // gave up on `RoughShape` rather than parse it. One member per line is the same
                    // information, legibly.
                    if members.len() > 2 && expansion.len() > 90 {
                        let _ = writeln!(out, "**`{name}`** is one of:\n");
                        for member in members {
                            let _ = writeln!(out, "  - `{member}`");
                        }
                    } else {
                        let _ = writeln!(out, "**`{name}`** = {expansion}");
                    }
                }
                "map" => {
                    let _ = writeln!(
                        out,
                        "**`{name}`** = {{ [key: {}]: {} }}",
                        info.key_type.as_deref().unwrap_or(""),
                        info.value_type.as_deref().unwrap_or("")
                    );
                }
                _ => {
                    let _ = writeln!(out, "**`{name}`**");
                }
            }

            if let Some(description) = &info.description {
                let _ = writeln!(out, "\n{}", flatten(description));
            }

            if let Some(properties) = &info.properties {
                if !properties.is_empty() {
                    out.push('\n');
                    for property in properties {
                        let optional = if property.required { "" } else { "?" };
                        let note = property
                            .description
                            .as_ref()
                            .map(|d| format!(": {}", flatten(d)))
                            .unwrap_or_default();
                        let _ = writeln!(
                            out,
                            "  - `{}{optional}: {}`{note}",
                            property.name, property.type_name
                        );
                    }
                }
            }

            out.push('\n');
        }
    }

    fn components(&self, out: &mut String) {
        out.push_str("## Components\n\n");

        let public = self.manifest.public_components();
        let _ = writeln!(
            out,
            "{} components. `prop?` means optional; `= X` is the default.\n",
            public.len()
        );

        // Group by category, ordinal order on the key, then on the name inside each group. Both
        // orderings are V1's, and both matter: this document is diffed between releases.
        let mut categories: std::collections::BTreeMap<&str, Vec<&ComponentInfo>> =
            std::collections::BTreeMap::new();
        for component in public {
            categories
                .entry(component.category.as_str())
                .or_default()
                .push(component);
        }

        for (category, mut members) in categories {
            let _ = writeln!(out, "### {category}\n");
            members.sort_by(|a, b| a.name.as_bytes().cmp(b.name.as_bytes()));

            for component in members {
                let description = component
                    .description
                    .as_ref()
                    .map(|d| format!(": {}", flatten(d)))
                    .unwrap_or_default();
                let _ = writeln!(out, "**{}**{description}", component.name);

                let props: Vec<String> = component.own_props().map(|p| p.signature()).collect();
                let bases: Vec<String> = component
                    .shared_bases()
                    .into_iter()
                    .map(|b| format!("+{b}"))
                    .collect();

                if props.is_empty() && bases.is_empty() {
                    out.push_str("  - *(no props of its own)*\n");
                } else {
                    let _ = writeln!(
                        out,
                        "  - {}",
                        props
                            .into_iter()
                            .chain(bases)
                            .collect::<Vec<_>>()
                            .join(" · ")
                    );
                }

                for example in component.examples.iter().take(2) {
                    let _ = writeln!(out, "  - `{example}`");
                }

                out.push('\n');
            }
        }
    }
}

/// Splits a union into its members, ignoring the `|` that appear *inside* a member.
///
/// `{ a: string | number } | { b: number }` is two members, not three. Splitting on the bare
/// separator would cut the first shape in half and produce something that looks like valid syntax
/// but is not, which is worse than not splitting at all.
fn split_union(expansion: &str) -> Vec<String> {
    let mut members = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;

    for (i, c) in expansion.char_indices() {
        match c {
            '{' | '(' | '[' | '<' => depth += 1,
            '}' | ')' | ']' | '>' => depth -= 1,
            '|' if depth == 0 => {
                members.push(expansion[start..i].trim().to_string());
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    members.push(expansion[start..].trim().to_string());
    members.retain(|m| !m.is_empty());
    members
}

/// Collapses the manifest's embedded newlines so a description stays on one line. Em dashes from the
/// library's docs become plain hyphens, since V1's text never carries them.
fn flatten(text: &str) -> String {
    text.split('\n')
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .replace('|', "\\|")
        .replace('\u{2014}', "-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::catalog;

    fn render() -> String {
        let manifest = ComponentManifest::load().unwrap();
        let vendor =
            VendorManifest::parse(catalog::read_text("vendor.manifest.json").unwrap()).unwrap();
        AgentReadmeRenderer::new(&manifest, &vendor).render()
    }

    #[test]
    fn the_whole_reference_renders_from_the_shipped_manifest() {
        let doc = render();
        for heading in [
            "# Building wireframes with `tendril wireframe`",
            "## Commands",
            "## Rules that are easy to get wrong",
            "## Tailwind support",
            "## Shared prop sets",
            "## Types",
            "## Components",
        ] {
            assert!(doc.contains(heading), "missing section: {heading}");
        }
        // V1's `Stays_small_enough_to_hand_to_an_agent` bounds, exactly: the raw manifest is ~347 KB
        // and this is the compression of it.
        assert!(
            (20_000..=80_000).contains(&doc.len()),
            "got {} bytes, V1 requires 20,000..80,000",
            doc.len()
        );
    }

    // ---- V1's own assertions, ported from Ivy.Tendril.Test/Wireframe/WireframeAgentReadmeTests.cs.
    // These are the behaviours V1 considers correct, so they are the real parity check on this
    // renderer rather than expectations invented here.

    #[test]
    fn lists_every_public_component() {
        let doc = render();
        let manifest = ComponentManifest::load().unwrap();
        for component in manifest.public_components() {
            assert!(
                doc.contains(&format!("**{}**", component.name)),
                "missing component: {}",
                component.name
            );
        }
    }

    #[test]
    fn does_not_leak_the_react_dom_attribute_surface() {
        let doc = render();
        for noise in ["aria-labelledby", "aria-valuetext", "onPointerEnterCapture"] {
            assert!(
                !doc.contains(noise),
                "the React DOM surface leaked: {noise}"
            );
        }
    }

    #[test]
    fn covers_the_rules_an_agent_gets_wrong() {
        let doc = render();
        for rule in [
            "SketchProvider",
            "signalWireframeReady",
            "w-[347px]", // the arbitrary-value caveat
            "tendril wireframe screenshot",
            "no `node_modules`",
        ] {
            assert!(doc.contains(rule), "missing guidance: {rule}");
        }
    }

    #[test]
    fn names_the_tendril_command_rather_than_the_standalone_tool() {
        // Every mention of `wireframe <verb>` must be prefixed with `tendril `, or the document
        // teaches an agent to invoke a tool that is not installed.
        let doc = render();
        for line in doc.lines() {
            let mut from = 0;
            while let Some(found) = line[from..].find("wireframe setup") {
                let at = from + found;
                assert!(
                    at >= "tendril ".len() && line[..at].ends_with("tendril "),
                    "unqualified wireframe command: {line}"
                );
                from = at + 1;
            }
        }
    }

    #[test]
    fn contains_no_em_dash() {
        // Tendril text never carries U+2014, and the library's own descriptions sometimes do, which
        // is why `flatten` rewrites them.
        assert!(!render().contains('\u{2014}'));
    }

    #[test]
    fn renders_enum_values_so_pascal_case_props_can_be_copied_exactly() {
        let doc = render();
        assert!(doc.contains("ButtonVariant"));
        assert!(doc.contains("Destructive"));
    }

    #[test]
    fn component_detail_includes_inherited_props_and_examples() {
        let manifest = ComponentManifest::load().unwrap();
        let vendor =
            VendorManifest::parse(catalog::read_text("vendor.manifest.json").unwrap()).unwrap();
        let button = manifest.find("Button").expect("Button is in the manifest");
        let detail = AgentReadmeRenderer::new(&manifest, &vendor).render_component(button);

        assert!(detail.contains("# Button"));
        assert!(detail.contains("variant"));
        // Inherited, and shown in the detail view even though the summary omits it.
        assert!(detail.contains("density"));
        assert!(detail.contains("<Button title=\"Save\""));
    }

    #[test]
    fn the_versions_come_from_the_payload_not_a_literal() {
        let doc = render();
        let vendor =
            VendorManifest::parse(catalog::read_text("vendor.manifest.json").unwrap()).unwrap();
        assert!(doc.contains(&format!(
            "tendril-wireframes@{}",
            ComponentManifest::load().unwrap().version
        )));
        assert!(doc.contains(&format!("React {}", vendor.react_version())));
    }

    #[test]
    fn shared_bases_are_documented_once_and_referenced_thereafter() {
        let doc = render();
        assert!(doc.contains("**WidgetBaseProps**: every component accepts these"));
        // A component that inherits them points at them rather than repeating them.
        assert!(
            doc.contains("+WidgetBaseProps"),
            "components must reference the base"
        );
    }

    #[test]
    fn a_union_of_shapes_splits_on_top_level_separators_only() {
        // The bug this guards: splitting naively cuts the first shape in half and yields something
        // that looks like valid TypeScript and is not.
        let members = split_union("{ a: string | number } | { b: number }");
        assert_eq!(members, ["{ a: string | number }", "{ b: number }"]);

        assert_eq!(split_union("number | string"), ["number", "string"]);
        assert_eq!(split_union("Array<A | B> | C"), ["Array<A | B>", "C"]);
        assert_eq!(split_union(""), Vec::<String>::new());
    }

    #[test]
    fn flatten_makes_a_description_safe_for_a_table_cell() {
        assert_eq!(flatten("one\n  two\n\nthree"), "one two three");
        // A bare pipe would end the markdown cell early.
        assert_eq!(flatten("a | b"), "a \\| b");
        // Em dashes are not used in Tendril text.
        assert_eq!(flatten("a \u{2014} b"), "a - b");
    }

    #[test]
    fn one_component_renders_its_full_prop_table() {
        let manifest = ComponentManifest::load().unwrap();
        let vendor =
            VendorManifest::parse(catalog::read_text("vendor.manifest.json").unwrap()).unwrap();
        let renderer = AgentReadmeRenderer::new(&manifest, &vendor);

        let component = manifest
            .public_components()
            .into_iter()
            .find(|c| !c.props.is_empty())
            .expect("some component has props");
        let doc = renderer.render_component(component);

        assert!(doc.starts_with(&format!("# {}", component.name)));
        assert!(doc.contains("| prop | type | default | notes |"));
        // Unlike the summary, this one lists inherited props too.
        assert_eq!(
            doc.lines().filter(|l| l.starts_with("| `")).count(),
            component.props.len()
        );
    }
}
