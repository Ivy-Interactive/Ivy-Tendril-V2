/**
 * Coercion helpers for reading `config.yaml` out of `TendrilConfig.raw`, which the daemon returns
 * unmodeled. They were inline in `SettingsView` and now live here because the per-project screens
 * read the same untyped subtrees.
 */

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export const asBool = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asStringMap = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

/** Newline-separated list <-> string array, matching how V1's `ToCodeInput` tool editors split. */
export const parseLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/**
 * `key=value` lines into a map. Blank lines and `#` comments are dropped and a line without `=` is
 * ignored rather than saved as an empty key, which is `EditProjectEnvFileDialog.ParseOverrides` and
 * the same shape every V1 env editor uses.
 */
export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** `EditProjectEnvFileDialog.FormatOverrides`. */
export const formatEnvLines = (env: Record<string, string>): string =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

/**
 * `normalize_enum_token`: an enum written as `Inherit General` or `inherit_general` by the .NET app
 * still resolves to the canonical spelling.
 */
export const oneOf = (value: unknown, options: string[], fallback: string): string => {
  const token = asString(value)
    .replace(/[\s_-]/g, "")
    .toLowerCase();
  return options.find((option) => option.toLowerCase() === token) ?? fallback;
};
