import { Check, Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ivy-interactive/components/ui";
import {
  SITE_LOCALES,
  type SiteLocale,
  getLocale,
  localizePath,
  splitLocale,
} from "../config/locales.config";
import { getTranslations } from "../config/translations";
import { cn } from "../lib/cn";
import { navigate, toAppHref, useLocation } from "../lib/router";

export interface LanguageSwitcherProps {
  className?: string;
  route?: string;
  hash?: string;
  onSelect?: (targetUrl: string, targetLocale: SiteLocale) => void;
}

export function LanguageSwitcher({
  className,
  route: routeProp,
  hash: hashProp,
  onSelect,
}: LanguageSwitcherProps) {
  const location = useLocation();
  const currentRoute = routeProp ?? location.route;
  const currentHash = hashProp ?? location.hash;

  const { locale: activeCode, path } = splitLocale(currentRoute);
  const activeLocale = getLocale(activeCode);
  const t = getTranslations(activeCode);

  const handleSelect = (targetLocale: SiteLocale) => {
    const nextPath = localizePath(path, targetLocale);
    const targetUrl = `${nextPath}${currentHash || ""}`;
    navigate(targetUrl);
    onSelect?.(targetUrl, targetLocale);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={t.chooseLanguage}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-field border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer",
          className,
        )}
      >
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-[110px] truncate">{activeLocale.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 max-h-[80vh] overflow-y-auto">
        {SITE_LOCALES.map((locale) => {
          const isActive = locale.code === activeCode;
          const targetHref = `${localizePath(path, locale.code)}${currentHash || ""}`;
          const fullHref = toAppHref(targetHref);
          return (
            <DropdownMenuItem
              key={locale.code}
              lang={locale.hreflang}
              aria-current={isActive ? "true" : undefined}
              onClick={() => handleSelect(locale.code)}
              className={cn(
                "flex items-center justify-between cursor-pointer text-xs py-1.5",
                isActive && "font-medium text-foreground",
              )}
            >
              <a
                href={fullHref}
                lang={locale.hreflang}
                hrefLang={locale.hreflang}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  handleSelect(locale.code);
                }}
                className="flex items-center justify-between w-full"
              >
                <span lang={locale.hreflang}>{locale.label}</span>
                {isActive && (
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                )}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
