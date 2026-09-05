import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";

function TypographyShowcase() {
  const alphabetUpper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const alphabetLower = "abcdefghijklmnopqrstuvwxyz";
  const numbersSymbols = "0123456789 !@#$%^&*()_+-=[]{}|;':\",./<>?";

  const sansWeights = [
    { weight: "400", name: "Regular", className: "font-normal" },
    { weight: "500", name: "Medium", className: "font-medium" },
    { weight: "600", name: "SemiBold", className: "font-semibold" },
    { weight: "700", name: "Bold", className: "font-bold" },
  ];

  const monoWeights = [
    { weight: "400", name: "Regular", className: "font-normal" },
    { weight: "500", name: "Medium", className: "font-medium" },
    { weight: "600", name: "SemiBold", className: "font-semibold" },
    { weight: "700", name: "Bold", className: "font-bold" },
  ];

  return (
    <div className="space-y-10 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold font-sans tracking-tight">Typography Showcase</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bundled Geist and Geist Mono font assets across standard typographic weights and tokens.
        </p>
      </div>

      {/* Geist Sans Section */}
      <section className="space-y-6">
        <div className="border-b pb-2">
          <h2 className="text-xl font-semibold font-sans">Geist Sans</h2>
          <p className="text-xs text-muted-foreground">
            Modern neo-grotesque sans-serif typeface optimized for UI clarity and reading comfort.
          </p>
        </div>

        <div className="space-y-4 font-sans">
          {sansWeights.map(({ weight, name, className }) => (
            <div
              key={weight}
              className="p-4 rounded-box border bg-card text-card-foreground space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">
                  Geist Sans {weight} ({name})
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  font-{name.toLowerCase()} / {weight}
                </span>
              </div>
              <p className={`text-2xl ${className}`}>
                The quick brown fox jumps over the lazy dog.
              </p>
              <div className="text-xs tracking-wider text-muted-foreground space-y-1">
                <div>{alphabetUpper}</div>
                <div>{alphabetLower}</div>
                <div>{numbersSymbols}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Geist Mono Section */}
      <section className="space-y-6">
        <div className="border-b pb-2">
          <h2 className="text-xl font-semibold font-sans">Geist Mono</h2>
          <p className="text-xs text-muted-foreground">
            Engineered monospace typeface with crisp tabular figures and syntax legibility.
          </p>
        </div>

        <div className="space-y-4 font-mono">
          {monoWeights.map(({ weight, name, className }) => (
            <div
              key={weight}
              className="p-4 rounded-box border bg-card text-card-foreground space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">
                  Geist Mono {weight} ({name})
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground">
                  font-{name.toLowerCase()} / {weight}
                </span>
              </div>
              <pre className={`text-sm ${className} bg-muted/40 p-3 rounded-field overflow-x-auto`}>
                {`function calculateMetrics(records: MetricRecord[]): Result {
  const sum = records.reduce((acc, r) => acc + r.value, 0);
  return { count: records.length, sum, avg: (sum / records.length).toFixed(2) };
}`}
              </pre>
              <div className="flex items-center gap-6 text-xs tabular-nums text-muted-foreground">
                <span>Tabular numerals: 0123456789</span>
                <span>Hex: 0xDEADBEEF</span>
                <span>SHA: 44a0b3ef...</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Type Scale & Hierarchy Comparison */}
      <section className="space-y-6">
        <div className="border-b pb-2">
          <h2 className="text-xl font-semibold font-sans">Type Scale & Hierarchy</h2>
          <p className="text-xs text-muted-foreground">
            Comparisons of headings, body, labels, and code tokens under the active theme.
          </p>
        </div>

        <div className="p-6 rounded-box border bg-card text-card-foreground space-y-6">
          <div className="space-y-1">
            <span className="text-xs font-mono text-muted-foreground">
              H1 / text-3xl font-bold font-sans
            </span>
            <h1 className="text-3xl font-bold font-sans">Autonomous Plan Orchestration</h1>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-muted-foreground">
              H2 / text-2xl font-semibold font-sans
            </span>
            <h2 className="text-2xl font-semibold font-sans">
              Task Intake and Verification Pipeline
            </h2>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-muted-foreground">
              H3 / text-lg font-medium font-sans
            </span>
            <h3 className="text-lg font-medium font-sans">Isolated Git Worktrees & Testing</h3>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-muted-foreground">
              Body / text-sm font-normal font-sans
            </span>
            <p className="text-sm font-sans text-muted-foreground leading-relaxed">
              Plans execute in isolated git worktrees, ensuring that the original repository
              checkouts remain clean. All verification stages gate progress before a pull request is
              generated.
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-muted-foreground">
              Label / text-xs font-medium font-sans
            </span>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Verification Status: All Checks Passing
            </p>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-mono text-muted-foreground">
              Code / text-xs font-mono
            </span>
            <code className="text-xs font-mono bg-muted text-muted-foreground px-2 py-1 rounded-selector inline-block">
              tendril job status 00398 --message="Verifying typography"
            </code>
          </div>
        </div>
      </section>

      {/* Theme Comparison */}
      <section className="space-y-6">
        <div className="border-b pb-2">
          <h2 className="text-xl font-semibold font-sans">Side-by-Side Theme Comparison</h2>
          <p className="text-xs text-muted-foreground">
            Visual specimen comparing typography rendering in explicit light and dark containers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 rounded-box border bg-white text-zinc-900 space-y-4">
            <div className="text-xs font-mono text-zinc-500 uppercase tracking-wider">
              Light Theme Specimen
            </div>
            <h3 className="text-lg font-bold font-sans text-zinc-950">Geist Sans in Light Mode</h3>
            <p className="text-sm text-zinc-600 font-sans leading-relaxed">
              Crisp readability and uniform optical weight across varying screen densities and
              browser platforms.
            </p>
            <div className="p-3 bg-zinc-100 rounded-field font-mono text-xs text-zinc-800">
              const fontSans = "Geist";
            </div>
          </div>

          <div className="p-6 rounded-box border border-zinc-800 bg-zinc-950 text-zinc-100 dark space-y-4">
            <div className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              Dark Theme Specimen
            </div>
            <h3 className="text-lg font-bold font-sans text-zinc-50">Geist Sans in Dark Mode</h3>
            <p className="text-sm text-zinc-300 font-sans leading-relaxed">
              Anti-aliasing consistency preventing text bloat or wash-out on dark backgrounds.
            </p>
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-field font-mono text-xs text-zinc-200">
              const fontSans = "Geist";
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const meta: Meta = {
  title: "Foundation/Typography",
  component: TypographyShowcase,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <TypographyShowcase />,
};

export const DarkMode: Story = {
  parameters: {
    globals: {
      theme: "dark",
    },
  },
  render: () => (
    <div className="dark bg-background text-foreground min-h-screen">
      <TypographyShowcase />
    </div>
  ),
};

export const LightMode: Story = {
  parameters: {
    globals: {
      theme: "light",
    },
  },
  render: () => (
    <div className="bg-background text-foreground min-h-screen">
      <TypographyShowcase />
    </div>
  ),
};
