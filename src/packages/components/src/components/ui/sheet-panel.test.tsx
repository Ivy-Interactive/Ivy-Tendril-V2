import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SheetPanel } from "./sheet-panel";

/**
 * `SheetPanel` is the chrome the app's detail sheets share, so what is pinned here is what each of
 * them used to spell out, and where the copies had drifted. Layout itself is invisible to jsdom, so
 * the width ladder and the single rule are asserted as classes.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SheetPanel", () => {
  it("renders the title, description and actions in a sheet at UxHelper.SheetWidth", () => {
    render(
      <SheetPanel
        open
        onClose={() => {}}
        title="output.log"
        description="Artifacts/output.log"
        actions={<button type="button">Copy path</button>}
        data-testid="panel"
      >
        <p>build ok</p>
      </SheetPanel>,
    );

    const panel = screen.getByTestId("panel");
    expect(panel).toHaveClass("w-full", "sm:w-3/4", "lg:w-1/2", "xl:w-2/5", "p-0");
    const dialog = screen.getByRole("dialog", { name: "output.log" });
    expect(dialog).toHaveAccessibleDescription("Artifacts/output.log");
    expect(within(dialog).getByRole("heading", { name: "output.log" })).toHaveAttribute(
      "title",
      "output.log",
    );
    expect(within(dialog).getByRole("button", { name: "Copy path" })).toBeInTheDocument();
    expect(within(dialog).getByText("build ok")).toBeInTheDocument();
  });

  it("draws one rule under the header, not two", () => {
    render(
      <SheetPanel open onClose={() => {}} title="Report">
        body
      </SheetPanel>,
    );

    const layoutHeader = document.querySelector('[data-slot="header-layout-header"]');
    const header = document.querySelector('[data-slot="sheet-panel-header"]');
    expect(layoutHeader).toHaveClass("border-b");
    expect(header).not.toHaveClass("border-b");
  });

  it("scrolls the body in a plain box, so a wide child cannot widen the sheet", () => {
    render(
      <SheetPanel open onClose={() => {}} title="Report" bodyClassName="space-y-3">
        body
      </SheetPanel>,
    );

    const body = document.querySelector('[data-slot="sheet-panel-body"]');
    expect(body).toHaveClass("overflow-y-auto", "min-h-0", "px-6", "space-y-3");
    expect(body?.closest("[data-radix-scroll-area-viewport]")).toBeNull();
  });

  it("calls onClose from the close button and from Escape", () => {
    const onClose = vi.fn();
    render(
      <SheetPanel open onClose={onClose} title="Report">
        body
      </SheetPanel>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps a hidden description for assistive technology only", () => {
    render(
      <SheetPanel
        open
        onClose={() => {}}
        title="RustTest"
        description="Verification report details for RustTest"
        hideDescription
        titleAccessory={<span>Fail</span>}
      >
        body
      </SheetPanel>,
    );

    const dialog = screen.getByRole("dialog", { name: "RustTest" });
    expect(dialog).toHaveAccessibleDescription("Verification report details for RustTest");
    expect(within(dialog).getByText("Verification report details for RustTest")).toHaveClass(
      "sr-only",
    );
    expect(within(dialog).getByText("Fail")).toBeInTheDocument();
  });

  it("opts out of a description on purpose when it has none", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <SheetPanel open onClose={() => {}} title="Job Debug">
        body
      </SheetPanel>,
    );

    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("Description"));
  });

  it("renders nothing while closed", () => {
    render(
      <SheetPanel open={false} onClose={() => {}} title="Report" data-testid="panel">
        body
      </SheetPanel>,
    );

    expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
  });
});
