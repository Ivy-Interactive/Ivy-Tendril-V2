import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  isValidRepoSlug,
  parseGitRemoteUrl,
  parseRepoFromArgs,
  resolveRepositorySlug,
  resolveRulesetPath,
} from "../scripts/protect-main.js";

describe("protect-main repository slug resolution", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("parseGitRemoteUrl", () => {
    it("parses HTTPS remote URLs with .git suffix", () => {
      const url = "https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git";
      expect(parseGitRemoteUrl(url)).toBe("Ivy-Interactive/Ivy-Tendril-V2");
    });

    it("parses HTTPS remote URLs without .git suffix", () => {
      const url = "https://github.com/Ivy-Interactive/Ivy-Tendril-V2";
      expect(parseGitRemoteUrl(url)).toBe("Ivy-Interactive/Ivy-Tendril-V2");
    });

    it("parses SSH remote URLs with .git suffix", () => {
      const url = "git@github.com:Ivy-Interactive/Ivy-Tendril-V2.git";
      expect(parseGitRemoteUrl(url)).toBe("Ivy-Interactive/Ivy-Tendril-V2");
    });

    it("parses SSH remote URLs without .git suffix", () => {
      const url = "git@github.com:Ivy-Interactive/Ivy-Tendril-V2";
      expect(parseGitRemoteUrl(url)).toBe("Ivy-Interactive/Ivy-Tendril-V2");
    });

    it("parses ssh:// protocol format URLs", () => {
      const url = "ssh://git@github.com/Ivy-Interactive/Ivy-Tendril-V2.git";
      expect(parseGitRemoteUrl(url)).toBe("Ivy-Interactive/Ivy-Tendril-V2");
    });

    it("parses git+https format URLs", () => {
      const url = "git+https://github.com/Ivy-Interactive/Ivy-Tendril-V2.git";
      expect(parseGitRemoteUrl(url)).toBe("Ivy-Interactive/Ivy-Tendril-V2");
    });

    it("returns null for non-GitHub URLs", () => {
      expect(parseGitRemoteUrl("https://gitlab.com/owner/repo.git")).toBeNull();
      expect(parseGitRemoteUrl("git@bitbucket.org:owner/repo.git")).toBeNull();
    });

    it("returns null for malformed or empty inputs", () => {
      expect(parseGitRemoteUrl("")).toBeNull();
      expect(parseGitRemoteUrl("not-a-url")).toBeNull();
    });
  });

  describe("isValidRepoSlug", () => {
    it("validates well-formed owner/repo slugs", () => {
      expect(isValidRepoSlug("Ivy-Interactive/Ivy-Tendril-V2")).toBe(true);
      expect(isValidRepoSlug("SpaceCorps/components-storybook")).toBe(true);
      expect(isValidRepoSlug("user.name/repo_123")).toBe(true);
    });

    it("rejects invalid slugs", () => {
      expect(isValidRepoSlug("")).toBe(false);
      expect(isValidRepoSlug("single-part")).toBe(false);
      expect(isValidRepoSlug("part1/part2/part3")).toBe(false);
      expect(isValidRepoSlug("owner/")).toBe(false);
      expect(isValidRepoSlug("/repo")).toBe(false);
      expect(isValidRepoSlug("owner /repo")).toBe(false);
      expect(isValidRepoSlug("owner/ repo")).toBe(false);
    });
  });

  describe("parseRepoFromArgs", () => {
    it("extracts slug from --repo flag with space", () => {
      expect(parseRepoFromArgs(["--repo", "owner/repo"])).toBe("owner/repo");
      expect(parseRepoFromArgs(["--other", "val", "--repo", "owner/repo"])).toBe("owner/repo");
    });

    it("extracts slug from --repo= format", () => {
      expect(parseRepoFromArgs(["--repo=owner/repo"])).toBe("owner/repo");
      expect(parseRepoFromArgs(["--flag", "--repo=owner/repo", "--extra"])).toBe("owner/repo");
    });

    it("returns empty string when --repo is passed without value", () => {
      expect(parseRepoFromArgs(["--repo"])).toBe("");
      expect(parseRepoFromArgs(["--repo", "--other"])).toBe("");
      expect(parseRepoFromArgs(["--repo="])).toBe("");
    });

    it("returns null when no --repo flag is present", () => {
      expect(parseRepoFromArgs([])).toBeNull();
      expect(parseRepoFromArgs(["--other", "value"])).toBeNull();
    });
  });

  describe("resolveRepositorySlug", () => {
    it("resolves slug from --repo CLI flag with space", () => {
      const slug = resolveRepositorySlug(["--repo", "CustomOrg/CustomRepo"]);
      expect(slug).toBe("CustomOrg/CustomRepo");
    });

    it("resolves slug from --repo= CLI flag", () => {
      const slug = resolveRepositorySlug(["--repo=CustomOrg/CustomRepo"]);
      expect(slug).toBe("CustomOrg/CustomRepo");
    });

    it("prefers CLI flag over GITHUB_REPOSITORY environment variable", () => {
      const slug = resolveRepositorySlug(["--repo", "FromArg/Repo"], {
        env: { GITHUB_REPOSITORY: "FromEnv/Repo" },
      });
      expect(slug).toBe("FromArg/Repo");
    });

    it("resolves slug from GITHUB_REPOSITORY environment variable when CLI flag is omitted", () => {
      const slug = resolveRepositorySlug([], {
        env: { GITHUB_REPOSITORY: "EnvOrg/EnvRepo" },
      });
      expect(slug).toBe("EnvOrg/EnvRepo");
    });

    it("resolves slug from git remote get-url origin when CLI flag and env var are omitted", () => {
      const mockExec = vi.fn().mockReturnValue("https://github.com/GitOrg/GitRepo.git\n");
      const slug = resolveRepositorySlug([], {
        env: {},
        exec: mockExec as any,
      });

      expect(slug).toBe("GitOrg/GitRepo");
      expect(mockExec).toHaveBeenCalledWith(
        "git",
        ["remote", "get-url", "origin"],
        expect.any(Object),
      );
    });

    it("falls back to GitHub CLI (gh repo view) when git remote fails", () => {
      const mockExec = vi.fn().mockImplementation((cmd: string) => {
        if (cmd === "git") {
          throw new Error("fatal: not a git repository");
        }
        if (cmd === "gh") {
          return "GhOrg/GhRepo\n";
        }
        throw new Error(`Unexpected command: ${cmd}`);
      });

      const slug = resolveRepositorySlug([], {
        env: {},
        exec: mockExec as any,
      });

      expect(slug).toBe("GhOrg/GhRepo");
    });

    it("gracefully outputs error and exits with code 1 when slug resolution fails", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const mockExec = vi.fn().mockImplementation(() => {
        throw new Error("command not available");
      });

      expect(() => {
        resolveRepositorySlug([], {
          env: {},
          exec: mockExec as any,
        });
      }).toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "ERROR: Could not resolve GitHub repository slug. Provide --repo <owner/repo> or set GITHUB_REPOSITORY.",
      );
    });

    it("gracefully outputs error and exits with code 1 when --repo provides an invalid slug", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        resolveRepositorySlug(["--repo", "invalid-slug-without-slash"]);
      }).toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "ERROR: Could not resolve GitHub repository slug. Provide --repo <owner/repo> or set GITHUB_REPOSITORY.",
      );
    });

    it("gracefully outputs error and exits with code 1 when GITHUB_REPOSITORY is invalid", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() => {
        resolveRepositorySlug([], {
          env: { GITHUB_REPOSITORY: "not-a-valid-slug" },
        });
      }).toThrow("process.exit called");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "ERROR: Could not resolve GitHub repository slug. Provide --repo <owner/repo> or set GITHUB_REPOSITORY.",
      );
    });
  });

  describe("resolveRulesetPath", () => {
    it("resolves ruleset path without error", () => {
      const path = resolveRulesetPath();
      expect(path).toContain("main-require-green-suite.json");
    });
  });
});
