import { describe, expect, it, afterEach, vi } from "vitest";
import { copyToClipboard } from "./clipboard";

const stubClipboard = (writeText: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
};

const stubExecCommand = (impl: () => boolean) => {
  document.execCommand = vi.fn(impl);
};

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  vi.restoreAllMocks();
});

describe("copyToClipboard", () => {
  it("resolves when navigator.clipboard.writeText succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyToClipboard("hello")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand and resolves when writeText rejects but the fallback copies", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    stubExecCommand(() => true);

    await expect(copyToClipboard("hello")).resolves.toBeUndefined();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    // The temporary textarea used for the fallback must not leak into the document.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("rejects when writeText rejects and execCommand reports no copy took place", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    stubExecCommand(() => false);

    await expect(copyToClipboard("hello")).rejects.toThrow(/could not copy/i);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("rejects when writeText rejects and execCommand itself throws", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    document.execCommand = vi.fn(() => {
      throw new Error("execCommand is not supported");
    });

    await expect(copyToClipboard("hello")).rejects.toThrow(/could not copy/i);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to execCommand when there is no navigator.clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    stubExecCommand(() => true);

    await expect(copyToClipboard("hello")).resolves.toBeUndefined();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });
});
