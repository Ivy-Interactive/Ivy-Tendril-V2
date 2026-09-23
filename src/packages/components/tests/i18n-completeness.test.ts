import { describe, expect, it } from "vite-plus/test";
import { catalogSetFromFiles, findUntranslatedKeys } from "../src/i18n/catalogCheck";

/**
 * Completeness: every English key, translated in every locale. This fails until the translation
 * phase is finished, so it only runs when `I18N_REQUIRE_COMPLETE=1` - CI turns that on once every
 * locale is done, and from then on an English key added without its translations fails the build.
 * Until then it is reported as skipped. To see what is left:
 *
 *     I18N_REQUIRE_COMPLETE=1 pnpm --filter @ivy-interactive/components test i18n-completeness
 *
 * `i18n-catalogs.test.ts` is the always-on half: whatever a catalog does contain must be right.
 */

describe("catalog completeness", () => {
  it.runIf(process.env.I18N_REQUIRE_COMPLETE === "1")(
    "has every English key translated in every locale",
    () => {
      const catalogs = catalogSetFromFiles(
        import.meta.glob("../src/i18n/locales/*/*.json", { eager: true, import: "default" }),
      );
      expect(findUntranslatedKeys(catalogs)).toEqual({});
    },
  );
});
