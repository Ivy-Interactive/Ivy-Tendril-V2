import { render, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import { ErrorDisplay } from "../src/components/ErrorDisplay";

describe("ErrorDisplay", () => {
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

  it("renders error title, message, and formatted stack trace", () => {
    const { container } = render(
      <ErrorDisplay
        title="NullReferenceException"
        message="Object reference not set"
        stackTrace="at Foo.Bar() in Foo.cs:line 1"
      />,
    );
    expect(container.textContent).toContain("NullReferenceException");
    expect(container.textContent).toContain("Object reference not set");
    expect(container.textContent).toContain("Foo.Bar()");
  });

  it("copies details to clipboard when button is clicked", async () => {
    const { container } = render(
      <ErrorDisplay title="CustomException" message="Detailed error message" />,
    );
    const copyButton = container.querySelector("button")!;
    expect(copyButton).not.toBeNull();

    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(writeText).toHaveBeenCalled();
  });
});
