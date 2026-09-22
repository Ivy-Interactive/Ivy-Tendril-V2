/**
 * The two validators V1's onboarding runs before it will write anything, ported here because the
 * wizard is the only caller and neither has a daemon endpoint:
 *
 * - `Helpers/InputSanitizer.cs` — the project-name character set. V1's `ProjectInputStepView`
 *   sanitizes the name state on every change, and `ProjectAgentStepView` refuses to commit a name
 *   `DescribeProjectNameError` rejects.
 * - `Helpers/RepoPathValidator.cs` — what counts as a repository reference at all. V1's
 *   `ProjectRepoPickerView.AddAsync` normalizes, then rejects anything `IsValid` says no to before
 *   the path can reach a project's `repos`.
 */
import { i18n } from "../../i18n";

/** V1 `InputSanitizer.SanitizeProjectName`: everything outside the allowed set is dropped. */
export function sanitizeProjectName(input: string): string {
  if (!input) return "";
  return input.replace(/[^A-Za-z0-9._-]/g, "");
}

/** V1 `InputSanitizer.IsValidProjectName`. `.` and `..` are rejected: they are path segments. */
export function isValidProjectName(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return false;
  if (trimmed === "." || trimmed === "..") return false;
  return /^[A-Za-z0-9._-]+$/.test(trimmed);
}

/**
 * V1 `InputSanitizer.DescribeProjectNameError`, wording included. Translated when it is called, so
 * the message is in the language current at that moment.
 */
export function describeProjectNameError(name: string | null | undefined): string | null {
  if (isValidProjectName(name)) return null;
  const suggestion = sanitizeProjectName(name ?? "");
  return suggestion
    ? i18n.t("onboarding:validation.invalidProjectNameWithSuggestion", {
        name: name ?? "",
        suggestion,
      })
    : i18n.t("onboarding:validation.invalidProjectName", { name: name ?? "" });
}

/** V1 `RepoPathKind`. */
export type RepoPathKind = "ssh" | "http" | "local" | "invalid";

/** V1 `RepoPathValidator.SshPattern`: `git@<host>:<owner>/<repo>(.git)?`. */
const SSH_PATTERN = /^git@[\w.-]+:[\w.-]+\/[\w.-]+(?:\.git)?$/i;

/** V1 `RepoPathValidator.HttpPattern`: `http(s)://<host>/<path>(.git)?`. */
const HTTP_PATTERN = /^https?:\/\/[\w.-]+(:\d+)?(\/[\w.~%-]+)+(?:\.git)?$/i;

export function isSshUrl(input: string): boolean {
  return !!input.trim() && SSH_PATTERN.test(input.trim());
}

export function isHttpUrl(input: string): boolean {
  return !!input.trim() && HTTP_PATTERN.test(input.trim());
}

/** V1 `RepoPathValidator.IsLocalPath`: absolute, home-relative, or a Windows drive letter. */
export function isLocalPath(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) return true;
  if (trimmed.startsWith("~")) return true;
  return trimmed.length >= 2 && /^[A-Za-z]$/.test(trimmed[0]) && trimmed[1] === ":";
}

/**
 * V1 `RepoPathValidator.Normalize`: lowercases the scheme and host of a URL (so two spellings of
 * the same remote dedupe against each other) and leaves a local path exactly as typed.
 */
export function normalizeRepoPath(input: string | null | undefined): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return trimmed;

  if (isHttpUrl(trimmed)) {
    const schemeIdx = trimmed.indexOf("://");
    if (schemeIdx > 0) {
      const scheme = trimmed.slice(0, schemeIdx).toLowerCase();
      const rest = trimmed.slice(schemeIdx + 3);
      const slashIdx = rest.indexOf("/");
      if (slashIdx >= 0) {
        return `${scheme}://${rest.slice(0, slashIdx).toLowerCase()}${rest.slice(slashIdx)}`;
      }
      return `${scheme}://${rest.toLowerCase()}`;
    }
  }

  if (isSshUrl(trimmed)) {
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      return `${trimmed.slice(0, colonIdx).toLowerCase()}${trimmed.slice(colonIdx)}`;
    }
  }

  return trimmed;
}

/** V1 `RepoPathValidator.Classify`. */
export function classifyRepoPath(input: string): RepoPathKind {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "invalid";
  if (isSshUrl(trimmed)) return "ssh";
  if (isHttpUrl(trimmed)) return "http";
  if (isLocalPath(trimmed)) return "local";
  return "invalid";
}

/** V1 `RepoPathValidator.IsValid`. */
export function isValidRepoPath(input: string): boolean {
  return classifyRepoPath(input) !== "invalid";
}

function urlSegments(input: string): string[] {
  let trimmed = input;
  if (/\.git$/i.test(trimmed)) trimmed = trimmed.slice(0, -4);
  return trimmed.split("/").filter(Boolean);
}

/** V1 `RepoPathValidator.ExtractRepoName`: the leaf, with `.git` stripped from a remote. */
export function extractRepoName(input: string): string | null {
  const trimmed = (input ?? "").trim();
  switch (classifyRepoPath(trimmed)) {
    case "ssh": {
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx < 0) return null;
      const parts = urlSegments(trimmed.slice(colonIdx + 1));
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
    case "http": {
      const parts = urlSegments(trimmed);
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
    case "local": {
      const parts = trimmed.split(/[/\\]/).filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
    default:
      return null;
  }
}
