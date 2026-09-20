import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { CircleDot, Folder, GitPullRequest, Plus, Settings } from "lucide-react";
import {
  SidebarListRow,
  SidebarListRowExpandable,
  SidebarListRowSubItem,
} from "@/components/SidebarListRow";

const meta: Meta<typeof SidebarListRow> = {
  title: "UI/SidebarListRow",
  component: SidebarListRow,
};

export default meta;

/**
 * A real rail rather than a static row of samples: the expander only reads as one if its chevron
 * swaps and its children fold away, and the `Secondary`/`Ghost` tones only read as a pair if the
 * selection can move between them.
 */
const Rail: React.FC = () => {
  const [selected, setSelected] = React.useState("issues");
  const [expanded, setExpanded] = React.useState(true);

  return (
    // The width of the Settings and Inbox rails, so the rows truncate where they really do.
    <div className="flex w-56 flex-col gap-1">
      <SidebarListRow
        icon={CircleDot}
        label="My issues"
        count={12}
        selected={selected === "issues"}
        onClick={() => setSelected("issues")}
      />
      <SidebarListRow
        icon={GitPullRequest}
        label="Reviews"
        count={3}
        selected={selected === "reviews"}
        onClick={() => setSelected("reviews")}
      />
      {/* `count is > 0`: a zero count is suppressed rather than shown as an empty badge. */}
      <SidebarListRow
        icon={Settings}
        label="Settings"
        count={0}
        selected={selected === "settings"}
        onClick={() => setSelected("settings")}
      />
      <SidebarListRowExpandable
        icon={Folder}
        label="Projects"
        expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      />
      {expanded && (
        <>
          <SidebarListRowSubItem
            label="Tendril"
            color="Emerald"
            selected={selected === "tendril"}
            onClick={() => setSelected("tendril")}
          />
          <SidebarListRowSubItem
            label="Ivy-Interactive"
            color="Purple"
            selected={selected === "ivy"}
            onClick={() => setSelected("ivy")}
          />
          {/* Icon or colour, never both. */}
          <SidebarListRowSubItem
            label="Add Project"
            icon={Plus}
            selected={selected === "add"}
            onClick={() => setSelected("add")}
          />
          {/* A sub-item with no handler is static text, not a row that looks clickable and is not. */}
          <SidebarListRowSubItem label="No projects in settings" />
        </>
      )}
    </div>
  );
};

/** V1 `Helpers/SidebarListRow.cs`, the three shapes a Tendril sidebar is built from. */
export const Default: StoryObj<typeof SidebarListRow> = {
  render: () => <Rail />,
};

/** The `Build(title, content, ...)` overload: a second, muted line under the label. */
export const WithDetail: StoryObj<typeof SidebarListRow> = {
  render: () => (
    <div className="flex w-56 flex-col gap-1">
      <SidebarListRow label="Tendril-App" detail="12 open issues" selected />
      <SidebarListRow label="Ivy-Interactive" detail="No open issues" />
    </div>
  ),
};
