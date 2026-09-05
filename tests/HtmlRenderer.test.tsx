import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { HtmlRenderer } from "../src/components/HtmlRenderer";

describe("HtmlRenderer link handling", () => {
  it("renders custom protocol links when onLinkClick is provided", () => {
    const onLinkClick = vi.fn();
    const content = '<a href="plan://03290">Plan 03290</a>';
    const { container } = render(<HtmlRenderer content={content} onLinkClick={onLinkClick} />);

    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("plan://03290");
    expect(link?.textContent).toBe("Plan 03290");
  });

  it("replaces invalid custom protocols with # when onLinkClick is not provided", () => {
    const content = '<a href="plan://03290">Plan 03290</a>';
    const { container } = render(<HtmlRenderer content={content} />);

    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("#");
  });

  it("calls onLinkClick when link is clicked", () => {
    const onLinkClick = vi.fn();
    const content = '<a href="plan://03290">Plan 03290</a>';
    const { container } = render(<HtmlRenderer content={content} onLinkClick={onLinkClick} />);

    const link = container.querySelector("a")!;
    expect(link).not.toBeNull();
    fireEvent.click(link);

    expect(onLinkClick).toHaveBeenCalledTimes(1);
    expect(onLinkClick).toHaveBeenCalledWith("plan://03290");
  });
});
