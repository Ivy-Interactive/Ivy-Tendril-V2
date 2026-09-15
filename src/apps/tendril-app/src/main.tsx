import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@ivy-interactive/components/theme";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="dark" storageKey="tendril-theme">
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
