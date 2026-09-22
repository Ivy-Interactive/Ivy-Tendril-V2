import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@ivy-interactive/components/theme";
import { App } from "./App";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ProxyOriginProvider } from "./api/proxyOrigin";
import "./index.css";

// Force all link clicks to open in the system default browser instead of navigating inside the webview.
document.addEventListener(
  "click",
  (event) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("//")
    ) {
      event.preventDefault();
      event.stopPropagation();
      const resolvedUrl = anchor.href || href;
      void openUrl(resolvedUrl).catch((err: unknown) => {
        console.error("Failed to open external link:", resolvedUrl, err);
      });
    }
  },
  true,
);

const originalOpen = window.open;
window.open = function (url?: string | URL, target?: string, features?: string) {
  if (url) {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (
      urlStr.startsWith("http://") ||
      urlStr.startsWith("https://") ||
      urlStr.startsWith("mailto:") ||
      urlStr.startsWith("//")
    ) {
      void openUrl(urlStr).catch((err: unknown) => {
        console.error("Failed to open external URL via window.open:", urlStr, err);
      });
      return null;
    }
  }
  return originalOpen.call(window, url, target, features);
};

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="system" storageKey="tendril-theme">
        {/* Answers, once for the whole shell, where the WebViewer's proxy lives. See
            `api/proxyOrigin` for why this cannot be left to the call sites. */}
        <ProxyOriginProvider>
          <App />
        </ProxyOriginProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
}
