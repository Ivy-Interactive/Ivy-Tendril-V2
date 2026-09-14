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
