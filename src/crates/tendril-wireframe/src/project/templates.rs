//! The files `wireframe setup` writes into a new project.
//!
//! Ported from V1's `Project/ScaffoldTemplates.cs`. The bodies are the identical bytes, extracted
//! from that file rather than retyped, and live beside this module as `templates/*.template` so a
//! future update is a diff of the text rather than of escaped string literals.
//!
//! The whole app lives under `src/` -- index.html, the entry point, the components and any static
//! assets. The project root holds only configuration, generated output and docs.
//!
//! These are the first thing an agent reads, so they double as documentation.

/// Stamped at the top of every file `setup` writes. Wireframes are throwaway plan material, and
/// Tendril's leak guard refuses a plan's changes when this marker turns up in a product repo: a
/// copied file carries it along.
pub const PLAN_ONLY_MARKER: &str = "@tendril-wireframe plan-only";

/// `{{TITLE}}` is replaced with the project name.
pub const INDEX_HTML: &str = include_str!("../../templates/index.html.template");

pub const MAIN_TSX: &str = include_str!("../../templates/main.tsx.template");

/// Deliberately blank. A starter wireframe here would be the first thing an agent has to delete, and
/// the first thing it copies the style of by accident -- so `setup` leaves an empty page and the
/// conventions live in `wireframe agent-readme`.
pub const APP_TSX: &str = include_str!("../../templates/App.tsx.template");

/// The screenshot readiness contract. The ordering inside it is load-bearing: every border and fill
/// is an SVG path rough.js generates after a ResizeObserver measures the element, so "wait for load"
/// captures a half-drawn wireframe.
pub const WIREFRAME_READY_TS: &str = include_str!("../../templates/wireframe-ready.ts.template");

pub const TSCONFIG: &str = include_str!("../../templates/tsconfig.json.template");

/// `{{PATHS}}` is replaced with the generated `compilerOptions.paths` entries.
pub const TSCONFIG_BASE: &str = include_str!("../../templates/tsconfig.base.json.template");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_scaffolded_source_file_carries_the_plan_only_marker() {
        // The leak guard keys off this string, so a template that loses it would let a copied
        // wireframe file into a product repo unnoticed.
        for (name, body) in [
            ("index.html", INDEX_HTML),
            ("main.tsx", MAIN_TSX),
            ("App.tsx", APP_TSX),
            ("wireframe-ready.ts", WIREFRAME_READY_TS),
        ] {
            assert!(
                body.contains(PLAN_ONLY_MARKER),
                "{name} lost the plan-only marker"
            );
        }
    }

    #[test]
    fn placeholders_are_present_for_the_two_templates_that_take_one() {
        assert!(INDEX_HTML.contains("{{TITLE}}"));
        assert!(TSCONFIG_BASE.contains("{{PATHS}}"));
        // And absent everywhere else, so nothing ships an unsubstituted placeholder.
        for body in [MAIN_TSX, APP_TSX, WIREFRAME_READY_TS, TSCONFIG] {
            assert!(!body.contains("{{"), "unexpected placeholder in {body:.40}");
        }
    }

    #[test]
    fn main_tsx_wires_the_two_things_a_wireframe_cannot_render_without() {
        // SketchProvider mounts the shared SVG filters and sets the pencil; the `tendril` class
        // applies the handwriting font and ink colour. Without either, components render but not as
        // a hand-drawn wireframe.
        assert!(MAIN_TSX.contains("SketchProvider"));
        assert!(MAIN_TSX.contains("\"tendril\""));
        // And it signals readiness, which is what `screenshot` waits on.
        assert!(MAIN_TSX.contains("signalWireframeReady"));
    }
}
