import { describe, expect, it } from "vite-plus/test";
import { render } from "@testing-library/react";
import { DensityProvider } from "@/contexts/density-context";
import { Densities } from "@/types/density";
import { EmojiRating } from "@/components/EmojiRating";
import { StarRating } from "@/components/StarRating";
import { NumberInput } from "@/components/NumberInput";
import { Slider } from "@/components/ui/slider";
import { MultipleSelector } from "@/components/ui/multiselect";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle";

describe("Density cascade to controls", () => {
  describe("EmojiRating", () => {
    it("uses Small density from provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <EmojiRating value={3} />
        </DensityProvider>,
      );
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("text-lg");
    });

    it("explicit Large density overrides Small provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <EmojiRating value={3} density={Densities.Large} />
        </DensityProvider>,
      );
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("text-4xl");
    });

    it("uses Medium density with no provider", () => {
      const { container } = render(<EmojiRating value={3} />);
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("text-2xl");
    });
  });

  describe("StarRating", () => {
    it("uses Small density from provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <StarRating value={3} />
        </DensityProvider>,
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("size-4");
    });

    it("explicit Large density overrides Small provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <StarRating value={3} density={Densities.Large} />
        </DensityProvider>,
      );
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("size-8");
    });

    it("uses Medium density with no provider", () => {
      const { container } = render(<StarRating value={3} />);
      const svg = container.querySelector("svg");
      expect(svg?.getAttribute("class")).toContain("size-6");
    });
  });

  describe("NumberInput", () => {
    it("uses Small density from provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <NumberInput value={42} />
        </DensityProvider>,
      );
      const input = container.querySelector("input");
      expect(input?.getAttribute("class")).toContain("h-7");
    });

    it("explicit Large density overrides Small provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <NumberInput value={42} density={Densities.Large} />
        </DensityProvider>,
      );
      const input = container.querySelector("input");
      expect(input?.getAttribute("class")).toContain("h-11");
    });

    it("uses Medium density with no provider", () => {
      const { container } = render(<NumberInput value={42} />);
      const input = container.querySelector("input");
      expect(input?.getAttribute("class")).toContain("h-9");
    });
  });

  describe("Slider", () => {
    it("uses Small density from provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Slider defaultValue={[50]} />
        </DensityProvider>,
      );
      const track = container.querySelector('[role="slider"]')?.previousElementSibling;
      const thumb = container.querySelector('[role="slider"]');
      expect(track?.getAttribute("class")).toContain("h-1");
      expect(thumb?.getAttribute("class")).toContain("size-3");
    });

    it("explicit Large density overrides Small provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Slider defaultValue={[50]} density={Densities.Large} />
        </DensityProvider>,
      );
      const track = container.querySelector('[role="slider"]')?.previousElementSibling;
      const thumb = container.querySelector('[role="slider"]');
      expect(track?.getAttribute("class")).toContain("h-2");
      expect(thumb?.getAttribute("class")).toContain("size-5");
    });

    it("uses Medium density with no provider", () => {
      const { container } = render(<Slider defaultValue={[50]} />);
      const track = container.querySelector('[role="slider"]')?.previousElementSibling;
      const thumb = container.querySelector('[role="slider"]');
      expect(track?.getAttribute("class")).toContain("h-1.5");
      expect(thumb?.getAttribute("class")).toContain("size-4");
    });
  });

  describe("MultipleSelector", () => {
    it("uses Small density from provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <MultipleSelector value={[]} defaultOptions={[]} />
        </DensityProvider>,
      );
      const trigger = container.querySelector('[role="combobox"]')?.parentElement;
      expect(trigger?.getAttribute("class")).toContain("h-7");
      expect(trigger?.getAttribute("class")).toContain("text-xs");
    });

    it("explicit Large density overrides Small provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <MultipleSelector value={[]} defaultOptions={[]} density={Densities.Large} />
        </DensityProvider>,
      );
      const trigger = container.querySelector('[role="combobox"]')?.parentElement;
      expect(trigger?.getAttribute("class")).toContain("h-11");
      expect(trigger?.getAttribute("class")).toContain("text-base");
    });

    it("uses Medium density with no provider", () => {
      const { container } = render(<MultipleSelector value={[]} defaultOptions={[]} />);
      const trigger = container.querySelector('[role="combobox"]')?.parentElement;
      expect(trigger?.getAttribute("class")).toContain("h-9");
      expect(trigger?.getAttribute("class")).toContain("text-sm");
    });
  });

  describe("Toggle", () => {
    it("uses Small density from provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Toggle>Toggle</Toggle>
        </DensityProvider>,
      );
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("h-8");
      expect(button?.getAttribute("class")).toContain("px-1.5");
    });

    it("explicit Large density overrides Small provider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <Toggle density={Densities.Large}>Toggle</Toggle>
        </DensityProvider>,
      );
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("h-10");
      expect(button?.getAttribute("class")).toContain("px-2.5");
    });

    it("uses Medium density with no provider", () => {
      const { container } = render(<Toggle>Toggle</Toggle>);
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("h-9");
      expect(button?.getAttribute("class")).toContain("px-2");
    });
  });

  describe("ToggleGroupItem density cascade", () => {
    it("inside ToggleGroup with no density, uses Small from DensityProvider", () => {
      const { container } = render(
        <DensityProvider density={Densities.Small}>
          <ToggleGroup type="single">
            <ToggleGroupItem value="test">Item</ToggleGroupItem>
          </ToggleGroup>
        </DensityProvider>,
      );
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("h-8");
    });

    it("with density prop and no ToggleGroup wrapper, respects own density", () => {
      const { container } = render(<ToggleGroupItem value="test" density={Densities.Large} />);
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("h-10");
    });

    it("ToggleGroup density wins over item density", () => {
      const { container } = render(
        <ToggleGroup type="single" density={Densities.Small}>
          <ToggleGroupItem value="test" density={Densities.Large}>
            Item
          </ToggleGroupItem>
        </ToggleGroup>,
      );
      const button = container.querySelector("button");
      expect(button?.getAttribute("class")).toContain("h-8");
    });
  });
});
