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
 * `Uri.IsLoopback`'s cases: the `localhost` name, anything in `127.0.0.0/8`, and IPv6 `::1`.
 *
 * Deliberately not `*.localhost` subdomains — .NET does not treat those as loopback either, and a
 * dev server that prints one is naming a host that has to resolve like any other.
 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
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
 * - **A loopback host wins outright**, wherever it appears in the transcript. A dev server that also
 *   prints its LAN address prints the local one too, and the local one is the one that works.
 * - **Anything else needs an explicit port.** `https://aka.ms/some-error` in an exception's help text,
 *   a docs link, a package feed: none of them name a port, and a dev server always does. This is what
 *   makes the LAN fallback safe rather than a coin toss over whatever URL was printed first.
 *
 * Note that a portless *loopback* URL is still accepted — the loopback rule is checked first, exactly
 * as in the legacy implementation. An app served on port 80 of this machine is still this machine's
 * app; the port rule exists to filter public hosts, which loopback by definition is not.
 */
export function detectAppUrl(transcript: string): string | null {
  if (!transcript) return null;

  const text = stripAnsi(transcript);
  let portedFallback: string | null = null;

  for (const match of text.matchAll(URL_PATTERN)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, "");

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;

    if (isLoopbackHost(url.hostname)) return candidate;
    // A dev server bound to a LAN address (`Network: http://192.168.1.9:5173/`) is still the app, but
    // only worth taking if nothing local turns up later. `URL.port` is empty for the scheme's default
    // port, which is the same test as .NET's `IsDefaultPort`.
    if (url.port !== "" && portedFallback === null) portedFallback = candidate;
  }

  return portedFallback;
}
