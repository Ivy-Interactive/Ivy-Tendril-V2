import type { Meta } from "@storybook/react";
import { DensityProvider } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { EmojiRating } from "@/components/EmojiRating";
import { StarRating } from "@/components/StarRating";
import { NumberInput } from "@/components/NumberInput";
import { Slider } from "@/components/ui/slider";
import { MultipleSelector } from "@/components/ui/multiselect";
import { Toggle } from "@/components/ui/toggle";

const meta = {
  title: "Density/Control Cascade",
  component: DensityProvider,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof DensityProvider>;

export default meta;

const ControlsGrid = ({ density }: { density: Densities }) => (
  <DensityProvider density={density}>
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm font-medium">EmojiRating:</span>
        <EmojiRating value={3} />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm font-medium">StarRating:</span>
        <StarRating value={3} />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm font-medium">NumberInput:</span>
        <NumberInput value={42} className="w-48" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm font-medium">Slider:</span>
        <Slider defaultValue={[50]} className="w-48" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm font-medium">MultipleSelector:</span>
        <MultipleSelector
          value={[]}
          defaultOptions={[
            { label: "Option 1", value: "opt1" },
            { label: "Option 2", value: "opt2" },
          ]}
          className="w-48"
        />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-32 text-sm font-medium">Toggle:</span>
        <Toggle>Toggle</Toggle>
      </div>
    </div>
  </DensityProvider>
);

export const SmallDensity = {
  render: () => <ControlsGrid density={Densities.Small} />,
};

export const MediumDensity = {
  render: () => <ControlsGrid density={Densities.Medium} />,
};

export const LargeDensity = {
  render: () => <ControlsGrid density={Densities.Large} />,
};

export const AllDensitiesComparison = {
  render: () => (
    <div className="grid grid-cols-3 gap-8">
      <div>
        <h3 className="text-lg font-semibold mb-4">Small</h3>
        <ControlsGrid density={Densities.Small} />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Medium</h3>
        <ControlsGrid density={Densities.Medium} />
      </div>
      <div>
        <h3 className="text-lg font-semibold mb-4">Large</h3>
        <ControlsGrid density={Densities.Large} />
      </div>
    </div>
  ),
};
