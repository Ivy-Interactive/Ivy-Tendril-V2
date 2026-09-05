import { expect, test } from "vite-plus/test";
import * as UI from "../src/index.ts";
import {
  PlanMarkdown,
  PlanDiffView,
  ContentInput,
  BadgeSelect,
  SortableVerificationList,
  TendrilDashboard,
  ActivityGrid,
  PillBars,
  TrendChart,
  HoverTip,
  WebViewer,
} from "../src/index.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("library exports core foundation symbols", () => {
  expect(typeof UI.cn).toBe("function");
  expect(typeof UI.ThemeProvider).toBe("function");
  expect(typeof UI.useTheme).toBe("function");
  expect(UI.ThemeContext).toBeDefined();
  expect(typeof UI.fn).toBe("function");
});

test("exports core primitives", () => {
  expect(UI.Button).toBeDefined();
  expect(UI.Checkbox).toBeDefined();
  expect(UI.Switch).toBeDefined();
  expect(UI.Tabs).toBeDefined();
  expect(UI.Accordion).toBeDefined();
  expect(UI.Dialog).toBeDefined();
  expect(UI.Slider).toBeDefined();
  expect(UI.Toggle).toBeDefined();
  expect(UI.toast).toBeDefined();
});

test("exports PlanMarkdown and PlanDiffView", () => {
  expect(PlanMarkdown).toBeDefined();
  expect(PlanDiffView).toBeDefined();
});

test("exports form and input components", () => {
  expect(ContentInput).toBeDefined();
  expect(BadgeSelect).toBeDefined();
  expect(SortableVerificationList).toBeDefined();
});

test("library exports AgentViewer and TendrilProcessViewer components and utilities", () => {
  expect(typeof UI.AgentViewer).toBe("function");
  expect(typeof UI.TendrilProcessViewer).toBe("function");
  expect(typeof UI.ToolUseCard).toBe("function");
  expect(typeof UI.ToolUseGroup).toBe("function");
  expect(typeof UI.ResultSummary).toBe("function");
  expect(typeof UI.AnimatedStatus).toBe("function");
  expect(typeof UI.parseEventWireStream).toBe("function");
  expect(typeof UI.groupToolUseEvents).toBe("function");
  expect(typeof UI.aggregateToolStatus).toBe("function");
  expect(typeof UI.deriveStatus).toBe("function");
  expect(typeof UI.useAutoScroll).toBe("function");
  expect(typeof UI.inputSummary).toBe("function");
});

test("exports TendrilDashboard and WebViewer components", () => {
  expect(TendrilDashboard).toBeDefined();
  expect(ActivityGrid).toBeDefined();
  expect(PillBars).toBeDefined();
  expect(TrendChart).toBeDefined();
  expect(HoverTip).toBeDefined();
  expect(WebViewer).toBeDefined();
});

test("all bare imports in src/ are declared in package.json", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const rootDir = join(__dirname, "..");
  const srcDir = join(rootDir, "src");
  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));

  const declaredPackages = new Set([
    ...Object.keys(packageJson.dependencies || {}),
    ...Object.keys(packageJson.devDependencies || {}),
    ...Object.keys(packageJson.peerDependencies || {}),
  ]);

  // Node builtins that don't need to be declared
  const nodeBuiltins = new Set([
    "fs",
    "path",
    "url",
    "util",
    "os",
    "crypto",
    "http",
    "https",
    "stream",
    "events",
    "buffer",
    "child_process",
    "node:fs",
    "node:path",
    "node:url",
    "node:util",
    "node:os",
    "node:crypto",
    "node:http",
    "node:https",
    "node:stream",
    "node:events",
    "node:buffer",
    "node:child_process",
  ]);

  const getAllFiles = (dir: string): string[] => {
    const files: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...getAllFiles(fullPath));
      } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }

    return files;
  };

  const extractImports = (content: string): string[] => {
    const imports: string[] = [];
    // Match: import ... from "package" or import "package"
    const importRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?["']([^"']+)["']/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      // Skip relative imports (starting with . or /)
      // Skip path aliases (starting with @/)
      if (
        !importPath.startsWith(".") &&
        !importPath.startsWith("/") &&
        !importPath.startsWith("@/")
      ) {
        imports.push(importPath);
      }
    }

    return imports;
  };

  const getPackageName = (importPath: string): string => {
    // Handle bare type imports from @types packages
    // e.g., "mdast" is provided by @types/mdast
    const typesPackageMap: Record<string, string> = {
      mdast: "@types/mdast",
    };

    if (typesPackageMap[importPath]) {
      return typesPackageMap[importPath];
    }

    // For scoped packages like @radix-ui/react-dialog, take @scope/package
    if (importPath.startsWith("@")) {
      const parts = importPath.split("/");
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : importPath;
    }
    // For regular packages, take the first segment
    return importPath.split("/")[0];
  };

  const sourceFiles = getAllFiles(srcDir);
  const undeclaredImports: Array<{ file: string; package: string }> = [];

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    const imports = extractImports(content);

    for (const importPath of imports) {
      const packageName = getPackageName(importPath);

      // Skip Node builtins
      if (nodeBuiltins.has(packageName)) {
        continue;
      }

      // Check if declared
      if (!declaredPackages.has(packageName)) {
        undeclaredImports.push({
          file: file.replace(rootDir, ""),
          package: packageName,
        });
      }
    }
  }

  if (undeclaredImports.length > 0) {
    const summary = undeclaredImports.map((item) => `  ${item.file}: ${item.package}`).join("\n");
    throw new Error(
      `Found ${undeclaredImports.length} undeclared imports:\n${summary}\n\n` +
        "All imports must be declared in package.json dependencies, devDependencies, or peerDependencies.",
    );
  }

  expect(undeclaredImports).toEqual([]);
});
