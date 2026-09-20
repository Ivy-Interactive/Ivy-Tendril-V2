//! Scripts injected before first paint so repeated screenshots of the same wireframe match.
//!
//! Ported from V1's `Screenshot/DeterminismPayload.cs`. The script bodies are V1's bytes, extracted
//! rather than retyped, and live as `templates/screenshot/*.js`.
//!
//! Note what is *not* here: rough.js seeds. `SketchProvider` already defaults to
//! `deterministic: true` and `seedFrom(undefined)` folds to a constant, so the geometry is stable on
//! its own. Overriding `SketchProvider` from the screenshot path would actually make things worse --
//! the PNG would stop matching what `serve` shows.

/// Freezes animation.
///
/// `tendril.css` defines 14 `@keyframes` with no `prefers-reduced-motion` guard, so media emulation
/// alone does nothing to them.
///
/// The critical detail is `animation-fill-mode: forwards` with a near-zero duration rather than
/// `animation: none`. `none` leaves elements at their *initial* keyframe -- and `tendril-fade-in`
/// starts at `opacity: 0`, so it would produce a blank screenshot of a page that looks perfectly
/// fine in the browser. Snapping to the final keyframe is what a settled page actually looks like.
pub const FREEZE_ANIMATION: &str = include_str!("../../templates/screenshot/freeze-animation.js");

/// Polls the readiness contract from `src/wireframe-ready.ts`.
///
/// The fallback matters: a hand-written project may not call `signalWireframeReady()`. Counting SVG
/// paths is a sound proxy because `SketchFrame` returns null at zero measured size -- so "no paths"
/// provably means measurement has not happened yet.
pub const READINESS_PROBE: &str = include_str!("../../templates/screenshot/readiness-probe.js");

/// Forces one more paint before capture.
pub const SETTLE_PAINT: &str =
    "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn animation_is_snapped_forward_not_switched_off() {
        // `animation: none` would leave tendril-fade-in at its initial opacity:0 keyframe and
        // capture a blank page that looks fine in a browser. This is the bug the whole approach
        // exists to avoid, so assert the mechanism rather than the effect.
        assert!(FREEZE_ANIMATION.contains("animation-fill-mode: forwards"));
        assert!(!FREEZE_ANIMATION.contains("animation: none"));
        assert!(FREEZE_ANIMATION.contains("animation-duration: 0.0001s"));
        // A focused TextInput's caret is a one-pixel-column diff between otherwise equal runs.
        assert!(FREEZE_ANIMATION.contains("caret-color: transparent"));
    }

    #[test]
    fn the_style_is_attached_even_when_head_does_not_exist_yet() {
        // It runs before first paint, which can be before <head> is parsed.
        assert!(FREEZE_ANIMATION.contains("DOMContentLoaded"));
        assert!(FREEZE_ANIMATION.contains("documentElement"));
    }

    #[test]
    fn readiness_prefers_the_hook_and_falls_back_to_a_sound_proxy() {
        assert!(READINESS_PROBE.contains("window.__wireframe"));
        assert!(READINESS_PROBE.contains("version === 1"));
        // The fallback: paths > 0 proves measurement happened, and a stable signature across two
        // polls proves it has settled.
        assert!(READINESS_PROBE.contains("svg path"));
        assert!(READINESS_PROBE.contains("__wfProbeSignature"));
        assert!(READINESS_PROBE.contains("document.fonts.status"));
    }

    #[test]
    fn settle_paint_waits_two_frames() {
        // One frame is not enough: the first only schedules the paint that the second observes.
        assert_eq!(SETTLE_PAINT.matches("requestAnimationFrame").count(), 2);
    }
}
