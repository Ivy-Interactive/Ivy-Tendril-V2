import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Tooltip } from "../src/components/ui/TuiTooltip";
import { readCssInlined } from "./read-css";

/**
 * The `wrapTrigger` wrapper is what a pointer lands on when the control it wraps is disabled and
 * lets the hover through (`disabled:pointer-events-none`, as `buttonVariant` does), so it has to say
 * "disabled" itself: otherwise the one state the tooltip exists for shows the default arrow. jsdom
 * resolves no cascade, so these pin the attribute and the base.css clause it relies on, not the
 * rendered cursor.
 */
describe("Tooltip wrapTrigger", () => {
  it("marks the wrapper disabled, and makes it the tab stop, only while the control is", () => {
    const { rerender } = render(
      <Tooltip content="Why" wrapTrigger triggerDisabled>
        <button type="button" disabled>
          Act
        </button>
      </Tooltip>,
    );
    const wrapper = screen.getByRole("button", { name: "Act" }).parentElement!;
    expect(wrapper.classList.contains("tui-tooltip-trigger-wrap")).toBe(true);
    expect(wrapper.getAttribute("data-disabled")).toBe("");
    expect(wrapper.getAttribute("tabindex")).toBe("0");

    rerender(
      <Tooltip content="Why" wrapTrigger triggerDisabled={false}>
        <button type="button">Act</button>
      </Tooltip>,
    );
    const enabledWrapper = screen.getByRole("button", { name: "Act" }).parentElement!;
    expect(enabledWrapper.hasAttribute("data-disabled")).toBe(false);
    expect(enabledWrapper.hasAttribute("tabindex")).toBe(false);
  });

  it("relies on base.css's data-disabled clause for the not-allowed cursor", () => {
    const css = readCssInlined(resolve(__dirname, "..", "src/styles/base.css")).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).toMatch(
      /\[data-disabled\]:not\(\[data-disabled="false"\]\)\s*\{\s*cursor:\s*not-allowed;/,
    );
  });
});
