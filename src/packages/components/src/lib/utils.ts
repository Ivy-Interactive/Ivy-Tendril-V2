import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function getIvyBasePath(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector('meta[name="ivy-path-base"]')?.getAttribute("content") ?? "";
}

export function getShellParam(): boolean {
  if (typeof window === "undefined" || !window.location) return true;
  const urlParams = new URLSearchParams(window.location.search);
  const shellValue = urlParams.get("shell") ?? urlParams.get("chrome");
  return shellValue?.toLowerCase() !== "false";
}

function extractAppProtocolContent(url: string): string {
  const match = url.match(/^app:\/\/(.+)$/);
  return match ? match[1] : "";
}

export function convertAppUrlToPath(appUrl: string): string {
  if (!appUrl.startsWith("app://")) {
    return appUrl;
  }

  const rest = extractAppProtocolContent(appUrl);
  const hashIdx = rest.indexOf("#");
  const beforeHash = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
  const fragment = hashIdx >= 0 ? rest.slice(hashIdx) : "";

  const [appPath, existingQueryString] = beforeHash.split("?");

  const basePath = getIvyBasePath();
  let path = basePath ? `${basePath}/${appPath}` : `/${appPath}`;

  const isShellFalse = !getShellParam();
  const queryParams = new URLSearchParams(existingQueryString || "");

  if (isShellFalse && !queryParams.has("shell")) {
    queryParams.set("shell", "false");
  }

  const finalQueryString = queryParams.toString();
  if (finalQueryString) {
    path += `?${finalQueryString}`;
  }
  path += fragment;

  return path;
}

export function getIvyHost(): string {
  if (typeof document === "undefined") return "";
  const metaHost = document.querySelector('meta[name="ivy-host"]')?.getAttribute("content");
  if (metaHost) {
    return metaHost + getIvyBasePath();
  }
  if (typeof window !== "undefined" && window.location) {
    return window.location.origin + getIvyBasePath();
  }
  return "";
}

export function isLocalFilesEnabled(): boolean {
  if (typeof document === "undefined") return false;
  const meta = document.querySelector('meta[name="ivy-dangerously-allow-local-files"]');
  return meta?.getAttribute("content") === "true";
}

export function isDevToolsEnabled(): boolean {
  if (typeof document === "undefined") return false;
  const meta = document.querySelector('meta[name="ivy-enable-dev-tools"]');
  return meta?.getAttribute("content") === "true";
}

/**
 * Lowercase the first character of a Title Case string, leaving non-strings untouched.
 * Chart data keys arrive Title Cased from some producers while the props that select them
 * are camel cased.
 */
export function camelCase(titleCase: unknown): unknown {
  if (typeof titleCase !== "string") {
    return titleCase;
  }
  return titleCase.charAt(0).toLowerCase() + titleCase.slice(1);
}

/**
 * Apply defaults to an object, only setting values that are undefined.
 * Used where a producer omits a value because it equals the default, so the
 * consumer has to reinstate it.
 */
export function applyDefaults<T extends object>(
  obj: Partial<T> | undefined,
  defaults: Partial<T>,
): Partial<T> {
  if (!obj) return { ...defaults };
  const result = { ...defaults };
  for (const key in obj) {
    if (obj[key] !== undefined) {
      (result as Record<string, unknown>)[key] = obj[key];
    }
  }
  return result;
}
