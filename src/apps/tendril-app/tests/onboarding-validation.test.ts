import { describe, it, expect } from "vitest";
import {
  classifyRepoPath,
  describeProjectNameError,
  extractRepoName,
  isValidProjectName,
  isValidRepoPath,
  normalizeRepoPath,
  sanitizeProjectName,
} from "../src/views/onboarding/validation";

/**
 * Parity cases for the two V1 helpers the wizard depends on:
 * `Helpers/InputSanitizer.cs` and `Helpers/RepoPathValidator.cs`.
 */
describe("project name rules (InputSanitizer)", () => {
  it.each([
    ["my project", "myproject"],
    ["Ivy-Tendril_V2.1", "Ivy-Tendril_V2.1"],
    ["repos/tendril", "repostendril"],
    ["", ""],
  ])("sanitizes %j to %j", (input, expected) => {
    expect(sanitizeProjectName(input)).toBe(expected);
  });

  it.each(["Tendril", "a.b-c_d", "1"])("accepts %j", (name) => {
    expect(isValidProjectName(name)).toBe(true);
  });

  it.each(["", "   ", ".", "..", "a/b", "a b"])("rejects %j", (name) => {
    expect(isValidProjectName(name)).toBe(false);
  });

  it("describes the error with a suggestion, as V1 does", () => {
    expect(describeProjectNameError("my project")).toBe(
      "Invalid project name 'my project'. Use only letters, digits, dots, dashes and underscores (no slashes or spaces). Suggested: 'myproject'.",
    );
    // Nothing salvageable, so no suggestion clause.
    expect(describeProjectNameError("///")).toBe(
      "Invalid project name '///'. Use only letters, digits, dots, dashes and underscores (no slashes or spaces).",
    );
    expect(describeProjectNameError("Tendril")).toBeNull();
  });
});

describe("repository path rules (RepoPathValidator)", () => {
  it.each([
    ["/repos/tendril", "local"],
    ["~/repos/tendril", "local"],
    ["C:\\repos\\tendril", "local"],
    ["git@github.com:Ivy-Interactive/Ivy-Tendril.git", "ssh"],
    ["https://github.com/Ivy-Interactive/Ivy-Tendril", "http"],
    ["tendril", "invalid"],
    ["../tendril", "invalid"],
    ["", "invalid"],
  ])("classifies %j as %s", (input, kind) => {
    expect(classifyRepoPath(input)).toBe(kind);
    expect(isValidRepoPath(input)).toBe(kind !== "invalid");
  });

  it("lowercases only the scheme and host of a URL", () => {
    expect(normalizeRepoPath("HTTPS://GitHub.com/Ivy-Interactive/Ivy-Tendril")).toBe(
      "https://github.com/Ivy-Interactive/Ivy-Tendril",
    );
    expect(normalizeRepoPath("  GIT@GitHub.com:Ivy/Tendril.git ")).toBe(
      "git@github.com:Ivy/Tendril.git",
    );
    // A local path keeps its case: it is a filesystem path, not a URL.
    expect(normalizeRepoPath(" /Repos/Tendril ")).toBe("/Repos/Tendril");
  });

  it.each([
    ["/repos/tendril", "tendril"],
    ["/repos/tendril/", "tendril"],
    ["C:\\repos\\tendril", "tendril"],
    ["git@github.com:Ivy-Interactive/Ivy-Tendril.git", "Ivy-Tendril"],
    ["https://github.com/Ivy-Interactive/Ivy-Tendril.git", "Ivy-Tendril"],
  ])("extracts the repo name from %j", (input, expected) => {
    expect(extractRepoName(input)).toBe(expected);
  });
});
