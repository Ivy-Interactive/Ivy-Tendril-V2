import { describe, expect, it } from "vitest";
import * as root from "../src/index";
import * as ui from "../src/ui";
import * as renderers from "../src/renderers";
import * as tendril from "../src/tendril";

describe("Package Exports", () => {
  describe("Root Export (components-storybook)", () => {
    it("should export ThemeProvider and theme utilities", () => {
      expect(root.ThemeProvider).toBeDefined();
      expect(root.useTheme).toBeDefined();
      expect(root.ThemeContext).toBeDefined();
    });

    it("should export utility functions", () => {
      expect(root.cn).toBeDefined();
    });

    it("should export common UI components", () => {
      expect(root.Button).toBeDefined();
      expect(root.Input).toBeDefined();
      expect(root.Card).toBeDefined();
      expect(root.Badge).toBeDefined();
      expect(root.DataTable).toBeDefined();
      expect(root.Dialog).toBeDefined();
      expect(root.Tabs).toBeDefined();
    });

    it("should export primary renderers", () => {
      expect(root.MarkdownRenderer).toBeDefined();
    });

    it("should export primary Tendril widgets", () => {
      expect(root.TendrilShell).toBeDefined();
      expect(root.AgentViewer).toBeDefined();
      expect(root.PlanMarkdown).toBeDefined();
      expect(root.TendrilDashboard).toBeDefined();
      expect(root.TendrilQuestions).toBeDefined();
    });

    it("should export density context and scale", () => {
      expect(root.DensityProvider).toBeDefined();
      expect(root.useDensity).toBeDefined();
      expect(root.DensityScale).toBeDefined();
      expect(typeof root.useDensityScale).toBe("function");
    });

    it("should export shared hooks", () => {
      expect(root.useResizableSidebar).toBeDefined();
      expect(typeof root.useResizableSidebar).toBe("function");
    });

    it("should export PlanWorkspace", () => {
      expect(root.PlanWorkspace).toBeDefined();
    });

    it("should export image and debug-log utilities", () => {
      expect(root.debugLog).toBeDefined();
      expect(root.isDebugLoggingEnabled).toBeDefined();
      expect(root.isImageFile).toBeDefined();
      expect(root.isCompressibleImage).toBeDefined();
      expect(root.processImageFile).toBeDefined();
    });

    it("should export the shared token/cost/time formatters and clipboard helper", () => {
      expect(typeof root.formatTokens).toBe("function");
      expect(typeof root.formatCost).toBe("function");
      expect(typeof root.formatTimeSpan).toBe("function");
      expect(root.NO_VALUE).toBeDefined();
      expect(typeof root.copyToClipboard).toBe("function");
    });
  });

  describe("UI Primitives Export (components-storybook/ui)", () => {
    it("should export utility functions", () => {
      expect(ui.cn).toBeDefined();
    });

    it("should export key UI primitive components", () => {
      // Verify the module exports exist
      expect(Object.keys(ui).length).toBeGreaterThan(0);

      // Sample key primitives (not exhaustive)
      expect(ui.Button).toBeDefined();
      expect(ui.Input).toBeDefined();
      expect(ui.Card).toBeDefined();
      expect(ui.Badge).toBeDefined();
      expect(ui.Dialog).toBeDefined();
      expect(ui.Tabs).toBeDefined();
      expect(ui.Checkbox).toBeDefined();
      expect(ui.Switch).toBeDefined();
      expect(ui.Accordion).toBeDefined();
      expect(ui.Slider).toBeDefined();
      expect(ui.Toggle).toBeDefined();
      expect(ui.Label).toBeDefined();
      expect(ui.Select).toBeDefined();
      expect(ui.DataTable).toBeDefined();
      expect(ui.DataTablePagination).toBeDefined();
    });

    it("should export variant namespaces", () => {
      expect(ui.DetailVariants).toBeDefined();
      expect(ui.ExpandableVariants).toBeDefined();
      expect(ui.InputVariants).toBeDefined();
      expect(ui.SelectVariants).toBeDefined();
      expect(ui.TableVariants).toBeDefined();
    });

    it("should export widget utilities and shared primitives", () => {
      expect(ui.IconButton).toBeDefined();
      expect(ui.StatusLine).toBeDefined();
      expect(ui.withTooltipScope).toBeDefined();
      expect(ui.TuiBadge).toBeDefined();
      expect(ui.CountBadge).toBeDefined();
      expect(ui.StatusDot).toBeDefined();
      expect(ui.TuiKbd).toBeDefined();
      expect(ui.TuiTooltip).toBeDefined();
      expect(ui.TooltipScope).toBeDefined();
      expect(ui.Spinner).toBeDefined();
    });
  });

  describe("Renderers Export (components-storybook/renderers)", () => {
    it("should export rich content renderers", () => {
      expect(renderers.MarkdownRenderer).toBeDefined();
      expect(renderers.JsonRenderer).toBeDefined();
      expect(renderers.XmlRenderer).toBeDefined();
      expect(renderers.HtmlRenderer).toBeDefined();
    });

    it("should export specialized presentation components", () => {
      expect(renderers.Icon).toBeDefined();
      expect(renderers.InvalidIcon).toBeDefined();
      expect(renderers.IvyLogo).toBeDefined();
      expect(renderers.Kbd).toBeDefined();
      expect(renderers.Loading).toBeDefined();
      expect(renderers.LoadingScreen).toBeDefined();
      expect(renderers.LogoLoading).toBeDefined();
      expect(renderers.TextShimmer).toBeDefined();
      expect(renderers.CopyToClipboardButton).toBeDefined();
      expect(renderers.EmojiRating).toBeDefined();
      expect(renderers.StarRating).toBeDefined();
      expect(renderers.NumberInput).toBeDefined();
      expect(renderers.MadeWithIvy).toBeDefined();
    });

    it("should export chat components", () => {
      expect(renderers.ChatBubble).toBeDefined();
      expect(renderers.ChatInput).toBeDefined();
      expect(renderers.ChatMessageList).toBeDefined();
      expect(renderers.MessageLoading).toBeDefined();
    });

    it("should export error handling components", () => {
      expect(renderers.ErrorBoundary).toBeDefined();
      expect(renderers.ErrorDisplay).toBeDefined();
      expect(renderers.ErrorSheet).toBeDefined();
      expect(renderers.DevTools).toBeDefined();
    });

    it("should export utility functions", () => {
      expect(renderers.copyToClipboard).toBeDefined();
      expect(renderers.getPlatformShortcut).toBeDefined();
    });
  });

  describe("Tendril Export (components-storybook/tendril)", () => {
    it("should export shell components", () => {
      expect(tendril.TendrilShell).toBeDefined();
      expect(tendril.ShellNav).toBeDefined();
      expect(tendril.ShellTabs).toBeDefined();
      expect(tendril.ShellAgentButton).toBeDefined();
      expect(tendril.ShellNewPlanButton).toBeDefined();
      expect(tendril.ShellSettingsButton).toBeDefined();
      expect(tendril.ShellSidebarHeader).toBeDefined();
      expect(tendril.ShellSidebarSection).toBeDefined();
      expect(tendril.BrandIcon).toBeDefined();
      expect(tendril.brandIcons).toBeDefined();
    });

    it("should export shell rail flyout, section items, and tooltip", () => {
      expect(tendril.ShellRailFlyout).toBeDefined();
      expect(tendril.ShellSectionItems).toBeDefined();
      expect(tendril.ShellTooltip).toBeDefined();
      expect(tendril.sectionItemIcons).toBeDefined();
      expect(tendril.formatShortcut).toBeDefined();
    });

    it("should export the plan workspace split-pane layout", () => {
      expect(tendril.PlanWorkspace).toBeDefined();
    });

    it("should export shared hooks", () => {
      expect(tendril.useResizableSidebar).toBeDefined();
      expect(typeof tendril.useResizableSidebar).toBe("function");
    });

    it("should export agent and execution visualizers", () => {
      expect(tendril.AgentViewer).toBeDefined();
      expect(tendril.TendrilProcessViewer).toBeDefined();
    });

    /**
     * What a consumer needs to render an agent run's parts itself, rather than as one `AgentViewer`:
     * the chat thread lays a turn's tool cards out inline and puts the run's own metrics under it.
     */
    it("should export the pieces of an agent run a consumer can render on its own", () => {
      expect(tendril.AgentMetricsFooter).toBeDefined();
      expect(tendril.EventWireStreamParser).toBeDefined();
      expect(tendril.agentNodeKey).toBeDefined();
      expect(tendril.groupToolUseEvents).toBeDefined();
      expect(tendril.parseEventWireStream).toBeDefined();
    });

    it("should export inputs and form controls", () => {
      expect(tendril.ContentInput).toBeDefined();
      expect(tendril.BadgeSelect).toBeDefined();
      expect(tendril.SortableVerificationList).toBeDefined();
    });

    it("should export plan markdown components", () => {
      expect(tendril.PlanMarkdown).toBeDefined();
      expect(tendril.DraftMarkdown).toBeDefined();
      expect(tendril.AlertBlockquote).toBeDefined();
      expect(tendril.AnnotationPopover).toBeDefined();
      expect(tendril.QuestionsCallout).toBeDefined();
      expect(tendril.SearchOverlay).toBeDefined();
    });

    it("should export plan diff components", () => {
      expect(tendril.PlanDiffView).toBeDefined();
      expect(tendril.getLanguageFromFilePath).toBeDefined();
      expect(tendril.registerExtensionMapping).toBeDefined();
      expect(tendril.registerExtensionMappings).toBeDefined();
      expect(tendril.clearCustomExtensionMappings).toBeDefined();
      expect(tendril.customExtensionRegistry).toBeDefined();
    });

    it("should export plan changes view and its file tree helper", () => {
      expect(tendril.PlanChangesView).toBeDefined();
      expect(tendril.buildFileTree).toBeDefined();
    });

    it("should export plan git view", () => {
      expect(tendril.PlanGitView).toBeDefined();
    });

    it("should export dashboard components", () => {
      expect(tendril.TendrilDashboard).toBeDefined();
      expect(tendril.ActivityGrid).toBeDefined();
      expect(tendril.PillBars).toBeDefined();
      expect(tendril.TrendChart).toBeDefined();
      expect(tendril.HoverTip).toBeDefined();
    });

    it("should export web viewer", () => {
      expect(tendril.WebViewer).toBeDefined();
    });

    it("should export tendril questions widgets and helpers", () => {
      expect(tendril.TendrilQuestions).toBeDefined();
      expect(tendril.QuestionsForm).toBeDefined();
      expect(tendril.ChatQuestionsBlock).toBeDefined();
      expect(tendril.AnswersSummaryCard).toBeDefined();
      expect(tendril.DescriptionMarkdown).toBeDefined();
      expect(tendril.buildAnswersSummary).toBeDefined();
      expect(tendril.canSubmitAnswers).toBeDefined();
      expect(tendril.documentAnswers).toBeDefined();
      expect(tendril.documentOtherOpen).toBeDefined();
      expect(tendril.entryTitle).toBeDefined();
      expect(tendril.hasEntries).toBeDefined();
      expect(tendril.parseAnswersSummary).toBeDefined();
      expect(tendril.submitNote).toBeDefined();
      expect(tendril.unansweredRequired).toBeDefined();
    });
  });
});
