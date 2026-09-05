import { render, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { CopyToClipboardButton } from "../src/components/CopyToClipboardButton";
import { DensityProvider } from "../src/contexts/density-context";
import { Densities } from "../src/types/density";

describe("CopyToClipboardButton", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText,
      },
      writable: true,
      configurable: true,
    });
  });

  it("renders copy button and writes text on click", async () => {
    const { container } = render(
      <CopyToClipboardButton textToCopy="hello world" label="Copy Text" />,
    );
    const button = container.querySelector("button")!;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Copy Text");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith("hello world");
  });

  it("inherits density from DensityProvider", () => {
    const { container } = render(
      <DensityProvider density={Densities.Small}>
        <CopyToClipboardButton textToCopy="test" />
      </DensityProvider>,
    );
    const button = container.querySelector("button")!;
    expect(button.className).toContain("size-7");
  });

  it("explicit density prop overrides provider", () => {
    const { container } = render(
      <DensityProvider density={Densities.Small}>
        <CopyToClipboardButton textToCopy="test" density={Densities.Large} />
      </DensityProvider>,
    );
    const button = container.querySelector("button")!;
    expect(button.className).toContain("size-11");
  });
});
