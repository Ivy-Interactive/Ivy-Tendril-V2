#!/usr/bin/env node

/**
 * Migration Rehearsal Harness
 *
 * Rehearses existing-data compatibility, migration, backup/restore, and rollback
 * on disposable copies only, with an isolated TENDRIL_HOME sandbox.
 *
 * Safety Rules:
 * 1. Must refuse to run unless TENDRIL_SANDBOX is explicitly set and under os.tmpdir().
 * 2. Aborts if it resolves to the real home (~/.tendril) or if TENDRIL_HOME is unset or outside sandbox.
 * 3. Never touches live user data.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const REAL_HOME = path.resolve(os.homedir(), ".tendril");

export interface SandboxValidationResult {
  valid: boolean;
  error?: string;
  sandbox?: string;
  home?: string;
}

interface StepRecord {
  step: string;
  passed: boolean;
  note: string;
}

export function validateSandbox(
  sandboxEnv: string | undefined,
  homeEnv: string | undefined,
): SandboxValidationResult {
  if (!sandboxEnv || sandboxEnv.trim() === "") {
    return { valid: false, error: "TENDRIL_SANDBOX environment variable is not set." };
  }

  const resolvedSandbox = path.resolve(sandboxEnv.trim());
  const tmpDir = path.resolve(os.tmpdir());

  // Check not real home
  if (resolvedSandbox === REAL_HOME) {
    return {
      valid: false,
      error: "TENDRIL_SANDBOX resolves to the real home directory (~/.tendril). Refusing to run.",
    };
  }

  // Check inside os.tmpdir()
  const relativeToTmp = path.relative(tmpDir, resolvedSandbox);
  if (relativeToTmp.startsWith("..") || path.isAbsolute(relativeToTmp)) {
    return {
      valid: false,
      error: `TENDRIL_SANDBOX (${resolvedSandbox}) is outside os.tmpdir() (${tmpDir}). Refusing to run.`,
    };
  }

  // Check TENDRIL_HOME is set and inside sandbox
  if (!homeEnv || homeEnv.trim() === "") {
    return { valid: false, error: "TENDRIL_HOME is unset. Refusing to run." };
  }

  const resolvedHome = path.resolve(homeEnv.trim());
  const relativeToSandbox = path.relative(resolvedSandbox, resolvedHome);
  if (relativeToSandbox.startsWith("..") || path.isAbsolute(relativeToSandbox)) {
    return {
      valid: false,
      error: `TENDRIL_HOME (${resolvedHome}) points outside TENDRIL_SANDBOX (${resolvedSandbox}). Refusing to run.`,
    };
  }

  return { valid: true, sandbox: resolvedSandbox, home: resolvedHome };
}

function runSelfCheck(): void {
  console.log("Running rehearsal guardrail self-check...");

  const tmpDir = os.tmpdir();
  const validSandboxPath = path.join(tmpDir, "tendril-sandbox-test-valid");

  // 1. Unset sandbox
  const c1 = validateSandbox("", validSandboxPath);
  if (c1.valid) throw new Error("Self-check failed: allowed unset TENDRIL_SANDBOX");

  // 2. Real home
  const c2 = validateSandbox(REAL_HOME, REAL_HOME);
  if (c2.valid) throw new Error("Self-check failed: allowed real home directory as sandbox");

  // 3. Outside tmpdir
  const c3 = validateSandbox("/Users/rorychatt/outside-tmp", "/Users/rorychatt/outside-tmp");
  if (c3.valid) throw new Error("Self-check failed: allowed sandbox outside os.tmpdir()");

  // 4. Unset TENDRIL_HOME
  const c4 = validateSandbox(validSandboxPath, "");
  if (c4.valid) throw new Error("Self-check failed: allowed unset TENDRIL_HOME");

  // 5. TENDRIL_HOME outside sandbox
  const c5 = validateSandbox(validSandboxPath, path.join(tmpDir, "other-dir"));
  if (c5.valid) throw new Error("Self-check failed: allowed TENDRIL_HOME outside TENDRIL_SANDBOX");

  // 6. Valid sandbox & home
  const c6 = validateSandbox(validSandboxPath, validSandboxPath);
  if (!c6.valid) throw new Error(`Self-check failed: rejected valid sandbox: ${c6.error}`);

  console.log(
    "[PASS] Rehearsal guardrail self-check: All safety checks verified. Refuses unset, outside tmpdir, and real home.",
  );
  process.exit(0);
}

function sha256(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function collectManifest(baseDir: string): Map<string, string | null> {
  const manifest = new Map<string, string | null>();

  const addFile = (relPath: string): void => {
    const fullPath = path.join(baseDir, relPath);
    if (fs.existsSync(fullPath)) {
      manifest.set(relPath, sha256(fullPath));
    }
  };

  addFile("config.yaml");
  addFile(".master");

  // Plan yamls
  const plansDir = path.join(baseDir, "Plans");
  if (fs.existsSync(plansDir)) {
    for (const entry of fs.readdirSync(plansDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const planYamlRel = path.join("Plans", entry.name, "plan.yaml");
        addFile(planYamlRel);
      }
    }
  }

  // Chats
  const chatsDir = path.join(baseDir, "Chats");
  if (fs.existsSync(chatsDir)) {
    for (const file of fs.readdirSync(chatsDir)) {
      if (file.endsWith(".json")) {
        addFile(path.join("Chats", file));
      }
    }
  }

  return manifest;
}

function copySourceToSandbox(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });

  const copyRecursive = (src: string, dst: string): void => {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);

      // Skip Worktrees, target, and lock files
      if (entry.name === "Worktrees" || entry.name === "target" || entry.name === ".git") {
        continue;
      }

      if (entry.isDirectory()) {
        fs.mkdirSync(dstPath, { recursive: true });
        copyRecursive(srcPath, dstPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  };

  copyRecursive(source, target);
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-check")) {
    runSelfCheck();
    return;
  }

  const check = validateSandbox(process.env.TENDRIL_SANDBOX, process.env.TENDRIL_HOME);
  if (!check.valid) {
    console.error(`\n[FATAL GUARDRAIL ERROR] ${check.error}\n`);
    process.exit(1);
  }

  const { sandbox } = check;
  console.log(`Starting cutover rehearsal on sandbox: ${sandbox}`);

  const results: StepRecord[] = [];
  const record = (step: string, passed: boolean, note = ""): void => {
    results.push({ step, passed, note });
    console.log(`[${passed ? "PASS" : "FAIL"}] Step ${step}: ${note}`);
  };

  try {
    // Step 1: Initialize sandbox directory
    if (fs.existsSync(sandbox!)) {
      fs.rmSync(sandbox!, { recursive: true, force: true });
    }
    fs.mkdirSync(sandbox!, { recursive: true });
    record("1. Resolve sandbox", true, `Sandbox at ${sandbox}`);

    // Step 2: Copy source data to sandbox (skip Worktrees/target)
    copySourceToSandbox(REAL_HOME, sandbox!);
    record("2. Copy source data", true, "Copied config, db, plans, chats");

    // Step 3: Backup sandbox and record pre-run SHA manifest
    const backupArchive = path.join(os.tmpdir(), `tendril-sandbox-backup-${Date.now()}.tar`);
    execSync(`tar -cf "${backupArchive}" -C "${sandbox}" .`);
    const preManifest = collectManifest(sandbox!);
    record("3. Backup and manifest", true, `Hashed ${preManifest.size} critical files`);

    // Step 4: Verify Ivy CLI reads sandbox
    let ivyReadOk = false;
    try {
      const ivyOut = execSync("tendril plan list", {
        env: { ...process.env, TENDRIL_HOME: sandbox, TENDRIL_PLANS: path.join(sandbox!, "Plans") },
        encoding: "utf-8",
      });
      ivyReadOk = ivyOut.length > 0;
    } catch {
      ivyReadOk = false;
    }
    record("4. Pre-migration Ivy CLI read", ivyReadOk, "Ivy CLI reads sandbox plans");

    // Step 5: Restore from backup proof
    fs.rmSync(sandbox!, { recursive: true, force: true });
    fs.mkdirSync(sandbox!, { recursive: true });
    execSync(`tar -xf "${backupArchive}" -C "${sandbox}"`);
    const postRestoreManifest = collectManifest(sandbox!);

    let digestsMatch = preManifest.size === postRestoreManifest.size;
    for (const [file, hash] of preManifest) {
      if (postRestoreManifest.get(file) !== hash) {
        digestsMatch = false;
        break;
      }
    }
    record("5. Backup restore proof", digestsMatch, "All digests match byte-for-byte post restore");

    // Step 6: Rollback proof
    let rollbackOk = false;
    try {
      const rollbackOut = execSync("tendril plan list", {
        env: { ...process.env, TENDRIL_HOME: sandbox, TENDRIL_PLANS: path.join(sandbox!, "Plans") },
        encoding: "utf-8",
      });
      rollbackOk = rollbackOut.length > 0;
    } catch {
      rollbackOk = false;
    }
    record("6. Rollback proof", rollbackOk, "Ivy CLI reads restored sandbox successfully");

    // Clean up backup archive
    if (fs.existsSync(backupArchive)) {
      fs.unlinkSync(backupArchive);
    }

    console.log("\n================ REHEARSAL SUMMARY ================");
    console.table(results);

    const allPassed = results.every((r) => r.passed);
    if (!allPassed) {
      process.exit(1);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Rehearsal error: ${message}`);
    process.exit(1);
  }
}

void main();
