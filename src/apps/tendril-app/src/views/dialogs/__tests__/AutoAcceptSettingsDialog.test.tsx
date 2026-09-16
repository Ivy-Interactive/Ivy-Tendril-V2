import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AutoAcceptSettingsDialog } from "../AutoAcceptSettingsDialog";
import { bridge } from "../../../api/bridge";
import type { SweepReport, TendrilConfig } from "../../../types/api";

function config(overrides: Partial<TendrilConfig> = {}): TendrilConfig {
  return { codingAgent: "claude", ...overrides };
}

function sweep(overrides: Partial<SweepReport> = {}): SweepReport {
  return { imported: [], accepted: 0, skipped: 0, errors: [], outcome: "Ran", ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AutoAcceptSettingsDialog", () => {
  it("seeds both controls from the saved config", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(
      config({ inbox: { autoAcceptAssignedIssues: true, checkIntervalMinutes: 30 } }),
    );

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByLabelText("Auto-Accept Assigned Issues")).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect((screen.getByLabelText("Check Interval") as HTMLSelectElement).value).toBe("30");
  });

  it("offers V1's five intervals and nothing else", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config());

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} />);

    const select = (await screen.findByLabelText("Check Interval")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["5", "10", "15", "30", "60"]);
  });

  it("writes both keys in one inbox patch, so an unknown inbox key survives", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(
      config({ inbox: { autoAcceptAssignedIssues: false, checkIntervalMinutes: 15 } }),
    );
    const putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);
    const onClose = vi.fn();
    const onSaved = vi.fn();

    render(<AutoAcceptSettingsDialog isOpen onClose={onClose} onSaved={onSaved} />);

    const toggle = await screen.findByLabelText("Auto-Accept Assigned Issues");
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Check Interval"), { target: { value: "60" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(putConfig).toHaveBeenCalledWith("inbox", {
        autoAcceptAssignedIssues: true,
        checkIntervalMinutes: 60,
      }),
    );
    expect(putConfig).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("writes nothing when the dialog is cancelled", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config());
    const putConfig = vi.spyOn(bridge, "putConfig").mockResolvedValue(undefined);

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText("Auto-Accept Assigned Issues"));
    fireEvent.click(screen.getByTestId("dialog-cancel"));

    expect(putConfig).not.toHaveBeenCalled();
  });

  it("runs a check on demand and reports what it did", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config());
    const checkInbox = vi
      .spyOn(bridge, "checkInbox")
      .mockResolvedValue(sweep({ skipped: 2, outcome: "Ran" }));
    const onChecked = vi.fn();

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} onChecked={onChecked} />);

    fireEvent.click(await screen.findByTestId("auto-accept-check-now"));

    await waitFor(() => expect(checkInbox).toHaveBeenCalled());
    expect(await screen.findByTestId("auto-accept-check-summary")).toHaveTextContent(
      "Imported 0, skipped 2.",
    );
    expect(onChecked).toHaveBeenCalled();
  });

  it("says so when a sweep is already running rather than claiming it imported nothing", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config());
    vi.spyOn(bridge, "checkInbox").mockResolvedValue(sweep({ outcome: "AlreadyRunning" }));

    render(<AutoAcceptSettingsDialog isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId("auto-accept-check-now"));

    expect(await screen.findByTestId("auto-accept-check-summary")).toHaveTextContent(
      "A check is already running.",
    );
  });

  it("surfaces a failed save and stays open", async () => {
    vi.spyOn(bridge, "getConfig").mockResolvedValue(config());
    vi.spyOn(bridge, "putConfig").mockRejectedValue(new Error("config.yaml is read-only"));
    const onClose = vi.fn();

    render(<AutoAcceptSettingsDialog isOpen onClose={onClose} />);

    fireEvent.click(await screen.findByTestId("dialog-confirm"));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("config.yaml is read-only"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
