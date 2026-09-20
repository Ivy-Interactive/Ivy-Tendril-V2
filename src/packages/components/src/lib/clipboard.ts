export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position: fixed; opacity: 0;";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
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
