import type { Meta, StoryObj } from "@storybook/react";
import { MultiSelect, type Option } from "@/components/ui/multiselect";
import type { SearchMode } from "@/components/ui/select/utils";
import * as React from "react";

const meta: Meta = {
  title: "UI/MultiSelect",
};

export default meta;

const frameworksList: Option[] = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
  { value: "angular", label: "Angular" },
];

const MultiSelectDemo = () => {
  const [selected, setSelected] = React.useState<Option[]>([]);
  return (
    <div className="w-[400px]">
      <MultiSelect
        defaultOptions={frameworksList}
        value={selected}
        onValueChange={setSelected}
        placeholder="Select frameworks..."
      />
    </div>
  );
};

export const Default: StoryObj = {
  render: () => <MultiSelectDemo />,
};

const MultiSelectSearchModesDemo = () => {
  const [selected, setSelected] = React.useState<Option[]>([]);
  const [mode, setMode] = React.useState<SearchMode>("CaseInsensitive");

  return (
    <div className="w-[400px] flex flex-col gap-4">
      <div className="flex gap-2">
        {(["CaseInsensitive", "CaseSensitive", "Fuzzy"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`px-2 py-1 text-xs rounded border ${mode === m ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <MultiSelect
        defaultOptions={frameworksList}
        value={selected}
        onValueChange={setSelected}
        searchMode={mode}
        placeholder={`Search in ${mode} mode...`}
      />
    </div>
  );
};

export const SearchModes: StoryObj = {
  render: () => <MultiSelectSearchModesDemo />,
};

const MultiSelectEmptyMessageDemo = () => {
  const [selected, setSelected] = React.useState<Option[]>([]);

  return (
    <div className="w-[400px]">
      <MultiSelect
        defaultOptions={frameworksList}
        value={selected}
        onValueChange={setSelected}
        emptyMessage="No matching frameworks found. Try another query."
        placeholder="Type to see custom empty message..."
      />
    </div>
  );
};

export const EmptyMessage: StoryObj = {
  render: () => <MultiSelectEmptyMessageDemo />,
};
