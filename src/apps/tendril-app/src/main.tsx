import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@ivy-interactive/components/theme";
import App from "./App";
import { ProxyOriginProvider } from "./api/proxyOrigin";
import "./index.css";

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
