import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@ivy-interactive/components/theme";
import { App } from "./App";
import "./styles/docs.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="system" storageKey="tendril-docs-theme">
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
