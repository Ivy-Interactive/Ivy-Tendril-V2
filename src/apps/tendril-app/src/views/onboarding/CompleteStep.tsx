import { NewsletterSignup } from "../../components/NewsletterSignup";
import { useTranslation } from "../../i18n";

/**
 * V1's `CompleteStepView`: a heading, one line, and the newsletter box. Nothing else - V1 does not
 * restate what Finish will write, and the Finish button itself lives in the wizard's footer.
 *
 * Finish touches at most two keys, `codingAgent` (only when an agent was picked) and `onboarding`,
 * and both are merged into `config.yaml`, never rewritten over.
 */
export function CompleteStep() {
  const { t } = useTranslation("onboarding");
  return (
    <div className="space-y-4" data-testid="onboarding-step-complete">
      <h3 className="text-base font-semibold text-foreground">{t("complete.title")}</h3>
      <p className="text-sm text-muted-foreground">{t("complete.description")}</p>

      <div className="rounded-box border border-border p-3">
        <h3 className="text-sm font-semibold text-foreground">{t("complete.newsletter.title")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("complete.newsletter.description")}</p>
        <div className="mt-3">
          <NewsletterSignup />
        </div>
      </div>
    </div>
  );
}
