import React, { useState } from "react";
import { Button } from "@ivy-interactive/components/ui";
import { bridge } from "../api/bridge";
import { useTranslation } from "../i18n";
import { describeBridgeError } from "../types/api";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

/** Mirrors `tendril_core::newsletter::is_valid_email`. */
export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && EMAIL_PATTERN.test(trimmed);
}

export interface NewsletterSignupProps {
  className?: string;
}

type Status = "idle" | "sending" | "subscribed";

export function NewsletterSignup({ className }: NewsletterSignupProps) {
  const { t } = useTranslation("settings");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const canSubmit = status !== "sending" && isValidEmail(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setStatus("sending");
    setError(null);
    try {
      const outcome = await bridge.subscribeNewsletter(email.trim());
      if (outcome.subscribed) {
        setStatus("subscribed");
      } else {
        setStatus("idle");
        setError(outcome.error);
      }
    } catch (err) {
      setStatus("idle");
      setError(describeBridgeError(err));
    }
  };

  return (
    <div data-testid="newsletter-signup" className={className}>
      {status === "subscribed" ? (
        <p data-testid="newsletter-success" className="text-sm font-medium text-success">
          {t("newsletter.subscribed")}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <label htmlFor="newsletter-email" className="sr-only">
            {t("newsletter.emailLabel")}
          </label>
          <div className="flex gap-2">
            <input
              id="newsletter-email"
              data-testid="newsletter-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-field border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <Button type="submit" data-testid="newsletter-submit" disabled={!canSubmit}>
              {status === "sending" ? t("newsletter.subscribing") : t("newsletter.subscribe")}
            </Button>
          </div>
          {error && (
            <p data-testid="newsletter-error" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
