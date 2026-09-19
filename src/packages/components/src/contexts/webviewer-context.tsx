import * as React from "react";

/**
 * Where the WebViewer's proxy endpoints live.
 *
 * The viewer frames `‹origin›/__view/@‹viewer›/‹device›/‹target›`, and the document that comes back
 * must be same-origin with the proxy that served it: the injected `agent.js` registers `/sw.js` from
 * inside that document, and the page calls `/__resolve` and `/__capture` on its own origin. So this
 * is not a convenience — it is the one value that decides whether comments work at all.
 *
 * It is context rather than a prop because the answer is a property of the *shell*, not of any one
 * viewer. In the browser build the app is served from the daemon, so relative URLs already point at
 * the proxy and `""` is correct. Under Tauri the webview is on `tauri://localhost`, which serves no
 * such paths, so the daemon's own origin has to be named. A caller that forgets to pass it would get
 * a viewer that works in one build and silently fails in the other, which is the worst shape this
 * failure can take — so the shell answers once, for every viewer it ever mounts.
 */
export interface WebViewerContextValue {
  /**
   * Absolute origin serving `/__view/`, `/sw.js` and the rest of {@link WebViewerProxy}'s routes —
   * `http://127.0.0.1:5010`, no trailing slash. `""` means same-origin as the page.
   */
  proxyOrigin: string;
}

export const WebViewerContext = React.createContext<WebViewerContextValue>({
  proxyOrigin: "",
});

export interface WebViewerProviderProps {
  /** Trailing slashes are trimmed, so a caller may pass whatever its service info gave it. */
  proxyOrigin?: string;
  children: React.ReactNode;
}

export const WebViewerProvider: React.FC<WebViewerProviderProps> = ({
  proxyOrigin = "",
  children,
}) => {
  const value = React.useMemo(
    () => ({ proxyOrigin: proxyOrigin.replace(/\/+$/, "") }),
    [proxyOrigin],
  );
  return <WebViewerContext.Provider value={value}>{children}</WebViewerContext.Provider>;
};

/** The configured proxy origin, or `""` for same-origin when no provider is mounted. */
export function useProxyOrigin(): string {
  return React.useContext(WebViewerContext).proxyOrigin;
}
