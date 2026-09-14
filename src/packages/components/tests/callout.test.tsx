import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { X } from "lucide-react";

import { Callout, type CalloutVariant } from "../src/components/ui/callout";
import { Densities } from "../src/types/density";

const variantClasses: Record<CalloutVariant, string> = {
  info: "bg-info/10",
  success: "bg-success/10",
  warning: "bg-warning/10",
  error: "bg-destructive/10",
  neutral: "bg-muted",
};

const allVariants = Object.keys(variantClasses) as CalloutVariant[];

describe("Callout component", () => {
  it("renders its body and variant class for each variant", () => {
    for (const variant of allVariants) {
      const { unmount } = render(<Callout variant={variant}>Body for {variant}</Callout>);
      const body = screen.getByText(`Body for ${variant}`);
      const root = body.closest("[class*='rounded-box']");
      expect(root).not.toBeNull();
      expect(root?.className).toContain(variantClasses[variant]);
      unmount();
    }
  });

  it("uses role=alert for error and warning and role=status otherwise", () => {
    render(
      <>
        <Callout variant="error">Boom</Callout>
        <Callout variant="warning">Careful</Callout>
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);

    for (const variant of ["info", "success", "neutral"] as const) {
      const { unmount } = render(<Callout variant={variant}>Polite</Callout>);
      expect(screen.getByRole("status")).toBeDefined();
      unmount();
    }
  });

  it("lets an explicit role prop override the computed role", () => {
    render(
      <Callout variant="error" role="status">
        Handled
      </Callout>,
    );
    expect(screen.getByRole("status")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("associates the title and body with the root via real element ids", () => {
    render(
      <Callout variant="error" title="Commits At Risk">
        Two commits are unpushed.
      </Callout>,
    );

    const root = screen.getByRole("alert");
    const titleId = root.getAttribute("aria-labelledby");
    const bodyId = root.getAttribute("aria-describedby");
    expect(titleId).toBeTruthy();
    expect(bodyId).toBeTruthy();

    const titleEl = document.getElementById(titleId as string);
    const bodyEl = document.getElementById(bodyId as string);
    expect(titleEl?.textContent).toBe("Commits At Risk");
    expect(bodyEl?.textContent).toBe("Two commits are unpushed.");
  });

  it("omits aria-labelledby when there is no title", () => {
    render(<Callout variant="info">Body only</Callout>);
    const root = screen.getByRole("status");
    expect(root.getAttribute("aria-labelledby")).toBeNull();
    expect(root.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("renders a variant-specific default icon that is hidden from assistive tech", () => {
    const iconFor = (variant: CalloutVariant) => {
      const { container, unmount } = render(<Callout variant={variant}>Body</Callout>);
      const wrapper = container.querySelector("[aria-hidden='true']");
      expect(wrapper).not.toBeNull();
      const svgClass = wrapper?.querySelector("svg")?.getAttribute("class") ?? "";
      unmount();
      return svgClass;
    };

    // lucide stamps the icon name into the svg class, so this distinguishes the defaults.
    expect(iconFor("info")).toContain("lucide-info");
    expect(iconFor("success")).toContain("lucide-circle-check");
    expect(iconFor("warning")).toContain("lucide-triangle-alert");
    expect(iconFor("error")).toContain("lucide-circle-alert");
  });

  it("replaces the icon with a custom node and drops it entirely for icon={false}", () => {
    const { container: custom } = render(
      <Callout variant="info" icon={<X data-testid="custom-icon" />}>
        Body
      </Callout>,
    );
    expect(custom.querySelector("[data-testid='custom-icon']")).not.toBeNull();

    const { container: none } = render(
      <Callout variant="info" icon={false}>
        Body
      </Callout>,
    );
    expect(none.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("renders the dismiss button only with onDismiss and fires the callback", () => {
    const { unmount } = render(<Callout variant="info">No dismiss</Callout>);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    unmount();

    const onDismiss = vi.fn();
    render(
      <Callout variant="info" onDismiss={onDismiss}>
        Dismissable
      </Callout>,
    );
    const button = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("names the dismiss button with dismissLabel when given", () => {
    render(
      <Callout variant="info" onDismiss={() => {}} dismissLabel="Close banner">
        Dismissable
      </Callout>,
    );
    expect(screen.getByRole("button", { name: "Close banner" })).toBeDefined();
  });

  it("renders Callout.Error identically to Callout variant=error", () => {
    const { container: shorthand, unmount } = render(
      <Callout.Error title="Commits At Risk">Two commits are unpushed.</Callout.Error>,
    );
    const shorthandHtml = shorthand.innerHTML;
    unmount();

    const { container: explicit } = render(
      <Callout variant="error" title="Commits At Risk">
        Two commits are unpushed.
      </Callout>,
    );

    // useId differs between renders, so compare with the generated ids stripped out.
    const normalize = (html: string) =>
      html.replace(/(id|aria-labelledby|aria-describedby)="[^"]*"/g, '$1="ID"');
    expect(normalize(shorthandHtml)).toBe(normalize(explicit.innerHTML));
  });

  it("exposes every semantic shorthand", () => {
    render(
      <>
        <Callout.Info>Info body</Callout.Info>
        <Callout.Success>Success body</Callout.Success>
        <Callout.Warning>Warning body</Callout.Warning>
        <Callout.Neutral>Neutral body</Callout.Neutral>
      </>,
    );
    expect(screen.getByText("Info body")).toBeDefined();
    expect(screen.getByText("Success body")).toBeDefined();
    expect(screen.getByText("Warning body")).toBeDefined();
    expect(screen.getByText("Neutral body")).toBeDefined();
  });

  it("applies the density padding scale", () => {
    const paddingFor = (density: Densities) => {
      const { unmount } = render(
        <Callout variant="info" density={density}>
          Body
        </Callout>,
      );
      const root = screen.getByRole("status");
      const className = root.className;
      unmount();
      return className;
    };

    expect(paddingFor(Densities.Small)).toContain("py-2.5");
    expect(paddingFor(Densities.Medium)).toContain("p-4");
    expect(paddingFor(Densities.Large)).toContain("p-6");
  });
});
