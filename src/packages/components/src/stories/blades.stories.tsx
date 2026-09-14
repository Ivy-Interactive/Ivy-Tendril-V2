import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { Pencil } from "lucide-react";

import { BladeContainer, useBlades, type BladeDescriptor } from "@/components/ui/blades";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const meta: Meta = {
  title: "UI/Blades",
};

export default meta;

const projects = ["Ivy-Tendril-V2", "Ivy-Framework", "Open-Glass"];

const rowClass =
  "w-full rounded-field px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground";

interface DemoContext {
  /** Records the last action so the drill-down's side effects are visible in the root blade. */
  log: (action: string) => void;
}

function EditForm({ name, log }: { name: string } & DemoContext) {
  const { pop, popTo } = useBlades();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        log(`Saved ${name}`);
        popTo(1);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blade-project-name">Name</Label>
        <Input id="blade-project-name" defaultValue={name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="blade-project-branch">Base branch</Label>
        <Input id="blade-project-branch" defaultValue="main" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            log("Cancelled the edit");
            pop();
          }}
        >
          Cancel
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Save unwinds to the root with <code>popTo(1)</code>; Cancel closes one level with{" "}
        <code>pop()</code>.
      </p>
    </form>
  );
}

function editBlade(name: string, context: DemoContext): BladeDescriptor {
  return {
    title: "Edit Project",
    subtitle: name,
    width: "lg",
    content: <EditForm name={name} {...context} />,
    onClose: () => context.log("Closed the edit blade"),
  };
}

function EditAction({ name, log }: { name: string } & DemoContext) {
  const { push } = useBlades();
  return (
    <Button variant="ghost" size="sm" onClick={() => push(editBlade(name, { log }))}>
      <Pencil className="size-4" />
      Edit
    </Button>
  );
}

function ProjectDetail({ name }: { name: string }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
      <dt className="text-muted-foreground">Repository</dt>
      <dd>{name}</dd>
      <dt className="text-muted-foreground">Base branch</dt>
      <dd>main</dd>
      <dt className="text-muted-foreground">Open plans</dt>
      <dd>4</dd>
      <dt className="text-muted-foreground">Verifications</dt>
      <dd>NpmLint, NpmBuild, NpmTest</dd>
    </dl>
  );
}

function projectBlade(name: string, context: DemoContext): BladeDescriptor {
  return {
    title: `Project: ${name}`,
    subtitle: "Detail",
    width: "lg",
    headerAction: <EditAction name={name} {...context} />,
    content: <ProjectDetail name={name} />,
    onRefresh: () => context.log(`Refreshed ${name}`),
    onClose: () => context.log(`Closed ${name}`),
  };
}

function ProjectList({ log }: DemoContext) {
  const { push, depth } = useBlades();
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {projects.map((name) => (
          <li key={name}>
            <button
              type="button"
              className={rowClass}
              onClick={() => push(projectBlade(name, { log }))}
            >
              {name}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted-foreground">Depth: {depth}</p>
    </div>
  );
}

function BladesDemo({
  collapseBreakpoint,
  className = "h-[520px] w-full",
  startDrilled = false,
}: {
  collapseBreakpoint?: number;
  className?: string;
  /** Opens one level deep on mount, so a collapsed stack has a parent to go back to. */
  startDrilled?: boolean;
}) {
  const [lastAction, setLastAction] = React.useState("Nothing yet");
  const log = React.useCallback((action: string) => setLastAction(action), []);

  const root: BladeDescriptor = {
    title: "Projects",
    subtitle: `Last action: ${lastAction}`,
    width: "sm",
    content: <ProjectList log={log} />,
  };

  // Read once on mount by the uncontrolled stack, so it is built outside the render-driven `root`.
  const [initialBlades] = React.useState(() =>
    startDrilled ? [projectBlade(projects[0], { log })] : undefined,
  );

  return (
    <div className={`overflow-hidden rounded-box border border-border ${className}`}>
      <BladeContainer
        root={root}
        initialBlades={initialBlades}
        collapseBreakpoint={collapseBreakpoint}
        aria-label="Projects"
      />
    </div>
  );
}

export const ThreeLevelDrillDown: StoryObj = {
  render: () => <BladesDemo />,
};

export const Collapsed: StoryObj = {
  // The collapse is driven by the viewport width, so the breakpoint is set above any canvas width
  // to demonstrate the narrow layout without resizing the Storybook frame. Opening one level deep
  // is what makes the collapsed affordance visible: at depth 1 the root is pinned and renders no
  // back button, so a depth-1 collapsed stack looks the same as an uncollapsed one.
  render: () => (
    <BladesDemo collapseBreakpoint={4000} className="h-[520px] w-[380px]" startDrilled />
  ),
};

export const WidthHints: StoryObj = {
  render: () => (
    <div className="h-[420px] w-full overflow-hidden rounded-box border border-border">
      <BladeContainer
        aria-label="Width hints"
        root={{
          title: "sm",
          subtitle: "w-80",
          width: "sm",
          content: <p className="text-sm">width=&quot;sm&quot;</p>,
        }}
        initialBlades={[
          {
            title: "md",
            subtitle: "w-104 (default)",
            width: "md",
            content: <p className="text-sm">width=&quot;md&quot;</p>,
          },
          {
            title: "lg",
            subtitle: "w-136",
            width: "lg",
            content: <p className="text-sm">width=&quot;lg&quot;</p>,
          },
          {
            title: "flex",
            subtitle: "fills the remaining space",
            width: "flex",
            content: <p className="text-sm">width=&quot;flex&quot;</p>,
          },
        ]}
      />
    </div>
  ),
};
