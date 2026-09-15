import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UpdateNotice } from "../UpdateNotice";
import type { VersionInfo } from "../../types/api";

const makeInfo = (overrides: Partial<VersionInfo> = {}): VersionInfo => ({
  currentVersion: "1.0.0",
  latestVersion: "1.2.0",
  hasUpdate: true,
  lastChecked: "2026-09-14T00:00:00Z",
  ...overrides,
});

describe("UpdateNotice", () => {
  it("renders nothing when hasUpdate is false", () => {
    render(
      <UpdateNotice
        info={makeInfo({ hasUpdate: false })}
        dismissedVersion={null}
        onDismiss={vi.fn()}
        onCopyCommand={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
  });

  it("renders nothing when latestVersion equals dismissedVersion", () => {
    render(
      <UpdateNotice
        info={makeInfo()}
        dismissedVersion="1.2.0"
        onDismiss={vi.fn()}
        onCopyCommand={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
  });

  it("renders nothing when info is null", () => {
    render(
      <UpdateNotice
        info={null}
        dismissedVersion={null}
        onDismiss={vi.fn()}
        onCopyCommand={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("update-notice")).not.toBeInTheDocument();
  });

  it("renders both versions and calls onCopyCommand", () => {
    const onCopyCommand = vi.fn();
    render(
      <UpdateNotice
        info={makeInfo()}
        dismissedVersion={null}
        onDismiss={vi.fn()}
        onCopyCommand={onCopyCommand}
      />,
    );
    expect(screen.getByTestId("update-notice")).toHaveTextContent("v1.2.0");
    expect(screen.getByTestId("update-notice")).toHaveTextContent("v1.0.0");
    fireEvent.click(screen.getByText("Copy Command"));
    expect(onCopyCommand).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss with the latest version", () => {
    const onDismiss = vi.fn();
    render(
      <UpdateNotice
        info={makeInfo()}
        dismissedVersion={null}
        onDismiss={onDismiss}
        onCopyCommand={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledWith("1.2.0");
  });
});
