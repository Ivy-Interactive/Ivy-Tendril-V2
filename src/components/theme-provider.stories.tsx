import type { Meta, StoryObj } from "@storybook/react";
import { ThemeProvider, useTheme } from "./theme-provider.tsx";
import { cn } from "../lib/utils.ts";

function ThemeDemo() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const semanticColors = [
    { name: "Primary", bg: "bg-primary", fg: "text-primary-foreground", border: "border-border" },
    {
      name: "Secondary",
      bg: "bg-secondary",
      fg: "text-secondary-foreground",
      border: "border-border",
    },
    {
      name: "Destructive",
      bg: "bg-destructive",
      fg: "text-destructive-foreground",
      border: "border-border",
    },
    { name: "Success", bg: "bg-success", fg: "text-success-foreground", border: "border-border" },
    { name: "Warning", bg: "bg-warning", fg: "text-warning-foreground", border: "border-border" },
    { name: "Info", bg: "bg-info", fg: "text-info-foreground", border: "border-border" },
    { name: "Muted", bg: "bg-muted", fg: "text-muted-foreground", border: "border-border" },
    { name: "Card", bg: "bg-card", fg: "text-card-foreground", border: "border-border" },
  ];

  const radii = [
    { name: "Box (8px)", class: "rounded-box" },
    { name: "Field (6px)", class: "rounded-field" },
    { name: "Selector (4px)", class: "rounded-selector" },
    { name: "Checkbox (2px)", class: "rounded-checkbox" },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8 bg-background text-foreground transition-colors duration-200">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ivy Design System Foundation</h1>
          <p className="text-muted-foreground text-sm">React 19 + Tailwind CSS + Design Tokens</p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs px-2.5 py-1 rounded-selector bg-secondary text-secondary-foreground font-mono">
            Active: {theme} ({resolvedTheme})
          </span>
          <div className="inline-flex rounded-field border bg-card p-1 shadow-xs">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-selector transition-all capitalize",
                  theme === t
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Semantic Color Tokens */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Semantic Color Tokens</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {semanticColors.map((color) => (
            <div
              key={color.name}
              className={cn(
                "p-4 border rounded-box flex flex-col justify-between shadow-xs",
                color.bg,
                color.fg,
                color.border,
              )}
            >
              <span className="font-medium text-sm">{color.name}</span>
              <span className="text-xs opacity-75 font-mono mt-2">{color.bg}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Semantic Radii */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Semantic Radii</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {radii.map((radius) => (
            <div
              key={radius.name}
              className={cn(
                "p-4 border-2 border-primary bg-card text-card-foreground text-center shadow-xs",
                radius.class,
              )}
            >
              <div className="text-sm font-medium">{radius.name}</div>
              <div className="text-xs text-muted-foreground font-mono mt-1">.{radius.class}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Typography Tokens */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Typography Scale</h2>
        <div className="p-4 border rounded-box bg-card space-y-2">
          <p className="text-xl font-bold">Heading 1 (20px bold)</p>
          <p className="text-base font-semibold">Heading 2 (16px semibold)</p>
          <p className="text-sm">
            Body text (14px regular) - The quick brown fox jumps over the lazy dog.
          </p>
          <p className="text-xs text-muted-foreground">
            Small / Label text (12px muted) - System timestamp: 2026-09-05
          </p>
          <code className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded-selector inline-block">
            const token = "Geist Mono";
          </code>
        </div>
      </section>
    </div>
  );
}

const meta: Meta<typeof ThemeProvider> = {
  title: "Foundation/ThemeProvider",
  component: ThemeProvider,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof ThemeProvider>;

export const Default: Story = {
  render: () => (
    <ThemeProvider defaultTheme="system">
      <ThemeDemo />
    </ThemeProvider>
  ),
};

export const DarkMode: Story = {
  render: () => (
    <ThemeProvider defaultTheme="dark">
      <ThemeDemo />
    </ThemeProvider>
  ),
};

export const LightMode: Story = {
  render: () => (
    <ThemeProvider defaultTheme="light">
      <ThemeDemo />
    </ThemeProvider>
  ),
};
