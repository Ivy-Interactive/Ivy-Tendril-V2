import type { Meta, StoryObj } from "@storybook/react";
import { MultiSelect } from "@/components/ui/multiselect";
import * as React from "react";

const meta: Meta = {
  title: "UI/MultiSelect",
};

export default meta;

const frameworksList = [
  { value: "react", label: "React" },
  { value: "vue", label: "Vue" },
  { value: "svelte", label: "Svelte" },
  { value: "angular", label: "Angular" },
];

const MultiSelectDemo = () => {
  const [selected, setSelected] = React.useState<any[]>([]);
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
