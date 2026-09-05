import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  DensityProvider,
  DensityScale,
  useDensityScale,
  useDensity,
} from "@/contexts/density-context";
import { Densities } from "@/types/density";

describe("useDensityScale", () => {
  it("returns Medium scale values with no provider", () => {
    let scale;
    function TestComponent() {
      scale = useDensityScale();
      return null;
    }
    render(<TestComponent />);
    expect(scale).toEqual({
      density: Densities.Medium,
      controlHeight: "h-9",
      controlSize: "size-9",
      height: "h-10",
      heightLg: "h-12",
      text: "text-sm",
      treeGap: "gap-1",
    });
  });

  it("returns Small scale values inside Small provider", () => {
    let scale;
    function TestComponent() {
      scale = useDensityScale();
      return null;
    }
    render(
      <DensityProvider density={Densities.Small}>
        <TestComponent />
      </DensityProvider>,
    );
    expect(scale).toEqual({
      density: Densities.Small,
      controlHeight: "h-7",
      controlSize: "size-7",
      height: "h-8",
      heightLg: "h-10",
      text: "text-xs",
      treeGap: "gap-0.5",
    });
  });

  it("explicit argument overrides provider", () => {
    let scale;
    function TestComponent() {
      scale = useDensityScale(Densities.Large);
      return null;
    }
    render(
      <DensityProvider density={Densities.Small}>
        <TestComponent />
      </DensityProvider>,
    );
    expect(scale).toEqual({
      density: Densities.Large,
      controlHeight: "h-11",
      controlSize: "size-11",
      height: "h-12",
      heightLg: "h-14",
      text: "text-base",
      treeGap: "gap-1.5",
    });
  });
});

describe("DensityScale", () => {
  it("inherits from surrounding provider", () => {
    render(
      <DensityProvider density={Densities.Small}>
        <DensityScale data-testid="scale">Content</DensityScale>
      </DensityProvider>,
    );
    const element = screen.getByTestId("scale");
    expect(element.getAttribute("data-density")).toBe("small");
    expect(element.className).toContain("text-xs");
  });

  it("re-provides density to subtree", () => {
    let childDensity;
    function ChildComponent() {
      childDensity = useDensity();
      return <span>Child</span>;
    }
    render(
      <DensityProvider density={Densities.Small}>
        <DensityScale density={Densities.Large}>
          <ChildComponent />
        </DensityScale>
      </DensityProvider>,
    );
    expect(childDensity).toBe(Densities.Large);
  });

  it("renders no extra wrapper with asChild", () => {
    render(
      <DensityProvider density={Densities.Medium}>
        <DensityScale asChild>
          <button data-testid="button">Click</button>
        </DensityScale>
      </DensityProvider>,
    );
    const button = screen.getByTestId("button");
    expect(button.tagName).toBe("BUTTON");
    expect(button.className).toContain("text-sm");
    expect(button.getAttribute("data-density")).toBe("medium");
  });
});
