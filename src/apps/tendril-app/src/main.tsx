import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@ivy-interactive/components/theme";
import { App } from "./App";
import { ProxyOriginProvider } from "./api/proxyOrigin";
import { initI18n } from "./i18n";
import { startupLanguage, syncDocumentLanguage } from "./state/language";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  // The catalogs load before the first render, so the shell never paints a translation key or a frame
  // of the wrong language: there is no Suspense boundary above `App` to show while they arrive. The
  // language is the one the last session applied, or the operating system's; `App` then applies what
  // config.yaml says. `initI18n` never rejects, so a catalog that fails to load costs the translation,
  // not the app.
  void initI18n(startupLanguage()).then(() => {
    syncDocumentLanguage();
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
  });
}
