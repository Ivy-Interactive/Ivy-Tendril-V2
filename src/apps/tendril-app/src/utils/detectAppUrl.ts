/**
 * Finding the URL a review action's process printed, so the terminal can be swapped for the app.
 *
 * Ported from `Apps/ReviewAction/AppPreview.DetectUrl`. It runs on the client rather than the server
 * because the client already holds every byte the pty produced — buffering the transcript a second
 * time server-side would be storing it twice to answer the same question.
 */

/**
 * CSI sequences (`ESC [ … letter`), OSC sequences (`ESC ] … BEL` or `ESC ] … ESC \`) and the
 * two-character escapes in between. A dev server colours its banner, so the URL in it arrives
 * wrapped: `ESC[36mhttp://localhost:5173/ESC[0m` matches the URL pattern below as one token, escape
 * codes included, and nothing downstream can parse that.
 */
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /(?:\[[0-9;?]*[ -/]*[@-~]|\][^]*(?:|\\)|[@-Z\\-_])/g;

/** Same shape the legacy regex used: everything up to whitespace or a quote/angle bracket. */
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

/**
 * Terminal output wraps URLs in prose. `running on http://localhost:5173/.` and
 * `(http://localhost:5173)` both need their tail taken off before parsing.
 */
const TRAILING_PUNCTUATION = /[.,;:)\]>"']+$/;

/** Removes the escape sequences, so the transcript reads as the text the process meant to print. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * The hosts the WebViewer proxy will actually fetch, which is what makes a detected URL usable
 * rather than merely printed.
 *
 * This is deliberately `is_target_allowed` in `tendril-server/src/webviewer/mod.rs`, rule for rule,
 * and the two have to stay that way: a URL this accepts but the proxy refuses is detected, framed
 * and then answered with a 403, which the reviewer sees as a blank viewer with no explanation.
 *
 * It therefore parts from V1's `Uri.IsLoopback` in one direction. `*.localhost` is accepted, because
 * RFC 6761 reserves it for loopback and the proxy honours that — V1 did not, since .NET does not.
 */
function isProxyableHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // `URL.hostname` keeps IPv6 in brackets; both forms are checked so a caller passing a bare host
  // gets the same answer.
  if (host === "[::1]" || host === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * The URL a review action's process announced, or `null` while it has announced none.
 *
 * Dev servers announce themselves — `Ivy is running on https://localhost:5011`,
 * `Local: http://localhost:5173/` — and that line is the only signal available that the app is up and
 * where. Two rules keep the other URLs a build prints out of the result:
 *
 * - **The host must be one the proxy will fetch** (see `isProxyableHost`). This is what V1 called the
 *   loopback rule, narrowed to match the server: V1 also took a LAN address as a fallback, because its
 *   proxy would fetch one. V2's will not, so detecting one only produces a viewer that frames a 403.
 *   A dev server on a LAN address prints its local address too, and that is the one that works.
 * - **A portless URL is still accepted**, exactly as in V1. An app served on port 80 of this machine is
 *   still this machine's app. The port rule V1 used to filter public hosts is gone with the hosts it
 *   filtered: `https://aka.ms/some-error` in an exception's help text is no longer a candidate at all.
 */
export function detectAppUrl(transcript: string): string | null {
  if (!transcript) return null;

  const text = stripAnsi(transcript);

  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, "");

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (isProxyableHost(url.hostname)) return candidate;
  }

  return null;
}
