import type { Meta, StoryObj } from "@storybook/react";

/**
 * Every named palette color defined in `styles/globals.css`, with the literal Tailwind class names
 * spelled out so the scanner emits them. A token that is missing a `--color-*` alias renders as a
 * transparent, unstyled swatch, which makes the gap immediately visible.
 */
export const NAMED_COLORS = [
  {
    name: "ivy-green",
    bg: "bg-ivy-green",
    fg: "text-ivy-green-foreground",
    text: "text-ivy-green",
  },
  { name: "slate", bg: "bg-slate", fg: "text-slate-foreground", text: "text-slate" },
  { name: "gray", bg: "bg-gray", fg: "text-gray-foreground", text: "text-gray" },
  { name: "zinc", bg: "bg-zinc", fg: "text-zinc-foreground", text: "text-zinc" },
  { name: "neutral", bg: "bg-neutral", fg: "text-neutral-foreground", text: "text-neutral" },
  { name: "stone", bg: "bg-stone", fg: "text-stone-foreground", text: "text-stone" },
  { name: "black", bg: "bg-black", fg: "text-black-foreground", text: "text-black" },
  { name: "white", bg: "bg-white", fg: "text-white-foreground", text: "text-white" },
  { name: "red", bg: "bg-red", fg: "text-red-foreground", text: "text-red" },
  { name: "orange", bg: "bg-orange", fg: "text-orange-foreground", text: "text-orange" },
  { name: "amber", bg: "bg-amber", fg: "text-amber-foreground", text: "text-amber" },
  { name: "yellow", bg: "bg-yellow", fg: "text-yellow-foreground", text: "text-yellow" },
  { name: "lime", bg: "bg-lime", fg: "text-lime-foreground", text: "text-lime" },
  { name: "green", bg: "bg-green", fg: "text-green-foreground", text: "text-green" },
  { name: "emerald", bg: "bg-emerald", fg: "text-emerald-foreground", text: "text-emerald" },
  { name: "teal", bg: "bg-teal", fg: "text-teal-foreground", text: "text-teal" },
  { name: "cyan", bg: "bg-cyan", fg: "text-cyan-foreground", text: "text-cyan" },
  { name: "sky", bg: "bg-sky", fg: "text-sky-foreground", text: "text-sky" },
  { name: "blue", bg: "bg-blue", fg: "text-blue-foreground", text: "text-blue" },
  { name: "indigo", bg: "bg-indigo", fg: "text-indigo-foreground", text: "text-indigo" },
  { name: "violet", bg: "bg-violet", fg: "text-violet-foreground", text: "text-violet" },
  { name: "purple", bg: "bg-purple", fg: "text-purple-foreground", text: "text-purple" },
  { name: "fuchsia", bg: "bg-fuchsia", fg: "text-fuchsia-foreground", text: "text-fuchsia" },
  { name: "pink", bg: "bg-pink", fg: "text-pink-foreground", text: "text-pink" },
  { name: "rose", bg: "bg-rose", fg: "text-rose-foreground", text: "text-rose" },
] as const;

function SwatchGrid() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {NAMED_COLORS.map((color) => (
        <div
          key={color.name}
          className={`${color.bg} ${color.fg} rounded-box border border-border p-3`}
        >
          <div className="font-sans text-xs font-medium">{color.name}</div>
          <div className="font-mono text-[10px] opacity-80">--{color.name}</div>
        </div>
      ))}
    </div>
  );
}

function TextOnBackgroundRow() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-box border border-border bg-background p-4">
      {NAMED_COLORS.map((color) => (
        <span key={color.name} className={`${color.text} font-sans text-sm`}>
          {color.name}
        </span>
      ))}
    </div>
  );
}

function ColorShowcase() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-6">
      <div>
        <h1 className="font-sans text-3xl font-bold tracking-tight">Named Colors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The {NAMED_COLORS.length} named palette tokens and their <code>-foreground</code> pairs.
          Each pair meets WCAG 2.1 AA contrast (&gt;= 4.5:1) in both modes.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="border-b border-border pb-2 font-sans text-xl font-semibold">Swatches</h2>
        <SwatchGrid />
      </section>

      <section className="space-y-3">
        <h2 className="border-b border-border pb-2 font-sans text-xl font-semibold">
          Text on background
        </h2>
        <p className="text-xs text-muted-foreground">
          The usage that drives the per-mode values: named colors as syntax and label colors on the
          page background.
        </p>
        <TextOnBackgroundRow />
      </section>
    </div>
  );
}

function LightAndDarkShowcase() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="bg-background text-foreground">
        <div className="px-6 pt-6 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Light
        </div>
        <ColorShowcase />
      </div>
      <div className="dark bg-background text-foreground">
        <div className="px-6 pt-6 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Dark
        </div>
        <ColorShowcase />
      </div>
    </div>
  );
}

const meta: Meta = {
  title: "Foundation/Colors",
  component: ColorShowcase,
  // `NAMED_COLORS` is exported for `tests/design-tokens.test.ts`, not as a story. Without this, CSF
  // reads it as one and it shows up in the sidebar and in the visual snapshot run.
  excludeStories: ["NAMED_COLORS"],
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;

type Story = StoryObj;

export const AllColors: Story = {
  render: () => <ColorShowcase />,
};

export const LightAndDark: Story = {
  render: () => <LightAndDarkShowcase />,
};

export const TextOnBackground: Story = {
  render: () => (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <TextOnBackgroundRow />
      <div className="dark rounded-box bg-background p-4">
        <TextOnBackgroundRow />
      </div>
    </div>
  ),
};
