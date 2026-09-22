import { TuiKbd } from "@ivy-interactive/components/ui";
import { getTranslations } from "../config/translations";
import { navigate } from "../lib/router";
import { splitLocale } from "../lib/slug";

interface NotFoundProps {
  route: string;
  /** Where "Go to the introduction" sends the reader — the first page of the first section. */
  homeRoute: string;
  locale?: string;
}

export function NotFound({ route, homeRoute, locale }: NotFoundProps) {
  const activeLocale = locale ?? splitLocale(route).locale;
  const t = getTranslations(activeLocale);

  return (
    <div className="docs-article">
      <h1 className="mb-3 text-4xl font-semibold">{t.pageNotFound}</h1>
      <p className="mb-6 text-lg leading-relaxed text-muted-foreground">
        {t.pageNotFoundDescription}{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono">{route}</code>.
      </p>
      <p className="text-base leading-relaxed">
        {t.pageNotFoundUseSidebar}{" "}
        <TuiKbd keys="⌘K" variant="outline" />{" "}
        {t.pageNotFoundToSearch}{" "}
        <a
          href={homeRoute}
          onClick={(event) => {
            event.preventDefault();
            navigate(homeRoute);
          }}
          className="text-primary underline underline-offset-[3px]"
        >
          {t.startFromIntroduction}
        </a>
        .
      </p>
    </div>
  );
}
