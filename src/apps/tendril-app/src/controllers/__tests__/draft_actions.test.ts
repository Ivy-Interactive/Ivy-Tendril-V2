import { describe, it, expect } from "vitest";
import { draftActions } from "../draft_actions";
import { planDetail } from "../../../tests/fixtures/plan.fixture";

function availableIds(plan: Parameters<ReturnType<typeof draftActions>[0]["isAvailable"]>[0]) {
  return draftActions()
    .filter((action) => action.isAvailable(plan))
    .map((action) => action.id);
}

describe("draftActions", () => {
  it("offers the full set for a Draft plan", () => {
    const ids = availableIds(planDetail({ state: "Draft", dependsOn: [] }));

    expect(ids).toEqual([
      "execute",
      "update",
      "expand",
      "split",
      "createIssue",
      "copyId",
      "copyPath",
      "openFolder",
      "delete",
    ]);
  });

  it("withholds delete while a job holds the plan folder", () => {
    for (const state of ["Executing", "Creating", "Updating"] as const) {
      expect(availableIds(planDetail({ state, dependsOn: [] }))).not.toContain("delete");
    }
  });

  it("withholds the path actions when the plan folder is unknown", () => {
    const ids = availableIds(planDetail({ state: "Draft", dependsOn: [], folderPath: undefined }));

    expect(ids).not.toContain("copyPath");
    expect(ids).not.toContain("openFolder");
    expect(ids).toContain("copyId");
  });

  it("withholds execute for a Completed plan", () => {
    expect(availableIds(planDetail({ state: "Completed", dependsOn: [] }))).not.toContain(
      "execute",
    );
  });

  it("marks exactly one action primary and one destructive", () => {
    const actions = draftActions();

    expect(actions.filter((a) => a.variant === "primary").map((a) => a.id)).toEqual(["execute"]);
    expect(actions.filter((a) => a.variant === "destructive").map((a) => a.id)).toEqual(["delete"]);
  });
});
