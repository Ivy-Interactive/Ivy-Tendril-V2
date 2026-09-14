import { useState, type CSSProperties } from "react";
import { BadgeSelect, type BadgeSelectOption } from "./BadgeSelect";

export default {
  title: "Components/BadgeSelect",
  component: BadgeSelect,
};

const mockProjects: BadgeSelectOption[] = [
  { value: "tendril", label: "Tendril Core", icon: "Folder" },
  { value: "components-storybook", label: "Components Storybook", icon: "Folder" },
  { value: "ivy-framework", label: "Ivy Framework", icon: "Folder" },
  { value: "lots-of-dev-tools", label: "Lots of Dev Tools", icon: "WandSparkles" },
];

const mockTags: BadgeSelectOption[] = [
  { value: "bug", label: "Bug", icon: "Flag" },
  { value: "feature", label: "Feature", icon: "Plus" },
  { value: "enhancement", label: "Enhancement", icon: "WandSparkles" },
  { value: "urgent", label: "Urgent Priority", icon: "Flag" },
];

const mockActions: BadgeSelectOption[] = [
  { value: "__add_project__", label: "Add New Project", icon: "Plus" },
  { value: "__manage_tags__", label: "Manage Tags...", icon: "WandSparkles" },
];

export const EmptySingleSelect = () => {
  const [val, setVal] = useState<string[]>([]);
  return (
    <div style={{ maxWidth: 360, padding: 24 }}>
      <BadgeSelect
        id="bs-empty-single"
        options={mockProjects}
        value={val}
        multiple={false}
        placeholder="Select a project..."
        events={["OnChange"]}
        eventHandler={(_evt, _id, args) => setVal(args[0] as string[])}
      />
    </div>
  );
};

export const SingleSelectWithPreselected = () => {
  const [val, setVal] = useState<string[]>(["components-storybook"]);
  return (
    <div style={{ maxWidth: 360, padding: 24 }}>
      <BadgeSelect
        id="bs-single-preselected"
        options={mockProjects}
        value={val}
        multiple={false}
        events={["OnChange"]}
        eventHandler={(_evt, _id, args) => setVal(args[0] as string[])}
      />
    </div>
  );
};

export const MultiSelectWithPreselected = () => {
  const [val, setVal] = useState<string[]>([
    "tendril",
    "components-storybook",
    "ivy-framework",
    "lots-of-dev-tools",
  ]);
  return (
    <div style={{ maxWidth: 400, padding: 24 }}>
      <BadgeSelect
        id="bs-multi"
        options={mockProjects}
        value={val}
        multiple={true}
        actions={mockActions}
        events={["OnChange", "OnAction"]}
        eventHandler={(evt, _id, args) => {
          if (evt === "OnChange") setVal(args[0] as string[]);
        }}
      />
    </div>
  );
};

export const EmptyMultiSelectWithActions = () => {
  const [val, setVal] = useState<string[]>([]);
  return (
    <div style={{ maxWidth: 360, padding: 24 }}>
      <BadgeSelect
        id="bs-empty-multi"
        options={mockTags}
        value={val}
        multiple={true}
        placeholder="Filter tags..."
        actions={mockActions}
        events={["OnChange", "OnAction"]}
        eventHandler={(evt, _id, args) => {
          if (evt === "OnChange") setVal(args[0] as string[]);
        }}
      />
    </div>
  );
};

export const CustomBadgeColorsAndStyling = () => {
  const [val, setVal] = useState<string[]>(["bug", "urgent"]);
  return (
    <div
      style={
        {
          maxWidth: 400,
          padding: 24,
          "--secondary": "#fee2e2",
          "--secondary-foreground": "#991b1b",
          "--border": "#fca5a5",
        } as CSSProperties
      }
    >
      <BadgeSelect
        id="bs-custom-colors"
        options={mockTags}
        value={val}
        multiple={true}
        placeholder="Urgent issues..."
        events={["OnChange"]}
        eventHandler={(_evt, _id, args) => setVal(args[0] as string[])}
      />
    </div>
  );
};
