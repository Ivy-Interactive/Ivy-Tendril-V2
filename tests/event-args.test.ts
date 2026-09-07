import { describe, it, expect } from "vitest";
import { firstStringArg } from "../src/utils/eventArgs";

describe("firstStringArg", () => {
  it("returns the first argument when it is a string", () => {
    expect(firstStringArg(["hello"])).toBe("hello");
  });

  it("returns an empty string as-is, not undefined", () => {
    expect(firstStringArg([""])).toBe("");
  });

  it("returns undefined when the first argument is an object", () => {
    expect(firstStringArg([{ value: "x" }])).toBeUndefined();
  });

  it("returns undefined when the first argument is a number", () => {
    expect(firstStringArg([42])).toBeUndefined();
  });

  it("returns undefined when args is undefined", () => {
    expect(firstStringArg(undefined)).toBeUndefined();
  });

  it("returns undefined when args is an empty array", () => {
    expect(firstStringArg([])).toBeUndefined();
  });
});
