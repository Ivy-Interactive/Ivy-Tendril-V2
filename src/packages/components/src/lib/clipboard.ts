/**
 * Copies `text` to the clipboard, preferring the async Clipboard API and falling back to
 * `document.execCommand("copy")` only when that API is missing or rejects (an iframe or a webview
 * without clipboard permission, say).
 *
 * Rejects rather than resolving on a copy that did not happen: the fallback's `execCommand` return
 * value is a real signal, not a formality, and swallowing a `false` here left every caller's error
 * UX unreachable and its success UX (a "Copied" toast, a checkmark) firing on a failed copy.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (writeTextError) {
    const activeElement = document.activeElement;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position: fixed; opacity: 0;";
    document.body.appendChild(textarea);
    textarea.select();

    let copied: boolean;
    try {
      copied = document.execCommand("copy");
    } catch (execCommandError) {
      document.body.removeChild(textarea);
      if (activeElement instanceof HTMLElement) activeElement.focus();
      throw new Error("Could not copy to the clipboard.", { cause: execCommandError });
    }

    document.body.removeChild(textarea);
    if (activeElement instanceof HTMLElement) activeElement.focus();
    if (!copied) {
      throw new Error("Could not copy to the clipboard.", { cause: writeTextError });
    }
  }
}

/** Names a browser gives a clipboard blob that carries no filename of its own. */
const UNNAMED_CLIPBOARD_BLOBS = new Set(["", "image.png", "blob"]);

export interface ClipboardFilesOptions {
  /** Stem for the name given to an unnamed blob. Defaults to `screenshot`. */
  namePrefix?: string;
}

/**
 * The files carried by a paste, read from `items` in preference to `files`.
 *
 * HTML defines `DataTransfer.files` as *derived from* the item list -- "for each item in the drag data
 * store item list whose kind is File, add the item's data ... to L" -- so `items` filtered to kind
 * `"file"` can never hold fewer files than `files` does. Reading `items` first is therefore a superset
 * and never a second opinion, which matters for an image put on the clipboard by a screenshot tool
 * rather than copied from a file: that arrives as an item of kind `"file"`, and a reader that consults
 * only `files` can come away with nothing. `files` stays as the fallback for anything that does not
 * populate `items`.
 *
 * An unnamed blob is renamed rather than left as `image.png`, because the name is what the attachment
 * is keyed, previewed and de-duplicated by -- two pasted screenshots must not collide on one name.
 */
export function clipboardFiles(
  data: DataTransfer | null | undefined,
  { namePrefix = "screenshot" }: ClipboardFilesOptions = {},
): File[] {
  if (!data) return [];

  const fromItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  // Not merged with `files`: `getAsFile()` mints a fresh `File` per call while `files` reuses one, so a
  // merge could not tell the two views of a single image apart and would attach it twice.
  const source = fromItems.length > 0 ? fromItems : Array.from(data.files ?? []);

  return source.map((file, index) => {
    const type = file.type || "image/png";
    if (!UNNAMED_CLIPBOARD_BLOBS.has((file.name ?? "").trim())) return file;
    const ext = type.split("/")[1] || "png";
    return new File([file], `${namePrefix}_${Date.now()}_${index}.${ext}`, { type });
  });
}
