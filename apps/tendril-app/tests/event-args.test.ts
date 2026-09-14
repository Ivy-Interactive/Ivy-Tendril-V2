import { describe, it, expect } from "vitest";
import { firstStringArg, submitValueArg } from "../src/utils/eventArgs";

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

describe("submitValueArg", () => {
  it("reads value when present", () => {
    expect(submitValueArg([{ value: "hello" }])).toBe("hello");
  });

  it("falls back to Value when value is absent", () => {
    expect(submitValueArg([{ Value: "hello" }])).toBe("hello");
  });

  it("prefers value over Value when both are present", () => {
    expect(submitValueArg([{ value: "lower", Value: "upper" }])).toBe("lower");
  });

  it("returns undefined when the first argument is a string", () => {
    expect(submitValueArg(["hello"])).toBeUndefined();
  });

  it("returns undefined when the first argument is null", () => {
    expect(submitValueArg([null])).toBeUndefined();
  });

  it("returns undefined when args is undefined", () => {
    expect(submitValueArg(undefined)).toBeUndefined();
  });

  it("returns undefined when args is an empty array", () => {
    expect(submitValueArg([])).toBeUndefined();
  });

  it("returns undefined when the payload's value is not a string", () => {
    expect(submitValueArg([{ value: 42, Value: 42 }])).toBeUndefined();
  });
});
