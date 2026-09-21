import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { bridge } from "../src/api/bridge";

/**
 * The two project mutations that `PUT /api/config` cannot express.
 *
 * `update_config_raw` merges the root `projects` sequence **by name**, which makes both of these
 * unreachable through `putConfig`: a renamed entry matches nothing and is appended beside the
 * original (two projects where there was one), and an omitted entry is read as unchanged rather
 * than deleted. So the project settings screen had a disabled Rename pencil and a disabled Remove
 * button until these wrappers existed.
 *
 * Three mutations now, because the Danger Zone's single "Delete Project" was two actions wearing
 * one name: `removeProject` forgets the project and `deleteProjectData` deletes it. They are
 * separate routes rather than a flag, so that the irreversible one cannot be reached by getting a
 * boolean wrong - and separate commands, which is what the assertions below actually pin.
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

describe("removeProject", () => {
  it("calls the remove command with the project name", async () => {
    invokeMock.mockResolvedValue({ message: "Project 'gone' removed" });

    await expect(bridge.removeProject("gone")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("cmd_remove_project", { name: "gone" });
  });

  it("propagates a refusal rather than swallowing it", async () => {
    invokeMock.mockRejectedValue(new Error("Failed to remove project (404): not found"));

    await expect(bridge.removeProject("ghost")).rejects.toThrow("404");
  });

  /*
   * The whole point of the split is that these two are different calls, so the harmless one must
   * not be able to reach the route that deletes. `cmd_remove_project` hits `DELETE
   * /api/projects/:name`, which contains no `fs::` call; `cmd_delete_project_data` hits
   * `/data`, which removes plan folders and the project directory. One wrong command name here and
   * the button labelled Remove would erase repositories.
   */
  it("never reaches the destructive command", async () => {
    invokeMock.mockResolvedValue({});

    await bridge.removeProject("gone");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalledWith("cmd_delete_project_data", expect.anything());
  });
});

describe("deleteProjectData", () => {
  it("calls the destructive command with the project name", async () => {
    invokeMock.mockResolvedValue({ message: "Project 'gone' deleted", plansDeleted: 3 });

    await expect(bridge.deleteProjectData("gone")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("cmd_delete_project_data", { name: "gone" });
  });

  /* 409 is the daemon refusing to delete a worktree out from under a running job. It has to reach
     the dialog intact - the answer is to stop the job, not to press the button again. */
  it("propagates a refusal rather than swallowing it", async () => {
    invokeMock.mockRejectedValue(
      new Error("Failed to delete project data (409): job #1184 is still running"),
    );

    await expect(bridge.deleteProjectData("busy")).rejects.toThrow("409");
  });
});
