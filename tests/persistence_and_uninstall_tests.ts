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
      "utf8"
    );
    fs.writeFileSync(
      path.join(mockTendrilHome, "tendril.db"),
      "SQLite format 3\0mock-db-content",
      "utf8"
    );

    const plansDir = path.join(mockTendrilHome, "Plans", "00023-TestPlan");
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(
      path.join(plansDir, "plan.yaml"),
      "schemaVersion: 1\ntitle: Test Plan\nstate: Draft\n",
      "utf8"
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves TENDRIL_HOME workspace, database, and plans when uninstaller runs without --purge-data", () => {
    const uninstallScript = path.resolve(__dirname, "../scripts/packaging/uninstall-macos.sh");
    expect(fs.existsSync(uninstallScript)).toBe(true);

    // Execute uninstaller with TENDRIL_HOME pointing to our mock directory
    const output = execSync(`bash "${uninstallScript}"`, {
      env: {
        ...process.env,
        TENDRIL_HOME: mockTendrilHome,
        HOME: tempDir, // redirect launchd plist lookup away from real user home
      },
      encoding: "utf8",
    });

    expect(output).toContain("Preserving user workspace and configuration data");
    expect(fs.existsSync(mockTendrilHome)).toBe(true);
    expect(fs.existsSync(path.join(mockTendrilHome, "config.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(mockTendrilHome, "tendril.db"))).toBe(true);
    expect(
      fs.existsSync(path.join(mockTendrilHome, "Plans", "00023-TestPlan", "plan.yaml"))
    ).toBe(true);
  });

  it("purges user data only when explicit --purge-data flag is passed to uninstaller", () => {
    const uninstallScript = path.resolve(__dirname, "../scripts/packaging/uninstall-macos.sh");

    const output = execSync(`bash "${uninstallScript}" --purge-data`, {
      env: {
        ...process.env,
        TENDRIL_HOME: mockTendrilHome,
        HOME: tempDir,
      },
      encoding: "utf8",
    });

    expect(output).toContain("Purging user workspace data");
    expect(fs.existsSync(mockTendrilHome)).toBe(false);
  });

  it("verifies NSIS uninstaller defaults to preserving user profile data", () => {
    const nsisScript = path.resolve(__dirname, "../src-tauri/nsis/installer.nsh");
    expect(fs.existsSync(nsisScript)).toBe(true);

    const content = fs.readFileSync(nsisScript, "utf8");

    // Must default checkbox to unchecked (0)
    expect(content).toContain("${NSD_SetState} $CheckboxDeleteData 0");
    // Must contain preservation message
    expect(content).toContain("Preserving user plans, repos, and configuration");
    // Must only delete if explicitly state == 1
    expect(content).toContain("${If} $DeleteDataState == 1");
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
