import { parse } from "yaml";
import { i18n, type TFunction } from "@/i18n/uiPlanWorkspace";

/**
 * The `wireframe` fence: a live preview of one of the plan's wireframes.
 *
 * ```wireframe
 * name: checkout-payment        # required, the folder under the plan's Wireframes/
 * height: 640                   # optional px; default is the page's own height
 * viewport: Mobile              # optional: Desktop | Tablet | Mobile; default is the column's width
 *
 * A wireframe renders at the column's width and zooms out only when it needs more width than that
 * (overflowing content, or a named viewport wider than the column). Height is never zoomed: the
 * frame is as tall as the page up to a cap, and a longer page scrolls inside it.
 * ```
 *
 * A body that is just a slug is shorthand for `name:`. The rules here are mirrored by
 * `wireframes::fence` on the server, which `write-revision` runs to reject a revision that breaks
 * them; keep the two in step.
 *
 * One rule differs on purpose: see `caption` below.
 */

export type WireframeViewport = "Desktop" | "Tablet" | "Mobile";

export interface WireframeSpec {
  name: string;
  height?: number;
  viewport?: WireframeViewport;
}

export type WireframeParse = { ok: true; spec: WireframeSpec } | { ok: false; error: string };

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// `caption` is accepted and ignored: plans written while wireframes had captions still render,
// rather than showing the reviewer an error about a plan nobody is going to edit. The server is
// deliberately stricter -- `write-revision` refuses a *new* revision carrying one -- so the set of
// plans with a caption can only shrink. Tolerant on read, strict on write.
const KEYS = new Set(["name", "caption", "height", "viewport"]);

/** The CSS width each viewport renders at before it is scaled down to fit the column. */
export const VIEWPORT_WIDTHS: Record<WireframeViewport, number> = {
  Desktop: 1440,
  Tablet: 768,
  Mobile: 390,
};

export const MAX_HEIGHT = 4000;

/** The current language's `t`, for a caller that has none of its own to pass. */
const currentT: TFunction = i18n.getFixedT(null, "uiPlanWorkspace");

/**
 * The grammar's own words - the keys and the viewport names - which a message quotes but a
 * translation must never change: they are what the fence has to say, in any language.
 */
const KEYWORDS = {
  name: "name",
  height: "height",
  viewport: "viewport",
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
} as const;

/**
 * Parses a fence body. The error, when there is one, is a sentence for the reviewer, written in the
 * language of `t` - the caller's, so a component re-parses when the language changes.
 */
export function parseWireframeFence(source: string, t: TFunction = currentT): WireframeParse {
  const text = source.trim();
  if (text.length === 0)
    return {
      ok: false,
      error: t("wireframe.errors.empty", { example: "name: checkout-payment" }),
    };
  if (NAME.test(text)) return { ok: true, spec: { name: text } };

  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return { ok: false, error: t("wireframe.errors.notYaml") };
  }

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      ok: false,
      error: t("wireframe.errors.notMapping", { ...KEYWORDS, example: "name: <wireframe>" }),
    };
  }

  const record = doc as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KEYS.has(key))
      return { ok: false, error: t("wireframe.errors.unknownKey", { ...KEYWORDS, key }) };
  }

  const { name, height, viewport } = record;

  if (typeof name !== "string" || !NAME.test(name)) {
    return {
      ok: false,
      error: t("wireframe.errors.badName", { ...KEYWORDS, example: "checkout-payment" }),
    };
  }

  const spec: WireframeSpec = { name };

  if (height !== undefined && height !== null) {
    if (
      typeof height !== "number" ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > MAX_HEIGHT
    ) {
      return {
        ok: false,
        error: t("wireframe.errors.badHeight", { ...KEYWORDS, max: MAX_HEIGHT }),
      };
    }
    spec.height = height;
  }

  if (viewport !== undefined && viewport !== null) {
    if (typeof viewport !== "string" || !(viewport in VIEWPORT_WIDTHS)) {
      return { ok: false, error: t("wireframe.errors.badViewport", KEYWORDS) };
    }
    spec.viewport = viewport as WireframeViewport;
  }

  return { ok: true, spec };
}
