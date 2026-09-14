import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Icon } from "../src/components/Icon";

describe("Icon component", () => {
  it("renders custom SVG icons", () => {
    const { container: ag } = render(<Icon name="Antigravity" />);
    expect(ag.querySelector("svg")).not.toBeNull();

    const { container: oc } = render(<Icon name="OpenCode" />);
    expect(oc.querySelector("svg")).not.toBeNull();

    const { container: cc } = render(<Icon name="ClaudeCode" />);
    expect(cc.querySelector("svg")).not.toBeNull();

    const { container: ic } = render(<Icon name="IvyCorner" />);
    expect(ic.querySelector("svg")).not.toBeNull();
  });

  it("renders brand icons from react-icons", () => {
    const { container } = render(<Icon name="Github" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders Lucide icons", () => {
    const { container } = render(<Icon name="Heart" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("returns null or fallback for invalid icon names", () => {
    const { container } = render(<Icon name="NonExistentIconName123" />);
    expect(container.firstChild).toBeNull();
  });
});
