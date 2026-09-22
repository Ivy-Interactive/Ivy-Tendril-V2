import React from "react";
import { parseGitHubAlert, type GitHubAlertType } from "@/lib/markdown-utils";
import { useTranslation } from "@/i18n/uiPlanWorkspace";

type AlertType = GitHubAlertType;

const alertConfig = {
  NOTE: { titleKey: "alert.note", className: "pmv-alert pmv-alert--note" },
  TIP: { titleKey: "alert.tip", className: "pmv-alert pmv-alert--tip" },
  IMPORTANT: { titleKey: "alert.important", className: "pmv-alert pmv-alert--important" },
  WARNING: { titleKey: "alert.warning", className: "pmv-alert pmv-alert--warning" },
  CAUTION: { titleKey: "alert.caution", className: "pmv-alert pmv-alert--caution" },
} as const satisfies Record<AlertType, { titleKey: string; className: string }>;

const InfoIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </svg>
);

const AlertIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

function getIcon(type: AlertType) {
  switch (type) {
    case "NOTE":
      return <InfoIcon />;
    case "TIP":
      return <CheckIcon />;
    case "IMPORTANT":
    case "WARNING":
    case "CAUTION":
      return <AlertIcon />;
  }
}

export const AlertBlockquote: React.FC<React.HTMLAttributes<HTMLQuoteElement>> = ({ children }) => {
  const { t } = useTranslation("uiPlanWorkspace");
  const alert = parseGitHubAlert(children);

  if (alert) {
    const config = alertConfig[alert.type];
    return (
      <div className={config.className} role="alert">
        <div className="pmv-alert-header">
          {getIcon(alert.type)}
          <span className="pmv-alert-title">{t(config.titleKey)}</span>
        </div>
        <div className="pmv-alert-content">{alert.content}</div>
      </div>
    );
  }

  return <blockquote>{children}</blockquote>;
};
