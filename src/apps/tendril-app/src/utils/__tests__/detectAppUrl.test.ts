import { describe, expect, it } from "vitest";
import { detectAppUrl, stripAnsi } from "../detectAppUrl";

describe("detectAppUrl", () => {
  it("finds a URL printed inside prose, with the trailing punctuation stripped", () => {
    expect(detectAppUrl("Ivy is running on http://localhost:5173/.")).toBe(
      "http://localhost:5173/",
    );
    expect(detectAppUrl("Serving (http://localhost:5173)")).toBe("http://localhost:5173");
    expect(detectAppUrl("see http://localhost:5173/docs;")).toBe("http://localhost:5173/docs");
  });

  it("takes loopback over a LAN address printed earlier in the transcript", () => {
    const transcript = [
      "  ➜  Network: http://192.168.1.9:5173/",
      "  ➜  Local:   http://localhost:5173/",
    ].join("\n");

    expect(detectAppUrl(transcript)).toBe("http://localhost:5173/");
  });

  it("refuses a LAN address, which the proxy would answer with a 403", () => {
    // V1 took this as a fallback because its proxy would fetch a private address. V2's
    // `is_target_allowed` is loopback-only, so detecting one buys a framed 403 and a blank
    // viewer with no explanation - better to keep waiting for the Local: line, which a dev
    // server prints whenever it prints a Network: one.
    expect(detectAppUrl("Network: http://192.168.1.9:5173/")).toBeNull();
    expect(
      detectAppUrl("Network: http://192.168.1.9:5173/\nAlso: http://10.0.0.4:8080/"),
    ).toBeNull();
  });

  it("ignores public URLs — the documentation-link case", () => {
    expect(detectAppUrl("For more information see https://aka.ms/some-error")).toBeNull();
    expect(detectAppUrl("Restoring from https://api.nuget.org/v3/index.json")).toBeNull();
    expect(detectAppUrl("docs: https://vite.dev/config/, https://react.dev/")).toBeNull();
  });

  it("accepts a portless loopback URL, which the port rule is not aimed at", () => {
    // The loopback rule is checked first, as in the legacy implementation: an app served on this
    // machine's port 80 is still this machine's app.
    expect(detectAppUrl("Listening on http://localhost/")).toBe("http://localhost/");
  });

  it("recognises 127.0.0.0/8 and IPv6 ::1 as loopback", () => {
    expect(detectAppUrl("bound to http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000/");
    expect(detectAppUrl("bound to http://127.9.9.9:3000/")).toBe("http://127.9.9.9:3000/");
    expect(detectAppUrl("bound to http://[::1]:3000/")).toBe("http://[::1]:3000/");
  });

  it("treats a .localhost subdomain as proxyable, because the server does", () => {
    // RFC 6761 reserves *.localhost for loopback and `is_target_allowed` honours it. V1 did
    // not, since .NET's Uri.IsLoopback does not - so this is a deliberate departure from V1,
    // made to keep the detector and the allow-list from ever disagreeing.
    const transcript = "Proxying http://app.localhost:8080/\nLocal: http://localhost:5173/";

    expect(detectAppUrl(transcript)).toBe("http://app.localhost:8080/");
  });

  it("finds a URL wrapped in the colour escapes a dev server banner uses", () => {
    const banner = "  [32m➜[39m  [1mLocal[22m: [36mhttp://localhost:5173/[39m";

    expect(detectAppUrl(banner)).toBe("http://localhost:5173/");
  });

  it("returns null for an empty transcript and for one with no URL", () => {
    expect(detectAppUrl("")).toBeNull();
    expect(detectAppUrl("Compiling…\nBuild succeeded in 4.2s\n")).toBeNull();
  });

  it("ignores a non-http scheme and unparseable candidates", () => {
    expect(detectAppUrl("cloning git+ssh://git@github.com:22/o/r.git")).toBeNull();
    expect(detectAppUrl("malformed http://:::5173/")).toBeNull();
  });
});

describe("stripAnsi", () => {
  it("removes CSI, OSC and two-character escapes", () => {
    expect(stripAnsi("[1;32mready[0m")).toBe("ready");
    expect(stripAnsi("]0;a titletail")).toBe("tail");
    expect(stripAnsi("]0;a title\\tail")).toBe("tail");
    expect(stripAnsi("wrapMhere")).toBe("wraphere");
  });

  it("leaves the carriage returns a progress redraw is made of alone", () => {
    // Only escape sequences go: `\r` is content as far as this function is concerned, and the
    // detector matches URLs against whitespace either way.
    expect(stripAnsi("50%\r100%\r")).toBe("50%\r100%\r");
  });
});
