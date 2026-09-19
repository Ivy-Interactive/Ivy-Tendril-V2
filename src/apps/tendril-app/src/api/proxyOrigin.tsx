import * as React from "react";
import { WebViewerProvider } from "@ivy-interactive/components/tendril";
import { bridge } from "./bridge";

/**
 * Where the WebViewer's proxy endpoints (`/__view/`, `/sw.js`, `/__resolve`, `/__capture`) are
 * served from, resolved once for the whole shell.
 *
 * The two builds answer this differently, and that is the entire reason this exists.
 *
 * - **Browser.** The app is served by the daemon itself, which is why every HTTP call in `api/`
 *   passes `""` as its base. Relative URLs already reach the proxy, so `""` is correct and nothing
 *   has to be discovered.
 * - **Tauri.** The webview runs on `tauri://localhost`, which serves the frontend bundle and
 *   nothing else. A relative `/__view/` there resolves to a path the shell has never heard of, the
 *   frame loads nothing, and the reviewer gets a viewer with no app in it. The daemon's own origin
 *   has to be named, and `.master` is where it is written; `cmd_get_service_info` reports it.
 *
 * Resolved here rather than at each call site on purpose. A viewer mounted without it works in one
 * build and fails in the other, and the failure surfaces as "comments don't work" rather than as a
 * missing prop — so the shell answers once and every viewer it ever mounts inherits it.
 */
/**
 * The daemon's own origin, or `""` when the app is served by the daemon and relative URLs already
 * reach it.
 *
 * Anything that builds a URL the *daemon* must answer has to go through this, for the reason the
 * comment above gives: under Tauri the webview is on `tauri://localhost`, which serves the bundle
 * and nothing else, so a relative path resolves to something the shell has never heard of. Plan
 * wireframe previews hit this too -- the fence fetches `<base>/__wireframe/status`.
 */
export const ServiceOriginContext = React.createContext<string>("");

export function useServiceOrigin(): string {
  return React.useContext(ServiceOriginContext);
}

/** The address a plan's `wireframe` fences resolve their names against. */
export function useWireframeBaseUrl(planId: string | number | null | undefined): string | undefined {
  const origin = useServiceOrigin();
  if (planId === null || planId === undefined || planId === "") return undefined;
  return `${origin}/__wireframes/${planId}/`;
}

export function ProxyOriginProvider({ children }: { children: React.ReactNode }) {
  const [origin, setOrigin] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const info = await bridge.getServiceInfo();
        // A daemon that is not up yet reports no host or port. Leaving the origin empty is the
        // honest answer: the review action cannot start without the daemon either, so a viewer
        // never gets as far as framing anything.
        if (cancelled || !info.host || !info.port) return;
        setOrigin(`${info.scheme ?? "http"}://${info.host}:${info.port}`);
      } catch {
        // Same-origin is the sane fallback: it is what the browser build wants, and under Tauri the
        // daemon being unreachable is a failure the shell is already reporting elsewhere.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ServiceOriginContext.Provider value={origin}>
      <WebViewerProvider proxyOrigin={origin}>{children}</WebViewerProvider>
    </ServiceOriginContext.Provider>
  );
}
