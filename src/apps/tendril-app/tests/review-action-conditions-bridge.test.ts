import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { bridge } from "../src/api/bridge";

/**
 * The wiring behind the Review page's disabled review actions: a Tauri command that is written but
 * never registered in `invoke_handler` type-checks, builds, and fails only at runtime - where the bar
 * would quietly fall back to its own evaluator and every conditioned action would stay enabled. This
 * pins the command name and argument shape `cmd_get_review_action_conditions` takes.
 */

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

afterEach(() => {
  invokeMock.mockReset();
});

describe("getReviewActionConditions", () => {
  it("asks the daemon for one plan's verdicts through the registered command", async () => {
    const answer = [{ name: "Docs", condition: 'Test-Path "Worktrees/Repo"', state: "notMet" }];
    invokeMock.mockResolvedValue(answer);

    await expect(bridge.getReviewActionConditions("ivy-framework", "00509")).resolves.toEqual(
      answer,
    );
    expect(invokeMock).toHaveBeenCalledWith("cmd_get_review_action_conditions", {
      projectName: "ivy-framework",
      planId: "00509",
    });
  });

  it("propagates a refusal so the caller can fall back", async () => {
    invokeMock.mockRejectedValue(new Error("Failed to evaluate review action conditions (404)"));

    await expect(bridge.getReviewActionConditions("gone", "00001")).rejects.toThrow("404");
  });
});
