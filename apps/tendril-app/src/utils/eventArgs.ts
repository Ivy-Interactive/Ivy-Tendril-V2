/** Narrows the first argument of a storybook `eventHandler` payload to a string. */
export const firstStringArg = (args?: unknown[]): string | undefined =>
  typeof args?.[0] === "string" ? args[0] : undefined;

/** Narrows the `value` of a storybook `OnSubmit` payload object to a string. */
export const submitValueArg = (args?: unknown[]): string | undefined => {
  const payload = args?.[0];
  if (typeof payload !== "object" || payload === null) return undefined;
  const { value, Value } = payload as { value?: unknown; Value?: unknown };
  if (typeof value === "string") return value;
  if (typeof Value === "string") return Value;
  return undefined;
};
