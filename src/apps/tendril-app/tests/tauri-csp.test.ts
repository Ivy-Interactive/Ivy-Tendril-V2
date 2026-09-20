import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcTauriDir = path.join(__dirname, "..", "src-tauri");
const tauriConfPath = path.join(srcTauriDir, "tauri.conf.json");

interface TauriConf {
  app: { security: { csp: string } };
}

const readCsp = (): string =>
  (JSON.parse(fs.readFileSync(tauriConfPath, "utf8")) as TauriConf).app.security.csp;

/**
 * Splits a serialised policy into `{ "directive-name": ["source", "expressions"] }`. Directive
 * names are ASCII case-insensitive (CSP3 §2.2) so they are lowercased; source expressions are not
 * uniformly so, and are left exactly as written.
 */
const parseCsp = (csp: string): Record<string, string[]> =>
  Object.fromEntries(
    csp
      .split(";")
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...sources] = directive.split(/\s+/);
        return [name.toLowerCase(), sources];
      }),
  );

/**
 * The CSP in `tauri.conf.json` is a security boundary and a JSON file cannot carry comments, so the
 * reasoning for every token lives here. Read this before changing that string.
 *
 * THE BUG THIS GUARDS. Before `worker-src` existed, the policy had no `worker-src` and no
 * `child-src`, so worker loads fell all the way back to `default-src 'self'` and no `blob:` was
 * allowed anywhere. In the packaged app on macOS and Linux that made every PDF thumbnail parse on
 * the main thread and freeze the UI, with nothing logged.
 *
 * WHY `'self'` ALONE IS NOT ENOUGH ON macOS AND LINUX. The packaged webview serves the frontend
 * from `tauri://localhost` (tauri-2.11.5 `manager/webview.rs`). `tauri:` is a custom, non-special
 * URL scheme, so `new URL("tauri://localhost").origin` serialises to the *string* `"null"` — this
 * is a WHATWG URL serialisation rule, not a CSP one, and it is observable in plain Node. pdf.js
 * reads that value: `PDFWorker._isSameOrigin` in `pdfjs-dist/build/pdf.mjs` opens with
 * `if (!base?.origin || base.origin === "null") return false`, so it decides the worker is
 * cross-origin *whatever URL it is given*. It then wraps the worker through `_createCDNWrapper`,
 * which is literally `URL.createObjectURL(new Blob([...], { type: "text/javascript" }))`. So on
 * those two platforms pdf.js never attempts the same-origin load `'self'` would authorise — it
 * attempts a `blob:` one. When that is refused, `new Worker` throws, pdf.js swallows the error and
 * calls `#setupFakeWorker()`, which parses on the main thread. It fails closed and silently.
 *
 * WHY EACH ADDED SOURCE EXPRESSION IS THERE, AND WHY NEITHER CAN BE TIDIED AWAY:
 *
 *   `worker-src`  — declared explicitly rather than inherited. Without it, worker loads fall back
 *                   through `child-src` to `default-src`, which means any future tightening of
 *                   `default-src` silently re-breaks PDF rendering at a distance.
 *   `'self'`      — the direct load. `ContentInput.tsx` constructs `new Worker(<emitted asset>)`
 *                   itself, and on Windows and Android (served from `http(s)://tauri.localhost`, a
 *                   real origin) pdf.js also takes the same-origin path. `'self'` is what permits
 *                   the bundled `assets/pdf.worker-*.mjs` in both cases.
 *   `blob:`       — the `_createCDNWrapper` path described above. It is NOT redundant with
 *                   `'self'`: under the null-origin quirk pdf.js will not even try a `'self'` URL.
 *                   `ContentInput.tsx` currently avoids this path by handing pdf.js a
 *                   `GlobalWorkerOptions.workerPort` instead of a `workerSrc`, but that is one
 *                   library version away from changing. Removing `blob:` costs nothing visible in
 *                   `pnpm dev` (which serves from `http://127.0.0.1:5173`, a real origin) and on
 *                   Windows — it regresses only the packaged macOS and Linux builds, and only as a
 *                   performance symptom. That asymmetry is exactly why it is pinned here.
 *
 * WHY THERE IS NO `devCsp`. Tauri's `csp()` (tauri-2.11.5 `manager/mod.rs`) returns
 * `dev_csp.or(csp)`, so with no `devCsp` key the dev build inherits this same policy. Dev serves
 * from a real origin and so never reproduced the bug in the first place; adding a `devCsp` would
 * only widen the dev/prod divergence that hid it.
 */
describe("packaged app Content-Security-Policy", () => {
  it("declares worker-src explicitly rather than inheriting from default-src", () => {
    expect(Object.keys(parseCsp(readCsp()))).toContain("worker-src");
  });

  it("allows blob: workers, the only path pdf.js takes under tauri://localhost", () => {
    expect(parseCsp(readCsp())["worker-src"]).toContain("blob:");
  });

  it("allows 'self' workers, the bundled pdf.worker asset", () => {
    expect(parseCsp(readCsp())["worker-src"]).toContain("'self'");
  });

  it("widens worker-src by exactly those two source expressions and no more", () => {
    expect(parseCsp(readCsp())["worker-src"]).toEqual(["'self'", "blob:"]);
  });

  // The fix is a worker-src widening, not a blanket one. If blob: ever leaks into script-src or
  // default-src, arbitrary blob: script execution becomes available to the whole document.
  it("confines blob: to worker-src", () => {
    const directives = parseCsp(readCsp());
    for (const [name, sources] of Object.entries(directives)) {
      if (name === "worker-src") continue;
      expect({ name, sources }).toEqual({ name, sources: expect.not.arrayContaining(["blob:"]) });
    }
  });

  it("keeps default-src and script-src locked to 'self'", () => {
    const directives = parseCsp(readCsp());
    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["script-src"]).toEqual(["'self'"]);
  });

  it("never allows 'unsafe-eval' or a bare wildcard anywhere", () => {
    const csp = readCsp();
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/(?:^|[\s;])\*(?:$|[\s;])/);
  });

  // Dev inheriting the production policy is deliberate; see the block comment above.
  it("declares no devCsp, so dev and packaged builds share one policy", () => {
    const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
    expect(conf.app.security.devCsp).toBeUndefined();
  });
});
