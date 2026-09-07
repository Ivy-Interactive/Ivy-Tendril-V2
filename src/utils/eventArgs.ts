/** Narrows the first argument of a storybook `eventHandler` payload to a string. */
export const firstStringArg = (args?: unknown[]): string | undefined =>
  typeof args?.[0] === "string" ? args[0] : undefined;
