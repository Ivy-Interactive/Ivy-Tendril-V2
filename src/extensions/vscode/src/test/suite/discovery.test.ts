import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  authHeaders,
  discoverMaster,
  getMasterFilePath,
  isProcessAlive,
  padTendrilId,
  parseMasterJson,
  readApiKeyFromConfig,
  resolveTendrilHome,
} from "../../server/masterDiscovery";

/** A `.master` exactly as `write_master_info` in tendril-core's config.rs serializes one. */
function v2Master(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    port: 5010,
    pid: process.pid,
    secret: "bearer-secret-abc",
    startedAt: "2026-09-10T12:00:00Z",
    host: "127.0.0.1",
    version: "0.2.0",
    apiVersion: 1,
    capabilities: ["jobs", "plans", "projects", "ws", "auth_bearer", "auth_api_key"],
    scheme: "http",
    ...overrides,
  });
}

describe("Tendril Master Discovery Suite", () => {
  describe("parseMasterJson", () => {
    it("should parse a .master as the V2 daemon writes it", () => {
      const parsed = parseMasterJson(v2Master({ pid: 12345, port: 5011 }));

      assert.ok(parsed);
      assert.strictEqual(parsed.pid, 12345);
      assert.strictEqual(parsed.port, 5011);
      assert.strictEqual(parsed.host, "127.0.0.1");
      assert.strictEqual(parsed.scheme, "http");
      assert.strictEqual(parsed.secret, "bearer-secret-abc");
      assert.strictEqual(parsed.apiVersion, 1);
      assert.ok(parsed.capabilities?.includes("auth_bearer"));
    });

    it("should not require a heartbeat", () => {
      // V2 writes no heartbeat and never refreshes one. Requiring it (as V1's client did) rejects
      // every real V2 claim, which makes a running daemon permanently undiscoverable.
      const parsed = parseMasterJson(JSON.stringify({ pid: 4242, port: 5010 }));

      assert.ok(parsed, "A .master with no heartbeat must still parse");
      assert.strictEqual(parsed.pid, 4242);
    });

    it("should default host and scheme the way the daemons serde defaults do", () => {
      const parsed = parseMasterJson(JSON.stringify({ pid: 7, port: 5010 }));

      assert.ok(parsed);
      assert.strictEqual(parsed.host, "127.0.0.1");
      assert.strictEqual(parsed.scheme, "http");
    });

    it("should carry an https scheme through rather than assuming plaintext", () => {
      const parsed = parseMasterJson(v2Master({ scheme: "https" }));
      assert.strictEqual(parsed?.scheme, "https");
    });

    it("should accept the snake_case aliases the daemon declares", () => {
      const parsed = parseMasterJson(
        JSON.stringify({ pid: 9, port: 5010, started_at: "2026-01-01T00:00:00Z", api_version: 1 }),
      );

      assert.strictEqual(parsed?.startedAt, "2026-01-01T00:00:00Z");
      assert.strictEqual(parsed?.apiVersion, 1);
    });

    it("should return null for malformed JSON or a missing pid/port", () => {
      assert.strictEqual(parseMasterJson("invalid json"), null);
      assert.strictEqual(parseMasterJson("{}"), null);
      assert.strictEqual(parseMasterJson(JSON.stringify({ pid: 100 })), null);
      assert.strictEqual(parseMasterJson(JSON.stringify({ port: 5010 })), null);
    });
  });

  describe("authHeaders", () => {
    it("should send the .master secret as a bearer token", () => {
      // V1 sent the config.yaml api key in `x-api-key` and nothing else. The V2 daemon compares an
      // `X-Api-Key` against the .master secret, so that alone authenticates nothing.
      assert.deepStrictEqual(authHeaders({ secret: "s3cret" }), {
        Authorization: "Bearer s3cret",
      });
    });

    it("should add X-Api-Key alongside the bearer token when a key is configured", () => {
      // `api_key_middleware` sits outside `auth_middleware`, so a configured key is required in
      // addition to the bearer credential, not as an alternative to it.
      assert.deepStrictEqual(authHeaders({ secret: "s3cret", apiKey: "configured" }), {
        Authorization: "Bearer s3cret",
        "X-Api-Key": "configured",
      });
    });

    it("should send nothing when there is nothing to send", () => {
      assert.deepStrictEqual(authHeaders(undefined), {});
      assert.deepStrictEqual(authHeaders({}), {});
    });
  });

  describe("padTendrilId", () => {
    it("should zero-pad a numeric id to five digits", () => {
      // `GET /api/jobs/:id` is an exact `WHERE Id = ?` match in V2 where V1 padded server-side.
      assert.strictEqual(padTendrilId("458"), "00458");
      assert.strictEqual(padTendrilId("00458"), "00458");
      assert.strictEqual(padTendrilId(" 458 "), "00458");
      assert.strictEqual(padTendrilId("123456"), "123456");
    });

    it("should leave a non-numeric id alone", () => {
      assert.strictEqual(padTendrilId("abc"), "abc");
      assert.strictEqual(padTendrilId(""), "");
    });
  });

  describe("isProcessAlive", () => {
    it("should return true for current process PID", () => {
      assert.strictEqual(isProcessAlive(process.pid), true);
    });

    it("should return false for invalid or dead PIDs", () => {
      assert.strictEqual(isProcessAlive(0), false);
      assert.strictEqual(isProcessAlive(-1), false);
      assert.strictEqual(isProcessAlive(99999999), false);
    });
  });

  describe("resolveTendrilHome", () => {
    const originalEnv = process.env.TENDRIL_HOME;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.TENDRIL_HOME = originalEnv;
      } else {
        delete process.env.TENDRIL_HOME;
      }
    });

    it("should prioritize explicit override if provided", () => {
      const custom = "/custom/tendril/home";
      const resolved = resolveTendrilHome(custom);
      assert.strictEqual(resolved, path.resolve(custom));
    });

    it("should use TENDRIL_HOME environment variable when override is absent", () => {
      const envPath = "/env/tendril/home";
      process.env.TENDRIL_HOME = envPath;
      const resolved = resolveTendrilHome();
      assert.strictEqual(resolved, path.resolve(envPath));
    });

    it("should fall back to ~/.tendril when neither is provided", () => {
      delete process.env.TENDRIL_HOME;
      const resolved = resolveTendrilHome();
      assert.strictEqual(resolved, path.join(os.homedir(), ".tendril"));
    });
  });

  describe("discoverMaster file integration", () => {
    let tempDir: string;
    const originalConfigEnv = process.env.TENDRIL_CONFIG;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tendril-discovery-test-"));
      // The suite runs with TENDRIL_CONFIG pointed at the isolated home's config.yaml, and
      // `readApiKeyFromConfig` honours it the way the daemon does. Repoint it at this temp home so
      // these cases read the config they write.
      process.env.TENDRIL_CONFIG = path.join(tempDir, "config.yaml");
    });

    afterEach(() => {
      if (originalConfigEnv !== undefined) {
        process.env.TENDRIL_CONFIG = originalConfigEnv;
      } else {
        delete process.env.TENDRIL_CONFIG;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should return not_found when .master file does not exist", () => {
      const status = discoverMaster(tempDir);
      assert.strictEqual(status.status, "not_found");
    });

    it("should build the base URL from the recorded host, not from localhost", () => {
      fs.writeFileSync(getMasterFilePath(tempDir), v2Master({ port: 4567 }), "utf-8");

      const status = discoverMaster(tempDir, true);
      assert.strictEqual(status.status, "found");
      if (status.status === "found") {
        // `MasterInfo::base_url()` is `scheme://host:port`. `localhost` is a different address:
        // it resolves to ::1 first on a dual-stack machine and the daemon binds 127.0.0.1.
        assert.strictEqual(status.result.baseUrl, "http://127.0.0.1:4567");
        assert.strictEqual(status.result.host, "127.0.0.1");
        assert.strictEqual(status.result.secret, "bearer-secret-abc");
      }
    });

    it("should honour an https scheme in the base URL", () => {
      fs.writeFileSync(
        getMasterFilePath(tempDir),
        v2Master({ port: 4568, scheme: "https" }),
        "utf-8",
      );

      const status = discoverMaster(tempDir, true);
      assert.strictEqual(status.status, "found");
      if (status.status === "found") {
        assert.strictEqual(status.result.baseUrl, "https://127.0.0.1:4568");
      }
    });

    it("should report a dead process rather than a found server", () => {
      fs.writeFileSync(getMasterFilePath(tempDir), v2Master({ pid: 99999999 }), "utf-8");

      const status = discoverMaster(tempDir, true);
      assert.strictEqual(status.status, "dead_process");
    });

    it("should treat a live daemon as found no matter how old the claim is", () => {
      // There is no heartbeat in V2, so age carries no information and must not be inferred from
      // `startedAt`: a daemon up for a week is perfectly healthy.
      fs.writeFileSync(
        getMasterFilePath(tempDir),
        v2Master({ startedAt: "2020-01-01T00:00:00Z" }),
        "utf-8",
      );

      assert.strictEqual(discoverMaster(tempDir, true).status, "found");
    });

    it("should pick up api.apiKey from config.yaml when one is configured", () => {
      fs.writeFileSync(getMasterFilePath(tempDir), v2Master(), "utf-8");
      fs.writeFileSync(
        path.join(tempDir, "config.yaml"),
        ["api:", "  apiKey: test-secret-token", "theme: dark"].join("\n"),
        "utf-8",
      );

      assert.strictEqual(readApiKeyFromConfig(tempDir), "test-secret-token");

      const status = discoverMaster(tempDir, true);
      assert.strictEqual(status.status, "found");
      if (status.status === "found") {
        assert.deepStrictEqual(authHeaders(status.result), {
          Authorization: "Bearer bearer-secret-abc",
          "X-Api-Key": "test-secret-token",
        });
      }
    });

    it("should leave X-Api-Key off when no api key is configured", () => {
      fs.writeFileSync(getMasterFilePath(tempDir), v2Master(), "utf-8");
      fs.writeFileSync(path.join(tempDir, "config.yaml"), "theme: dark\n", "utf-8");

      const status = discoverMaster(tempDir, true);
      assert.strictEqual(status.status, "found");
      if (status.status === "found") {
        assert.strictEqual(status.result.apiKey, undefined);
      }
    });
  });
});
