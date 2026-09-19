import * as assert from "assert";
import * as http from "http";
import * as vscode from "vscode";
import { COMMANDS } from "../../constants";
import { ServerManager } from "../../server/serverManager";
import { ServerHealthInfo } from "../../server/types";
import { SidebarProvider } from "../../views/sidebarProvider";
import { activate, awaitBackgroundInit, deactivate, getActiveServerManager } from "../../extension";
import { readStubInvocations, waitForMaster } from "../testHome";
const vscodeMock = vscode as any;

describe("Tendril Sidebar & Browser Action Suite", () => {
  describe("SidebarProvider quick actions", () => {
    it("should include both Open Dashboard and Open in Browser action items", async () => {
      const mockEmitter = new vscode.EventEmitter<ServerHealthInfo>();
      const mockServerManager = {
        onDidChangeState: mockEmitter.event,
        getHealthInfo: async (): Promise<ServerHealthInfo> => ({
          isAlive: true,
          port: 5000,
          pid: 12345,
          baseUrl: "http://localhost:5000",
          activeJobsCount: 1,
        }),
        getRecentPlans: async () => [],
      } as unknown as ServerManager;

      const provider = new SidebarProvider(mockServerManager);
      const items = await provider.getChildren();

      const actionItems = items.filter((item) => item.itemType === "action");
      const openDashboardItem = actionItems.find((item) => item.label === "Open Dashboard");
      const openInBrowserItem = actionItems.find((item) => item.label === "Open in Browser");

      assert.ok(openDashboardItem, "Open Dashboard action item must be present");
      assert.strictEqual(
        openDashboardItem?.command?.command,
        COMMANDS.openDashboard,
        "Open Dashboard must bind to tendril.openDashboard",
      );
      assert.ok(openDashboardItem?.iconPath instanceof vscode.ThemeIcon);
      assert.strictEqual(
        (openDashboardItem?.iconPath as vscode.ThemeIcon).id,
        "browser",
        "Open Dashboard must have browser icon",
      );

      assert.ok(openInBrowserItem, "Open in Browser action item must be present");
      assert.strictEqual(
        openInBrowserItem?.command?.command,
        COMMANDS.openInBrowser,
        "Open in Browser must bind to tendril.openInBrowser",
      );
      assert.ok(openInBrowserItem?.iconPath instanceof vscode.ThemeIcon);
      assert.strictEqual(
        (openInBrowserItem?.iconPath as vscode.ThemeIcon).id,
        "globe",
        "Open in Browser must have globe icon",
      );
    });

    it("should show both dashboard and browser items even when server is stopped", async () => {
      const mockEmitter = new vscode.EventEmitter<ServerHealthInfo>();
      const mockServerManager = {
        onDidChangeState: mockEmitter.event,
        getHealthInfo: async (): Promise<ServerHealthInfo> => ({
          isAlive: false,
          activeJobsCount: 0,
        }),
        getRecentPlans: async () => [],
      } as unknown as ServerManager;

      const provider = new SidebarProvider(mockServerManager);
      const items = await provider.getChildren();

      const openDashboardItem = items.find((item) => item.label === "Open Dashboard");
      const openInBrowserItem = items.find((item) => item.label === "Open in Browser");

      assert.ok(openDashboardItem, "Open Dashboard should still appear when server offline");
      assert.ok(openInBrowserItem, "Open in Browser should still appear when server offline");
    });
  });

  describe("Command execution", () => {
    let originalEnsure: typeof ServerManager.prototype.ensureServerRunning;

    beforeEach(async () => {
      originalEnsure = ServerManager.prototype.ensureServerRunning;
      vscodeMock.env.lastOpenedUri = undefined;
      vscodeMock.window.lastErrorMessage = undefined;

      const subscriptions: vscode.Disposable[] = [];
      const context = {
        subscriptions,
        extensionUri: vscode.Uri.file("/mock/path"),
      } as unknown as vscode.ExtensionContext;

      await activate(context);
    });

    afterEach(async () => {
      ServerManager.prototype.ensureServerRunning = originalEnsure;
      // Let the fire-and-forget auto-start finish before disposing, so no spawned server outlives
      // this test as an orphan holding the .master claim.
      await awaitBackgroundInit();
      await deactivate();
    });

    it("should open external browser with baseUrl on openInBrowser", async () => {
      // A real listener that answers HTML, because the command now confirms the daemon actually
      // serves a dashboard before opening a tab at it.
      const uiServer = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!DOCTYPE html><html><body>Tendril</body></html>");
      });
      const port = await new Promise<number>((resolve) => {
        uiServer.listen(0, "127.0.0.1", () => {
          const address = uiServer.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      });
      const baseUrl = `http://127.0.0.1:${port}`;

      ServerManager.prototype.ensureServerRunning = async () => ({
        port,
        pid: 9999,
        baseUrl,
        host: "127.0.0.1",
        scheme: "http",
      });

      try {
        await vscode.commands.executeCommand(COMMANDS.openInBrowser);
      } finally {
        await new Promise<void>((resolve) => uiServer.close(() => resolve()));
      }

      const openedUri = vscodeMock.env.lastOpenedUri as { fsPath?: string } | undefined;
      assert.ok(openedUri, "External URI must be opened");
      assert.strictEqual(openedUri?.toString(), baseUrl);
      assert.strictEqual(vscodeMock.window.lastErrorMessage, undefined);
    });

    it("should report that the daemon serves no dashboard instead of opening a 404", async () => {
      // The V2 daemon registers API routes only: `GET /` is a bare 404, so V1's "open the server
      // root" behaviour transplanted unchanged would show an empty page and say nothing.
      const apiOnly = http.createServer((_req, res) => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end('{"error":"Not Found"}');
      });
      const port = await new Promise<number>((resolve) => {
        apiOnly.listen(0, "127.0.0.1", () => {
          const address = apiOnly.address();
          resolve(typeof address === "object" && address ? address.port : 0);
        });
      });
      const baseUrl = `http://127.0.0.1:${port}`;

      ServerManager.prototype.ensureServerRunning = async () => ({
        port,
        pid: 9999,
        baseUrl,
        host: "127.0.0.1",
        scheme: "http",
      });

      try {
        await vscode.commands.executeCommand(COMMANDS.openInBrowser);
      } finally {
        await new Promise<void>((resolve) => apiOnly.close(() => resolve()));
      }

      assert.strictEqual(vscodeMock.env.lastOpenedUri, undefined);
      assert.ok(
        vscodeMock.window.lastErrorMessage?.includes("does not serve a web dashboard"),
        `Expected an explanatory message, got: ${vscodeMock.window.lastErrorMessage}`,
      );
    });

    it("should show error message if ensureServerRunning throws", async () => {
      ServerManager.prototype.ensureServerRunning = async () => {
        throw new Error("Server failed to start");
      };

      await vscode.commands.executeCommand(COMMANDS.openInBrowser);

      assert.strictEqual(vscodeMock.env.lastOpenedUri, undefined);
      assert.ok(vscodeMock.window.lastErrorMessage?.includes("Failed to open Tendril in browser"));
      assert.ok(vscodeMock.window.lastErrorMessage?.includes("Server failed to start"));
    });
  });

  describe("Activation auto-start isolation", function () {
    this.timeout(30000);

    const isolatedHome = process.env.TENDRIL_HOME as string;
    let invocationsBefore = 0;

    beforeEach(async () => {
      invocationsBefore = readStubInvocations(isolatedHome).length;

      const subscriptions: vscode.Disposable[] = [];
      const context = {
        subscriptions,
        extensionUri: vscode.Uri.file("/mock/path"),
      } as unknown as vscode.ExtensionContext;

      await activate(context);
      await awaitBackgroundInit();
    });

    afterEach(async () => {
      await deactivate();
    });

    it("should auto-start the stub executable pinned to the isolated Tendril home", () => {
      const allInvocations = readStubInvocations(isolatedHome);
      const newInvocations = allInvocations.slice(invocationsBefore);
      const newServerInvocations = newInvocations.filter((i) => i.mode === "server");

      assert.ok(
        newServerInvocations.length > 0,
        "This activation must have spawned the stub server (the real activation path is under test)",
      );
      for (const invocation of allInvocations.filter((i) => i.mode === "server")) {
        assert.strictEqual(
          invocation.tendrilHome,
          isolatedHome,
          "Every spawned server must inherit the isolated TENDRIL_HOME",
        );
      }
    });

    it("should write .master under the isolated home, never the real one", async () => {
      let master;
      try {
        master = await waitForMaster(isolatedHome);
      } catch (err: unknown) {
        const lastStartupError = getActiveServerManager()?.lastStartupError;
        const suffix = lastStartupError ? ` Last startup error: ${lastStartupError.message}` : "";
        throw new Error(`${err instanceof Error ? err.message : String(err)}${suffix}`);
      }

      assert.ok(master.port > 0, "Stub server must record its port");
      assert.notStrictEqual(master.pid, process.pid, ".master must belong to the spawned stub");
    });
  });
});
