import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { bridge } from "../src/api/bridge";

/**
 * The two project mutations that `PUT /api/config` cannot express.
 *
 * `update_config_raw` merges the root `projects` sequence **by name**, which makes both of these
 * unreachable through `putConfig`: a renamed entry matches nothing and is appended beside the
 * original (two projects where there was one), and an omitted entry is read as unchanged rather
 * than deleted. So the project settings screen had a disabled Rename pencil and a disabled Delete
 * button until these wrappers existed.
 *
 * What is pinned here is the wiring, because that is what silently breaks: a Tauri command that is
 * written but never added to `invoke_handler` type-checks, builds, and fails only at runtime. These
 * assert the exact command names and argument shapes the Rust side registers.
 */

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

afterEach(() => {
  invokeMock.mockReset();
});

describe("renameProject", () => {
  it("calls the rename command with the daemon's own field name", async () => {
    invokeMock.mockResolvedValue({ name: "ivy-renamed" });

    const result = await bridge.renameProject("ivy-framework", "ivy-renamed");

    expect(invokeMock).toHaveBeenCalledWith("cmd_rename_project", {
      name: "ivy-framework",
      newName: "ivy-renamed",
    });
    expect(result).toBe("ivy-renamed");
  });

  /*
   * The daemon trims before it stores, so the name it echoes is the one that will match on the next
   * read — returning the caller's untrimmed string would leave the UI selecting a project that does
   * not exist under that spelling.
   */
  it("prefers the stored name over the requested one", async () => {
    invokeMock.mockResolvedValue({ name: "trimmed" });

    await expect(bridge.renameProject("old", "  trimmed  ")).resolves.toBe("trimmed");
  });

  /* A reply without a name is not worth failing over: the requested name is the best guess left. */
  it("falls back to the requested name when the reply carries none", async () => {
    invokeMock.mockResolvedValue({});

    await expect(bridge.renameProject("old", "new")).resolves.toBe("new");
  });

  it("propagates a refusal rather than swallowing it", async () => {
    invokeMock.mockRejectedValue(new Error("Failed to rename project (409): already exists"));

    await expect(bridge.renameProject("old", "taken")).rejects.toThrow("409");
  });
});

describe("deleteProject", () => {
  it("calls the delete command with the project name", async () => {
    invokeMock.mockResolvedValue({ message: "Project 'gone' removed" });

    await expect(bridge.deleteProject("gone")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("cmd_delete_project", { name: "gone" });
  });

  it("propagates a refusal rather than swallowing it", async () => {
    invokeMock.mockRejectedValue(new Error("Failed to delete project (404): not found"));

    await expect(bridge.deleteProject("ghost")).rejects.toThrow("404");
  });
});
