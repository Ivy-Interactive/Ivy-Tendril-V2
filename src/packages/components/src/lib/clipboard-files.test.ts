import { describe, expect, it } from "vitest";
import { clipboardFiles } from "./clipboard";

/**
 * `clipboardFiles` exists because reading `clipboardData.files` alone silently drops the exact case
 * the user hits most: a screenshot put on the clipboard by a capture tool. HTML derives `files` from
 * the drag data store item list ("for each item ... whose kind is File, add the item's data to L"),
 * so `items` filtered to kind `"file"` is a superset of `files` and never a disagreement with it.
 *
 * A `DataTransfer` cannot be constructed in jsdom with items on it, so these build the shape the DOM
 * hands a paste handler rather than the real class.
 */
const asDataTransfer = (parts: { items?: unknown[]; files?: File[] }) =>
  ({ items: parts.items ?? [], files: parts.files ?? [] }) as unknown as DataTransfer;

const imageItem = (file: File | null) => ({
  kind: "file",
  type: file?.type ?? "image/png",
  getAsFile: () => file,
});

describe("clipboardFiles", () => {
  // The regression this helper was written for.
  it("takes an image offered only through items, with files empty", () => {
    const shot = new File(["bytes"], "image.png", { type: "image/png" });

    const result = clipboardFiles(asDataTransfer({ items: [imageItem(shot)], files: [] }));

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("image/png");
  });

  it("falls back to files when the source populated no items", () => {
    const picked = new File(["bytes"], "diagram.png", { type: "image/png" });

    const result = clipboardFiles(asDataTransfer({ items: [], files: [picked] }));

    expect(result.map((f) => f.name)).toEqual(["diagram.png"]);
  });

  /**
   * `getAsFile()` mints a fresh `File` per call while `files` reuses one object, so the two views of a
   * single pasted image are not identity-comparable. Preferring items outright is what keeps one
   * screenshot from becoming two attachments.
   */
  it("attaches one file when both views describe the same image", () => {
    const shot = new File(["bytes"], "image.png", { type: "image/png" });

    const result = clipboardFiles(asDataTransfer({ items: [imageItem(shot)], files: [shot] }));

    expect(result).toHaveLength(1);
  });

  it("renames an unnamed blob so two pasted screenshots cannot collide", () => {
    const first = new File(["a"], "image.png", { type: "image/png" });
    const second = new File(["b"], "", { type: "image/png" });

    const result = clipboardFiles(asDataTransfer({ items: [imageItem(first), imageItem(second)] }));

    expect(result[0].name).not.toBe("image.png");
    expect(result[1].name).not.toBe("");
    expect(result[0].name).not.toBe(result[1].name);
    expect(result.every((f) => f.name.endsWith(".png"))).toBe(true);
  });

  it("keeps a name the source actually supplied", () => {
    const named = new File(["bytes"], "architecture.png", { type: "image/png" });

    const result = clipboardFiles(asDataTransfer({ items: [imageItem(named)] }));

    expect(result[0].name).toBe("architecture.png");
  });

  // A text paste must reach the textarea, so it has to come back as "no files" rather than as a blob.
  it("returns nothing for a text-only paste", () => {
    const stringItem = { kind: "string", type: "text/plain", getAsFile: () => null };

    expect(clipboardFiles(asDataTransfer({ items: [stringItem] }))).toEqual([]);
    expect(clipboardFiles(null)).toEqual([]);
    expect(clipboardFiles(undefined)).toEqual([]);
  });

  // `kind` is "file" but the item yields nothing -- guarded so the caller never sees a null entry.
  it("skips a file item that yields no file", () => {
    expect(clipboardFiles(asDataTransfer({ items: [imageItem(null)] }))).toEqual([]);
  });

  it("uses the caller's prefix for an unnamed blob", () => {
    const blob = new File(["b"], "blob", { type: "image/jpeg" });

    const result = clipboardFiles(asDataTransfer({ items: [imageItem(blob)] }), {
      namePrefix: "pasted",
    });

    expect(result[0].name).toMatch(/^pasted_\d+_0\.jpeg$/);
  });
});
