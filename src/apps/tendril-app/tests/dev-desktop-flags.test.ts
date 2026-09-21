/**
 * `dev:desktop`'s own flags, and specifically that `--no-reload` and `--no-hotreload` are one flag.
 *
 * The alias is not a one-line lookup: both spellings have to be honoured in three separate places —
 * detection, the strip that keeps them from reaching a Tauri CLI that has never heard of either, and
 * the allowlist that decides whether a `--no-*` argument is a typo. An alias honoured in only some of
 * them is worse than no alias, because it fails as "the flag did nothing" rather than as an error:
 * missing from the strip, `--no-hotreload` reaches Tauri and produces its usage text and exit 2;
 * missing from the allowlist, this runner rejects it before the daemon starts.
 *
 * So the substantive assertion here is the parity one — the two spellings must produce an identical
 * result, whatever that result is — rather than a list of expected values that could be kept passing
 * while the spellings drift apart.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NO_RELOAD_FLAGS, OWN_FLAGS, parseRunnerFlags } from "../../../scripts/dev-desktop";

/** No ambient `NO_WATCH` / `NO_HMR`, so a developer's shell cannot make these pass or fail. */
const NO_ENV = {} as NodeJS.ProcessEnv;

describe("--no-reload / --no-hotreload are the same flag", () => {
  it("produces an identical result for either spelling", () => {
    expect(parseRunnerFlags(["--no-hotreload"], NO_ENV)).toEqual(
      parseRunnerFlags(["--no-reload"], NO_ENV),
    );
  });

  it("stays identical when combined with a forwarded Tauri flag", () => {
    const forwarded = ["--", "--features", "custom-protocol", "--no-dev-server-wait"];
    expect(parseRunnerFlags(["--no-hotreload", ...forwarded], NO_ENV)).toEqual(
      parseRunnerFlags(["--no-reload", ...forwarded], NO_ENV),
    );
  });

  it.each(NO_RELOAD_FLAGS)("%s turns off both Rust watching and frontend HMR", (flag) => {
    const flags = parseRunnerFlags([flag], NO_ENV);
    expect(flags.noWatch).toBe(true);
    expect(flags.noHmr).toBe(true);
  });

  // The failure this guards is the quiet one: an unstripped alias reaches a CLI that rejects it, and
  // only after the components build, both sidecars and the daemon have already been started.
  it.each(NO_RELOAD_FLAGS)("%s is never forwarded to the Tauri CLI", (flag) => {
    expect(parseRunnerFlags([flag], NO_ENV).tauriArgs).not.toContain(flag);
  });

  it.each(NO_RELOAD_FLAGS)("%s is not mistaken for a misspelling", (flag) => {
    expect(parseRunnerFlags([flag], NO_ENV).unknownFlag).toBeNull();
  });

  // `--no-watch` is Tauri's own flag, so the alias has to re-add it rather than merely not strip it.
  it.each(NO_RELOAD_FLAGS)("%s still asks Tauri for --no-watch", (flag) => {
    expect(parseRunnerFlags([flag], NO_ENV).tauriArgs).toContain("--no-watch");
  });
});

describe("the runner's own flags", () => {
  it("--no-watch alone leaves HMR on", () => {
    const flags = parseRunnerFlags(["--no-watch"], NO_ENV);
    expect(flags.noWatch).toBe(true);
    expect(flags.noHmr).toBe(false);
  });

  it("--no-hmr alone leaves Rust watching on", () => {
    const flags = parseRunnerFlags(["--no-hmr"], NO_ENV);
    expect(flags.noHmr).toBe(true);
    expect(flags.noWatch).toBe(false);
  });

  // `--no-hmr` is this runner's invention; Tauri would reject it.
  it("--no-hmr is not forwarded to the Tauri CLI", () => {
    expect(parseRunnerFlags(["--no-hmr"], NO_ENV).tauriArgs).not.toContain("--no-hmr");
  });

  it("no flags at all asks for nothing", () => {
    expect(parseRunnerFlags([], NO_ENV)).toEqual({
      noWatch: false,
      noHmr: false,
      tauriArgs: [],
      unknownFlag: null,
    });
  });

  it("--no-watch is passed once, not twice, when it is also given explicitly", () => {
    const tauriArgs = parseRunnerFlags(["--no-watch", "--no-reload"], NO_ENV).tauriArgs;
    expect(tauriArgs.filter((arg) => arg === "--no-watch")).toHaveLength(1);
  });
});

describe("the environment", () => {
  it("NO_WATCH=1 is the same as --no-watch", () => {
    expect(parseRunnerFlags([], { NO_WATCH: "1" })).toEqual(
      parseRunnerFlags(["--no-watch"], NO_ENV),
    );
  });

  it("NO_HMR=1 turns HMR off without touching the Tauri argv", () => {
    const flags = parseRunnerFlags([], { NO_HMR: "1" });
    expect(flags.noHmr).toBe(true);
    expect(flags.tauriArgs).toEqual([]);
  });

  // Anything other than exactly "1" is not the opt-in, so an exported `NO_WATCH=0` does not silently
  // disable rebuilds.
  it.each(["0", "false", "", "true"])("NO_WATCH=%o is not an opt-in", (value) => {
    expect(parseRunnerFlags([], { NO_WATCH: value }).noWatch).toBe(false);
  });
});

describe("forwarding", () => {
  // The `--` is how `pnpm`/`vp run` stop eating the flag; Tauri must not then see it as an argument.
  it("drops the -- forwarding delimiter", () => {
    expect(parseRunnerFlags(["--", "--no-reload"], NO_ENV).tauriArgs).not.toContain("--");
  });

  it("forwards a flag it does not own, in order", () => {
    const flags = parseRunnerFlags(["--", "--config", "custom.json"], NO_ENV);
    expect(flags.tauriArgs).toEqual(["--config", "custom.json"]);
    expect(flags.unknownFlag).toBeNull();
  });

  // Tauri's own `--no-*`, and the reason the rejection below needs an exception at all.
  it("forwards --no-dev-server-wait rather than rejecting it", () => {
    const flags = parseRunnerFlags(["--no-dev-server-wait"], NO_ENV);
    expect(flags.unknownFlag).toBeNull();
    expect(flags.tauriArgs).toContain("--no-dev-server-wait");
  });
});

describe("misspellings", () => {
  // The original complaint: `--no-hotreload` cost a full build and a started daemon to find out it
  // was not the flag. Everything else shaped like it must be caught before any of that.
  it.each(["--no-hot-reload", "--no-reloads", "--no-hmr-please", "--no-wach"])(
    "%s is reported rather than forwarded",
    (flag) => {
      expect(parseRunnerFlags([flag], NO_ENV).unknownFlag).toBe(flag);
    },
  );

  it("names the first misspelling when there are several", () => {
    expect(parseRunnerFlags(["--no-wach", "--no-hot-reload"], NO_ENV).unknownFlag).toBe(
      "--no-wach",
    );
  });

  // Only `--no-*` is claimed; anything else may well be a Tauri flag we have never heard of.
  it.each(["--verbose", "-v", "--target", "--release"])("%s is left to the Tauri CLI", (flag) => {
    expect(parseRunnerFlags([flag], NO_ENV).unknownFlag).toBeNull();
  });

  it.each(OWN_FLAGS)("%s is accepted", (flag) => {
    expect(parseRunnerFlags([flag], NO_ENV).unknownFlag).toBeNull();
  });
});

/**
 * `[ELIFECYCLE] Command failed.` after a clean Ctrl+C, which `dev:desktop` produced intermittently.
 *
 * It is not a failure. `dev-desktop.ts` exits 0, and the line is printed *afterwards* by a
 * grandchild: the Tauri CLI runs `beforeDevCommand` through `sh -c`, and that command used to be
 * `pnpm dev`. Ctrl+C reaches the whole group, pnpm's child dies on the signal, and pnpm reports a
 * signalled script as a failed run — a message with no exit code, racing the parent's teardown,
 * which is why it appeared only some of the time.
 *
 * `dev-desktop.ts` already avoids pnpm for exactly this reason when it spawns the Tauri CLI (see the
 * comment on that `spawn`), but the wrapper it removed was re-entered one level down by
 * `tauri.conf.json`. Measured with the real config: `pnpm dev` emits the line on a group SIGINT and
 * the direct form does not.
 *
 * `beforeBuildCommand` is deliberately left alone — a build is not signalled, and pnpm's reporting of
 * a genuine build failure there is wanted.
 */
describe("the Tauri beforeDevCommand", () => {
  const tauriConf = JSON.parse(
    readFileSync(join(__dirname, "..", "src-tauri", "tauri.conf.json"), "utf8"),
  ) as { build: { beforeDevCommand: string; beforeBuildCommand: string } };

  it("does not go through a pnpm wrapper", () => {
    expect(tauriConf.build.beforeDevCommand).not.toMatch(/\bpnpm\b/);
  });

  it("still starts the Vite+ dev server", () => {
    expect(tauriConf.build.beforeDevCommand).toMatch(/vp\b.*\bdev\b/);
  });

  // `predev` is a pnpm lifecycle hook, so dropping the pnpm wrapper drops it too — and without the
  // components build the app starts against a stale or absent `dist`.
  it("still builds the components package first", () => {
    expect(tauriConf.build.beforeDevCommand).toContain("ensure-components.mjs");
  });
});
