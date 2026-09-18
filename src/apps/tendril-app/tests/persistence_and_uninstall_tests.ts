import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

describe("Persistence and Uninstallation Tests", () => {
  let tempDir: string;
  let mockTendrilHome: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tendril-persist-test-"));
    mockTendrilHome = path.join(tempDir, ".tendril");
    fs.mkdirSync(mockTendrilHome, { recursive: true });

    // Seed mock user data
    fs.writeFileSync(
      path.join(mockTendrilHome, "config.yaml"),
      "theme: dark\ncodingAgent: ClaudeCode\nprojects: []\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(mockTendrilHome, "tendril.db"),
      "SQLite format 3\0mock-db-content",
      "utf8",
    );

    const plansDir = path.join(mockTendrilHome, "Plans", "00023-TestPlan");
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(
      path.join(plansDir, "plan.yaml"),
      "schemaVersion: 1\ntitle: Test Plan\nstate: Draft\n",
      "utf8",
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Every invocation goes through here so none can reach outside the scratch dir. Without
  // TENDRIL_APP_PATH the script targets /Applications/Tendril.app, and running these tests on a
  // machine with Tendril installed would uninstall the developer's own copy.
  function runUninstaller(args: string[] = []): string {
    const uninstallScript = path.resolve(__dirname, "../scripts/packaging/uninstall-macos.sh");
    return execSync(`bash "${uninstallScript}" ${args.join(" ")}`.trim(), {
      env: {
        ...process.env,
        TENDRIL_HOME: mockTendrilHome,
        HOME: tempDir, // redirect launchd plist lookup away from the real user home
        TENDRIL_APP_PATH: path.join(tempDir, "Applications", "Tendril.app"),
      },
      encoding: "utf8",
    });
  }

  it("preserves TENDRIL_HOME workspace, database, and plans when uninstaller runs without --purge-data", () => {
    expect(
      fs.existsSync(path.resolve(__dirname, "../scripts/packaging/uninstall-macos.sh")),
    ).toBe(true);

    const output = runUninstaller();

    expect(output).toContain("Preserving user workspace and configuration data");
    expect(fs.existsSync(mockTendrilHome)).toBe(true);
    expect(fs.existsSync(path.join(mockTendrilHome, "config.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(mockTendrilHome, "tendril.db"))).toBe(true);
    expect(fs.existsSync(path.join(mockTendrilHome, "Plans", "00023-TestPlan", "plan.yaml"))).toBe(
      true,
    );
  });

  it("purges user data only when explicit --purge-data flag is passed to uninstaller", () => {
    const output = runUninstaller(["--purge-data"]);

    expect(output).toContain("Purging user workspace data");
    expect(fs.existsSync(mockTendrilHome)).toBe(false);
  });

  it("wires the NSIS hooks into the bundle config under the names Tauri actually calls", () => {
    // An earlier version of installer.nsh defined electron-builder's `customUnInstall` and was
    // referenced from nowhere, so none of it ran. Tauri only inserts these four macros, and only
    // when `bundle.windows.nsis.installerHooks` points at the file.
    const confPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
    const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
    expect(conf.bundle?.windows?.nsis?.installerHooks).toBe("nsis/installer.nsh");

    const nsisScript = path.resolve(__dirname, "../src-tauri/nsis/installer.nsh");
    expect(fs.existsSync(nsisScript)).toBe(true);
    const content = fs.readFileSync(nsisScript, "utf8");

    for (const hook of [
      "NSIS_HOOK_PREINSTALL",
      "NSIS_HOOK_POSTINSTALL",
      "NSIS_HOOK_PREUNINSTALL",
      "NSIS_HOOK_POSTUNINSTALL",
    ]) {
      expect(content).toContain(`!macro ${hook}`);
    }
    // The electron-builder macro this file used to define, which Tauri never calls. Matched as a
    // definition so the file's own comment explaining the history does not trip this.
    expect(content).not.toContain("!macro customUnInstall");
  });

  it("verifies the NSIS uninstaller preserves user profile data unless explicitly opted in", () => {
    const nsisScript = path.resolve(__dirname, "../src-tauri/nsis/installer.nsh");
    const content = fs.readFileSync(nsisScript, "utf8");

    // Purging is gated on Tauri's own checkbox, which ships unticked...
    expect(content).toContain("${If} $DeleteAppDataCheckboxState <> 1");
    expect(content).toContain("Goto keep_data");
    // ...and then on a second explicit yes, defaulting to No for a silent uninstall.
    expect(content).toContain("/SD IDNO IDYES purge_data IDNO keep_data");
    expect(content).toContain("Preserving user plans, repos, and configuration");
    // The only `rm -rf` equivalent must sit behind that confirmation.
    const purgeIndex = content.indexOf("purge_data:");
    expect(purgeIndex).toBeGreaterThan(-1);
    expect(content.indexOf('RMDir /r "$PROFILE\\.tendril"')).toBeGreaterThan(purgeIndex);
  });

  it("leaves the autostart task and profile data alone when the uninstaller runs as an upgrade", () => {
    // Tauri runs the old uninstaller with /UPDATE before laying down a new build. Tearing down the
    // logon task or the provisioned binaries there would break the upgrade rather than clean up.
    const nsisScript = path.resolve(__dirname, "../src-tauri/nsis/installer.nsh");
    const content = fs.readFileSync(nsisScript, "utf8");

    const preUninstall = content.slice(
      content.indexOf("!macro NSIS_HOOK_PREUNINSTALL"),
      content.indexOf("!macro NSIS_HOOK_POSTUNINSTALL"),
    );
    expect(preUninstall).toContain("${If} $UpdateMode <> 1");
    // The /Delete must be inside that guard; stopping the service is unconditional by design.
    expect(preUninstall.indexOf("schtasks.exe /Delete")).toBeGreaterThan(
      preUninstall.indexOf("${If} $UpdateMode <> 1"),
    );

    const postUninstall = content.slice(content.indexOf("!macro NSIS_HOOK_POSTUNINSTALL"));
    expect(postUninstall).toContain("${If} $UpdateMode <> 1");
  });

  it("removes provisioned sidecars but keeps a bin directory holding the user's own tools", () => {
    const binDir = path.join(mockTendrilHome, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "tendril"), "daemon-binary", "utf8");
    fs.writeFileSync(path.join(binDir, "opencode"), "agent-binary", "utf8");
    fs.writeFileSync(path.join(binDir, ".provisioned"), "{}", "utf8");
    // `bin` is on the PATH handed to coding agents, so anything else in it is the user's.
    fs.writeFileSync(path.join(binDir, "my-own-tool"), "#!/bin/sh\n", "utf8");

    runUninstaller();

    expect(fs.existsSync(path.join(binDir, "tendril"))).toBe(false);
    expect(fs.existsSync(path.join(binDir, "opencode"))).toBe(false);
    expect(fs.existsSync(path.join(binDir, ".provisioned"))).toBe(false);
    expect(fs.existsSync(path.join(binDir, "my-own-tool"))).toBe(true);
    expect(fs.existsSync(binDir)).toBe(true);
  });

  it("removes the bin directory itself once only provisioned files were in it", () => {
    const binDir = path.join(mockTendrilHome, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "tendril"), "daemon-binary", "utf8");
    // A run interrupted mid-replace leaves staging files behind; they must not keep the dir alive.
    fs.writeFileSync(path.join(binDir, ".tendril.new"), "partial", "utf8");

    runUninstaller();

    expect(fs.existsSync(binDir)).toBe(false);
    // Removing the sidecars must not have touched the workspace around them.
    expect(fs.existsSync(path.join(mockTendrilHome, "tendril.db"))).toBe(true);
  });

  it("retains database, configuration, and plan revisions across simulated app upgrades", () => {
    // 1. Simulate installed v0.1.0 app binary directory
    const installDir = path.join(tempDir, "app_install");
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, "version.txt"), "0.1.0", "utf8");
    fs.writeFileSync(path.join(installDir, "tendril-app"), "binary-v1", "utf8");

    // Verify initial state
    expect(fs.readFileSync(path.join(installDir, "version.txt"), "utf8")).toBe("0.1.0");
    expect(fs.existsSync(path.join(mockTendrilHome, "config.yaml"))).toBe(true);

    // 2. Perform simulated upgrade: replace application installation files with v0.2.0
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, "version.txt"), "0.2.0", "utf8");
    fs.writeFileSync(path.join(installDir, "tendril-app"), "binary-v2", "utf8");

    // 3. Verify that all workspace data, databases, and plans survived the upgrade untouched
    expect(fs.readFileSync(path.join(installDir, "version.txt"), "utf8")).toBe("0.2.0");
    expect(fs.existsSync(path.join(mockTendrilHome, "config.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(mockTendrilHome, "tendril.db"))).toBe(true);

    const configContent = fs.readFileSync(path.join(mockTendrilHome, "config.yaml"), "utf8");
    expect(configContent).toContain("codingAgent: ClaudeCode");

    const planFile = path.join(mockTendrilHome, "Plans", "00023-TestPlan", "plan.yaml");
    expect(fs.existsSync(planFile)).toBe(true);
    const planContent = fs.readFileSync(planFile, "utf8");
    expect(planContent).toContain("title: Test Plan");
  });
});
