import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateIssueDialog } from "../CreateIssueDialog";
import { bridge } from "../../../api/bridge";
import { planDetail } from "../../../../tests/fixtures/plan.fixture";

const plan = planDetail({
  id: "00021",
  state: "Draft",
  repos: ["/repos/Tendril-App", "/repos/Tendril-Service"],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CreateIssueDialog", () => {
  it("populates the repository select from the plan's repos", () => {
    render(<CreateIssueDialog isOpen onClose={vi.fn()} plan={plan} />);

    const select = screen.getByLabelText("Repository") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      "/repos/Tendril-App",
      "/repos/Tendril-Service",
    ]);
    expect(select.value).toBe("/repos/Tendril-App");
  });

  it("falls back to the project's repos when the plan records none", () => {
    render(
      <CreateIssueDialog
        isOpen
        onClose={vi.fn()}
        plan={planDetail({ id: "00021", repos: [] })}
        projectRepos={["/repos/FromProject"]}
      />,
    );

    const select = screen.getByLabelText("Repository") as HTMLSelectElement;
    expect(select.value).toBe("/repos/FromProject");
  });

  it("explains itself and blocks submission when there is nowhere to run gh", () => {
    render(
      <CreateIssueDialog isOpen onClose={vi.fn()} plan={planDetail({ id: "00021", repos: [] })} />,
    );

    expect(screen.getByTestId("create-issue-no-repos")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-confirm")).toBeDisabled();
  });

  it("dispatches CreateIssue with the repo path, assignee, labels and comment", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });
    const onJobStarted = vi.fn();

    render(<CreateIssueDialog isOpen onClose={vi.fn()} plan={plan} onJobStarted={onJobStarted} />);

    fireEvent.change(screen.getByLabelText("Repository"), {
      target: { value: "/repos/Tendril-Service" },
    });
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: " octocat " } });
    fireEvent.change(screen.getByLabelText("Labels"), { target: { value: "bug, ui" } });
    fireEvent.change(screen.getByLabelText("Comment"), { target: { value: "Seen in review" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "CreateIssue",
        folderPath: "00021",
        repo: "/repos/Tendril-Service",
        assignee: "octocat",
        comment: "Seen in review",
        labels: ["bug", "ui"],
      }),
    );
    await waitFor(() =>
      expect(onJobStarted).toHaveBeenCalledWith({ jobId: "03007", status: "Queued" }),
    );
  });

  it("omits the optional fields left blank", async () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });

    render(<CreateIssueDialog isOpen onClose={vi.fn()} plan={plan} />);
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(startJob).toHaveBeenCalledWith({
        type: "CreateIssue",
        folderPath: "00021",
        repo: "/repos/Tendril-App",
      }),
    );
  });

  it("dispatches nothing until confirmed", () => {
    const startJob = vi
      .spyOn(bridge, "startJob")
      .mockResolvedValue({ jobId: "03007", status: "Queued" });

    render(<CreateIssueDialog isOpen onClose={vi.fn()} plan={plan} />);
    fireEvent.change(screen.getByLabelText("Labels"), { target: { value: "bug" } });

    expect(startJob).not.toHaveBeenCalled();
  });
});
