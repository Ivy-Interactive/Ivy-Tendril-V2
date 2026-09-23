import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { CreatePlanDialog } from "../src/components/Dialogs/CreatePlanDialog";
import { CreateIssueDialog } from "../src/components/Dialogs/CreateIssueDialog";
import { CreatePrDialog } from "../src/components/Dialogs/CreatePrDialog";
import { DirtyRepoDialog } from "../src/components/Dialogs/DirtyRepoDialog";
import { DeletePlanDialog } from "../src/components/Dialogs/PlanConfirmDialogs";
import { RecommendationNoteDialog } from "../src/components/Dialogs/RecommendationNoteDialog";
import { SyncRepoDialog } from "../src/components/Dialogs/SyncRepoDialog";
import { UpdatePlanDialog } from "../src/components/Dialogs/UpdatePlanDialog";

describe("CreatePlanDialog", () => {
  it("submits the trimmed description with the picked project", () => {
    const onSubmit = vi.fn();
    render(
      <CreatePlanDialog
        isOpen
        onClose={() => {}}
        projects={["Tendril", "Ivy"]}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Ivy" }));
    const textarea = screen.getByPlaceholderText("Enter task description...");
    fireEvent.change(textarea, { target: { value: "  Add dark mode  " } });
    fireEvent.click(screen.getByTitle("Create"));

    expect(onSubmit).toHaveBeenCalledWith("Add dark mode", "Ivy");
  });

  it("offers Chat with <agent> only when the caller can continue in chat", () => {
    const { unmount } = render(
      <CreatePlanDialog isOpen onClose={() => {}} projects={["Tendril"]} onSubmit={() => {}} />,
    );
    expect(screen.queryByTitle("More options")).toBeNull();
    unmount();

    const onContinueInChat = vi.fn();
    render(
      <CreatePlanDialog
        isOpen
        onClose={() => {}}
        projects={["Tendril"]}
        onSubmit={() => {}}
        agentLabel="Claude"
        onContinueInChat={onContinueInChat}
        initialDescription="Add dark mode"
      />,
    );
    fireEvent.click(screen.getByTitle("More options"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Chat with Claude" }));

    expect(onContinueInChat).toHaveBeenCalledWith("Add dark mode", "Tendril");
  });

  it("swaps an attached file's name for the path it was staged at", async () => {
    const onUploadFile = vi.fn(async () => "/home/.tendril/Attachments/abc/shot.png");
    const onSubmit = vi.fn();
    const { container } = render(
      <CreatePlanDialog
        isOpen
        onClose={() => {}}
        projects={["Tendril"]}
        onSubmit={onSubmit}
        onUploadFile={onUploadFile}
        initialDescription="Fix the header"
      />,
    );

    const input = within(container.ownerDocument.body)
      .getByTestId("new-plan-modal")
      .querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["png-bytes"], "shot.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() =>
      expect(onUploadFile).toHaveBeenCalledWith(expect.objectContaining({ name: "shot.png" })),
    );
    fireEvent.click(screen.getByTitle("Create"));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        "Fix the header [file: /home/.tendril/Attachments/abc/shot.png]",
        "Tendril",
      ),
    );
  });
});

describe("DirtyRepoDialog with Sync Repos", () => {
  const repos = [
    {
      path: "/repos/app",
      isDirty: true,
      changes: [" M src/main.rs", "?? notes.txt"],
      baseBranch: "development",
    },
  ];

  it("asks for a policy when there is local work, and hands the answer back", () => {
    const onSyncRepos = vi.fn();
    render(
      <DirtyRepoDialog
        isOpen
        onClose={() => {}}
        onProceed={() => {}}
        dirtyRepos={repos}
        purpose="createPlan"
        onSyncRepos={onSyncRepos}
      />,
    );

    expect(screen.getByTestId("guard-proceed").textContent).toContain("Create Without Syncing");
    fireEvent.click(screen.getByTestId("guard-sync-repos"));

    const policy = screen.getByTestId("sync-repo-dialog");
    // Both kinds of local work, and the one shared branch named.
    expect(within(policy).getByTestId("sync-repo-body")?.textContent).toContain(
      "How should SyncRepo handle your uncommitted changes and untracked files? Commits will be pushed to development",
    );
    fireEvent.click(screen.getByTestId("sync-repo-pull-request"));
    expect(onSyncRepos).toHaveBeenCalledWith("PullRequest");
  });

  it("offers no Sync Repos without a handler", () => {
    render(<DirtyRepoDialog isOpen onClose={() => {}} onProceed={() => {}} dirtyRepos={repos} />);
    expect(screen.queryByTestId("guard-sync-repos")).toBeNull();
    expect(screen.getByTestId("guard-proceed").textContent).toContain("Execute Anyway");
  });
});

describe("SyncRepoDialog", () => {
  it("never makes up a joined branch name when the repos differ", () => {
    render(
      <SyncRepoDialog
        isOpen
        onClose={() => {}}
        onSync={() => {}}
        baseBranches={["main", "development"]}
        hasUncommitted
        hasUntracked={false}
      />,
    );
    expect(screen.getByTestId("sync-repo-body")?.textContent).toContain("each repo's base branch");
  });
});

describe("RecommendationNoteDialog", () => {
  it("renders the recommendation as markdown and submits the trimmed note", () => {
    const onSubmit = vi.fn();
    render(
      <RecommendationNoteDialog
        isOpen
        title="Use tauri-driver"
        action="Accept"
        recommendationDescription={"Drive the **packaged** app."}
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const description = screen.getByTestId("rec-dialog-description");
    expect(description.querySelector("strong")?.textContent).toContain("packaged");

    fireEvent.change(screen.getByLabelText("Optional note"), { target: { value: "  Ship it " } });
    fireEvent.click(screen.getByTestId("rec-dialog-submit"));
    expect(onSubmit).toHaveBeenCalledWith("Ship it");
  });
});

describe("DeletePlanDialog icebox variant", () => {
  it("is a bare permanent-delete confirm", () => {
    render(
      <DeletePlanDialog
        isOpen
        onClose={() => {}}
        onConfirm={() => {}}
        planId="00412"
        variant="icebox"
      />,
    );
    expect(screen.queryByTestId("dialog-skip")).toBeNull();
    expect(screen.queryByTestId("dialog-archive")).toBeNull();
    expect(screen.getByTestId("delete-plan-dialog").textContent).toContain(
      "Are you sure you want to permanently delete plan #00412?",
    );
  });
});

describe("CreatePrDialog target branch and reviewers", () => {
  it("sends no base branch for the default, and the custom one when typed", () => {
    const onSubmit = vi.fn();
    render(
      <CreatePrDialog
        isOpen
        onClose={() => {}}
        planId="00412"
        defaultBranch="development"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("baseBranch");

    fireEvent.change(screen.getByLabelText("Target Branch"), {
      target: { value: "__custom_branch__" },
    });
    fireEvent.change(screen.getByPlaceholderText("Enter custom branch name..."), {
      target: { value: " release/2.0 " },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onSubmit.mock.calls[1][0]).toEqual(
      expect.objectContaining({ baseBranch: "release/2.0" }),
    );
  });

  it("picks reviewers from the list when one is given", () => {
    const onSubmit = vi.fn();
    render(
      <CreatePrDialog
        isOpen
        onClose={() => {}}
        planId="00412"
        reviewerOptions={["octocat", "hubot"]}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "hubot" }));
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onSubmit.mock.calls[0][0]).toEqual(expect.objectContaining({ reviewers: ["hubot"] }));
  });
});

describe("CreateIssueDialog pickers", () => {
  it("picks the assignee and labels from GitHub's lists", () => {
    const onSubmit = vi.fn();
    render(
      <CreateIssueDialog
        isOpen
        onClose={() => {}}
        planId="00412"
        repos={["/repos/app"]}
        assigneeOptions={["octocat"]}
        labelOptions={["bug", "ui"]}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "octocat" } });
    fireEvent.click(screen.getByRole("button", { name: "ui" }));
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ repo: "/repos/app", assignee: "octocat", labels: ["ui"] }),
    );
  });
});

describe("UpdatePlanDialog attachments", () => {
  it("shows the attach control only when the caller can stage files", () => {
    const { rerender } = render(
      <UpdatePlanDialog isOpen onClose={() => {}} planId="00412" onSubmit={() => {}} />,
    );
    expect(screen.queryByTestId("dialog-attach-files")).toBeNull();

    const onRemoveAttachment = vi.fn();
    rerender(
      <UpdatePlanDialog
        isOpen
        onClose={() => {}}
        planId="00412"
        onSubmit={() => {}}
        onAttachFiles={() => {}}
        onRemoveAttachment={onRemoveAttachment}
        attachments={[{ name: "shot.png", path: "/a/shot.png" }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove shot.png" }));
    expect(onRemoveAttachment).toHaveBeenCalledWith("/a/shot.png");
  });
});
