import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SortableVerificationList, type VerificationItem } from "./SortableVerificationList";

const sampleItems: VerificationItem[] = [
  { name: "NpmLint", enabled: true, required: true },
  { name: "NpmBuild", enabled: true, required: true },
  { name: "NpmTest", enabled: false, required: false },
];

describe("SortableVerificationList", () => {
  it("mounts and renders list items with drag handles", () => {
    render(<SortableVerificationList id="svl-1" itemsJson={JSON.stringify(sampleItems)} />);

    expect(screen.getByText("NpmLint")).toBeInTheDocument();
    expect(screen.getByText("NpmBuild")).toBeInTheDocument();
    expect(screen.getByText("NpmTest")).toBeInTheDocument();

    const handles = screen.getAllByRole("button", { name: "Drag handle" });
    expect(handles).toHaveLength(3);
  });

  it("shows Required checkbox only when item is enabled", () => {
    render(<SortableVerificationList id="svl-1" itemsJson={JSON.stringify(sampleItems)} />);

    const requiredLabels = screen.getAllByText("Required");
    // NpmLint and NpmBuild are enabled, NpmTest is disabled
    expect(requiredLabels).toHaveLength(2);
  });

  it("dispatches OnChange event when enabling an item", () => {
    const eventHandler = vi.fn();
    render(
      <SortableVerificationList
        id="svl-1"
        itemsJson={JSON.stringify(sampleItems)}
        events={["OnChange"]}
        eventHandler={eventHandler}
      />,
    );

    const testCheckbox = screen.getByText("NpmTest").closest("label")?.querySelector("input");
    expect(testCheckbox).not.toBeChecked();

    if (testCheckbox) {
      fireEvent.click(testCheckbox);
    }

    expect(eventHandler).toHaveBeenCalledWith("OnChange", "svl-1", [
      JSON.stringify({ name: "NpmTest", enabled: true, required: false }),
    ]);
  });

  it("handles malformed JSON gracefully by rendering an empty list", () => {
    render(<SortableVerificationList id="svl-1" itemsJson="invalid-json" />);
    expect(screen.queryByRole("button", { name: "Drag handle" })).toBeNull();
  });
});
