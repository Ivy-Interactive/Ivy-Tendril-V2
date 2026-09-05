import { describe, expect, it } from "vitest";

describe("Package Exports", () => {
  describe("Root Export (components-storybook)", () => {
    it("should export ThemeProvider and theme utilities", async () => {
      const mod = await import("../src/index");

      expect(mod.ThemeProvider).toBeDefined();
      expect(mod.useTheme).toBeDefined();
      expect(mod.ThemeContext).toBeDefined();
    });

    it("should export utility functions", async () => {
      const mod = await import("../src/index");

      expect(mod.cn).toBeDefined();
    });

    it("should export common UI components", async () => {
      const mod = await import("../src/index");

      expect(mod.Button).toBeDefined();
      expect(mod.Input).toBeDefined();
      expect(mod.Card).toBeDefined();
      expect(mod.Badge).toBeDefined();
      expect(mod.Dialog).toBeDefined();
      expect(mod.Tabs).toBeDefined();
    });

    it("should export primary renderers", async () => {
      const mod = await import("../src/index");

      expect(mod.MarkdownRenderer).toBeDefined();
      expect(mod.MermaidRenderer).toBeDefined();
      expect(mod.GraphvizRenderer).toBeDefined();
    });

    it("should export primary Tendril widgets", async () => {
      const mod = await import("../src/index");

      expect(mod.TendrilShell).toBeDefined();
      expect(mod.AgentViewer).toBeDefined();
      expect(mod.PlanMarkdown).toBeDefined();
      expect(mod.TendrilDashboard).toBeDefined();
    });

    it("should export density context and scale", async () => {
      const mod = await import("../src/index");

      expect(mod.DensityProvider).toBeDefined();
      expect(mod.useDensity).toBeDefined();
      expect(mod.DensityScale).toBeDefined();
      expect(typeof mod.useDensityScale).toBe("function");
    });
  });

  describe("UI Primitives Export (components-storybook/ui)", () => {
    it("should export utility functions", async () => {
      const mod = await import("../src/ui");

      expect(mod.cn).toBeDefined();
    });

    it("should export key UI primitive components", async () => {
      const mod = await import("../src/ui");

      // Verify the module exports exist
      expect(Object.keys(mod).length).toBeGreaterThan(0);

      // Sample key primitives (not exhaustive)
      expect(mod.Button).toBeDefined();
      expect(mod.Input).toBeDefined();
      expect(mod.Card).toBeDefined();
      expect(mod.Badge).toBeDefined();
      expect(mod.Dialog).toBeDefined();
      expect(mod.Tabs).toBeDefined();
      expect(mod.Checkbox).toBeDefined();
      expect(mod.Switch).toBeDefined();
      expect(mod.Label).toBeDefined();
      expect(mod.Select).toBeDefined();
    });

    it("should export variant namespaces", async () => {
      const mod = await import("../src/ui");

      expect(mod.DetailVariants).toBeDefined();
      expect(mod.ExpandableVariants).toBeDefined();
      expect(mod.InputVariants).toBeDefined();
      expect(mod.SelectVariants).toBeDefined();
      expect(mod.TableVariants).toBeDefined();
    });
  });

  describe("Renderers Export (components-storybook/renderers)", () => {
    it("should export rich content renderers", async () => {
      const mod = await import("../src/renderers");

      expect(mod.MarkdownRenderer).toBeDefined();
      expect(mod.MermaidRenderer).toBeDefined();
      expect(mod.GraphvizRenderer).toBeDefined();
      expect(mod.JsonRenderer).toBeDefined();
      expect(mod.XmlRenderer).toBeDefined();
      expect(mod.HtmlRenderer).toBeDefined();
    });

    it("should export specialized presentation components", async () => {
      const mod = await import("../src/renderers");

      expect(mod.Icon).toBeDefined();
      expect(mod.InvalidIcon).toBeDefined();
      expect(mod.IvyLogo).toBeDefined();
      expect(mod.Kbd).toBeDefined();
      expect(mod.Loading).toBeDefined();
      expect(mod.LoadingScreen).toBeDefined();
      expect(mod.LogoLoading).toBeDefined();
      expect(mod.TextShimmer).toBeDefined();
      expect(mod.CopyToClipboardButton).toBeDefined();
      expect(mod.EmojiRating).toBeDefined();
      expect(mod.StarRating).toBeDefined();
      expect(mod.NumberInput).toBeDefined();
      expect(mod.MadeWithIvy).toBeDefined();
    });

    it("should export chat components", async () => {
      const mod = await import("../src/renderers");

      expect(mod.ChatBubble).toBeDefined();
      expect(mod.ChatInput).toBeDefined();
      expect(mod.ChatMessageList).toBeDefined();
      expect(mod.MessageLoading).toBeDefined();
    });

    it("should export error handling components", async () => {
      const mod = await import("../src/renderers");

      expect(mod.ErrorBoundary).toBeDefined();
      expect(mod.ErrorDisplay).toBeDefined();
      expect(mod.ErrorSheet).toBeDefined();
      expect(mod.DevTools).toBeDefined();
    });

    it("should export utility functions", async () => {
      const mod = await import("../src/renderers");

      expect(mod.copyToClipboard).toBeDefined();
      expect(mod.getPlatformShortcut).toBeDefined();
    });
  });

  describe("Tendril Export (components-storybook/tendril)", () => {
    it("should export shell components", async () => {
      const mod = await import("../src/tendril");

      expect(mod.TendrilShell).toBeDefined();
      expect(mod.ShellNav).toBeDefined();
      expect(mod.ShellTabs).toBeDefined();
      expect(mod.ShellAgentButton).toBeDefined();
      expect(mod.ShellNewPlanButton).toBeDefined();
      expect(mod.ShellSettingsButton).toBeDefined();
      expect(mod.ShellSidebarHeader).toBeDefined();
      expect(mod.ShellSidebarSection).toBeDefined();
      expect(mod.BrandIcon).toBeDefined();
      expect(mod.brandIcons).toBeDefined();
    });

    it("should export agent and execution visualizers", async () => {
      const mod = await import("../src/tendril");

      expect(mod.AgentViewer).toBeDefined();
      expect(mod.TendrilProcessViewer).toBeDefined();
    });

    it("should export inputs and form controls", async () => {
      const mod = await import("../src/tendril");

      expect(mod.ContentInput).toBeDefined();
      expect(mod.BadgeSelect).toBeDefined();
      expect(mod.SortableVerificationList).toBeDefined();
    });

    it("should export plan markdown components", async () => {
      const mod = await import("../src/tendril");

      expect(mod.PlanMarkdown).toBeDefined();
      expect(mod.DraftMarkdown).toBeDefined();
      expect(mod.AlertBlockquote).toBeDefined();
      expect(mod.AnnotationPopover).toBeDefined();
      expect(mod.QuestionsCallout).toBeDefined();
      expect(mod.SearchOverlay).toBeDefined();
    });

    it("should export plan diff components", async () => {
      const mod = await import("../src/tendril");

      expect(mod.PlanDiffView).toBeDefined();
    });

    it("should export dashboard components", async () => {
      const mod = await import("../src/tendril");

      expect(mod.TendrilDashboard).toBeDefined();
      expect(mod.ActivityGrid).toBeDefined();
      expect(mod.PillBars).toBeDefined();
      expect(mod.TrendChart).toBeDefined();
      expect(mod.HoverTip).toBeDefined();
    });

    it("should export web viewer", async () => {
      const mod = await import("../src/tendril");

      expect(mod.WebViewer).toBeDefined();
    });
  });
});
