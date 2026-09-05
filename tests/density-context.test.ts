import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";
import { DensityProvider, useDensity } from "../src/contexts/density-context";
import { Densities } from "../src/types/density";
import { Button } from "../src/components/ui/button/button";
import { Input } from "../src/components/ui/input";
import { Badge } from "../src/components/ui/badge/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../src/components/ui/select";
import { Checkbox } from "../src/components/ui/checkbox";
import { densityToButtonSize, densityToBadgeDensity } from "../src/components/ui/density-scale";

describe("DensityContext", () => {
  it("provides default Medium density when no value is specified", () => {
    const TestComponent = () => {
      const density = useDensity();
      return React.createElement("div", { "data-testid": "density-value" }, density);
    };

    render(React.createElement(DensityProvider, {} as any, React.createElement(TestComponent)));

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
        { density: Densities.Small } as any,
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
        { density: Densities.Large } as any,
        React.createElement(TestComponent),
      ),
    );

    expect(screen.getByTestId("density-value").textContent).toBe(Densities.Large);
  });

  it("renders children within DensityProvider", () => {
    render(
      React.createElement(
        DensityProvider,
        { density: Densities.Medium } as any,
        React.createElement("div", { "data-testid": "child" }, "Child content"),
      ),
    );

    expect(screen.getByTestId("child").textContent).toBe("Child content");
  });
});

describe("Component Density Cascade", () => {
  describe("Button", () => {
    it("cascades Small density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Small } as any,
          React.createElement(Button, { "data-testid": "button" } as any, "Click me"),
        ),
      );

      const button = screen.getByTestId("button");
      expect(button.className).toContain("h-7");
    });

    it("cascades Large density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Large } as any,
          React.createElement(Button, { "data-testid": "button" } as any, "Click me"),
        ),
      );

      const button = screen.getByTestId("button");
      expect(button.className).toContain("h-11");
    });

    it("defaults to Medium density with no provider", () => {
      render(React.createElement(Button, { "data-testid": "button" } as any, "Click me"));

      const button = screen.getByTestId("button");
      expect(button.className).toContain("h-9");
    });

    it("explicit size prop overrides context", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Small } as any,
          React.createElement(Button, { size: "lg", "data-testid": "button" } as any, "Click me"),
        ),
      );

      const button = screen.getByTestId("button");
      expect(button.className).toContain("h-11");
    });
  });

  describe("Input", () => {
    it("cascades Small density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Small } as any,
          React.createElement(Input, { "data-testid": "input" } as any),
        ),
      );

      const input = screen.getByTestId("input");
      expect(input.className).toContain("text-xs");
    });

    it("cascades Large density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Large } as any,
          React.createElement(Input, { "data-testid": "input" } as any),
        ),
      );

      const input = screen.getByTestId("input");
      expect(input.className).toContain("text-base");
    });
  });

  describe("Badge", () => {
    it("cascades Small density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Small } as any,
          React.createElement(Badge, { "data-testid": "badge" } as any, "Badge"),
        ),
      );

      const badge = screen.getByTestId("badge");
      expect(badge.className).toContain("text-[10px]");
    });

    it("explicit density prop overrides context", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Small } as any,
          React.createElement(Badge, { density: "large", "data-testid": "badge" } as any, "Badge"),
        ),
      );

      const badge = screen.getByTestId("badge");
      expect(badge.className).toContain("text-sm");
    });
  });

  describe("Select", () => {
    it("cascades density through the portal", async () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Small } as any,
          React.createElement(
            Select,
            null,
            React.createElement(
              SelectTrigger,
              { "data-testid": "trigger" } as any,
              React.createElement(SelectValue, { placeholder: "Select..." } as any),
            ),
            React.createElement(
              SelectContent,
              { "data-testid": "content" } as any,
              React.createElement(SelectItem, { value: "1" } as any, "Item 1"),
            ),
          ),
        ),
      );

      const trigger = screen.getByTestId("trigger");
      expect(trigger.className).toContain("text-xs");

      // Open the select to render the portal
      fireEvent.click(trigger);

      await waitFor(() => {
        const content = screen.getByTestId("content");
        expect(content.className).toContain("text-xs");
      });
    });
  });

  describe("Checkbox", () => {
    it("cascades Small density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Small } as any,
          React.createElement(Checkbox, { "data-testid": "checkbox" } as any),
        ),
      );

      const checkbox = screen.getByTestId("checkbox");
      expect(checkbox.className).toContain("size-3");
    });

    it("cascades Medium density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Medium } as any,
          React.createElement(Checkbox, { "data-testid": "checkbox" } as any),
        ),
      );

      const checkbox = screen.getByTestId("checkbox");
      expect(checkbox.className).toContain("size-4");
    });

    it("cascades Large density from provider", () => {
      render(
        React.createElement(
          DensityProvider,
          { density: Densities.Large } as any,
          React.createElement(Checkbox, { "data-testid": "checkbox" } as any),
        ),
      );

      const checkbox = screen.getByTestId("checkbox");
      expect(checkbox.className).toContain("size-5");
    });
  });
});

describe("Mapping Helpers", () => {
  describe("densityToButtonSize", () => {
    it("maps Small to sm", () => {
      expect(densityToButtonSize(Densities.Small)).toBe("sm");
    });

    it("maps Medium to default", () => {
      expect(densityToButtonSize(Densities.Medium)).toBe("default");
    });

    it("maps Large to lg", () => {
      expect(densityToButtonSize(Densities.Large)).toBe("lg");
    });
  });

  describe("densityToBadgeDensity", () => {
    it("maps Small to small", () => {
      expect(densityToBadgeDensity(Densities.Small)).toBe("small");
    });

    it("maps Medium to medium", () => {
      expect(densityToBadgeDensity(Densities.Medium)).toBe("medium");
    });

    it("maps Large to large", () => {
      expect(densityToBadgeDensity(Densities.Large)).toBe("large");
    });
  });
});
