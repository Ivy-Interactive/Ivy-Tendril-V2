import { Globe } from "lucide-react";
import { DEFAULT_LOCALE } from "../config/locales.config";
import { getTranslations } from "../config/translations";

export interface UntranslatedNoticeProps {
  locale: string;
  className?: string;
}

export function UntranslatedNotice({ locale, className }: UntranslatedNoticeProps) {
  const code = typeof locale === "string" ? locale : (locale as { code: string }).code;
  if (!code || code === DEFAULT_LOCALE) {
    return null;
  }

  const t = getTranslations(code);

  return (
    <div
      role="note"
      aria-label={t.untranslatedTitle}
      className={`mb-6 flex items-start gap-3 rounded-lg border border-border bg-secondary/30 p-4 text-sm ${className ?? ""}`}
    >
      <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <p className="font-medium text-foreground">{t.untranslatedTitle}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{t.untranslatedDescription}</p>
      </div>
    </div>
  );
}
