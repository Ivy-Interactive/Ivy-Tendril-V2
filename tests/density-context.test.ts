import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { DensityProvider, useDensity } from "../src/contexts/density-context";
import { Densities } from "../src/types/density";

describe("DensityContext", () => {
  it("provides default Medium density when no value is specified", () => {
    const TestComponent = () => {
      const density = useDensity();
      return React.createElement("div", { "data-testid": "density-value" }, density);
    };

    render(React.createElement(DensityProvider, {}, React.createElement(TestComponent)));

    expect(screen.getByTestId("density-value").textContent).toBe(Densities.Medium);
  });

  it("provides specified density from DensityProvider", () => {
    const TestComponent = () => {
      const density = useDensity();
      return React.createElement("div", { "data-testid": "density-value" }, density);
    };

    render(
      React.createElement(
        DensityProvider,
        { density: Densities.Small },
        React.createElement(TestComponent),
      ),
    );

    expect(screen.getByTestId("density-value").textContent).toBe(Densities.Small);
  });

  it("provides Large density when specified", () => {
    const TestComponent = () => {
      const density = useDensity();
      return React.createElement("div", { "data-testid": "density-value" }, density);
    };

    render(
      React.createElement(
        DensityProvider,
        { density: Densities.Large },
        React.createElement(TestComponent),
      ),
    );

    expect(screen.getByTestId("density-value").textContent).toBe(Densities.Large);
  });

  it("renders children within DensityProvider", () => {
    render(
      React.createElement(
        DensityProvider,
        { density: Densities.Medium },
        React.createElement("div", { "data-testid": "child" }, "Child content"),
      ),
    );

    expect(screen.getByTestId("child").textContent).toBe("Child content");
  });
});
