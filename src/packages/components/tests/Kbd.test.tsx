import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Kbd, ShortcutKeys } from "../src/components/Kbd";

describe("Kbd", () => {
  it("renders the whole shortcut inside a single cap", () => {
    const { container } = render(<Kbd keys="Ctrl+Shift+C" />);
    const caps = container.querySelectorAll("kbd");
    expect(caps).toHaveLength(1);
  });

  it("uppercases a lone letter", () => {
    const { container } = render(<Kbd keys="c" />);
    expect(container.querySelector("kbd")?.textContent).toBe("C");
  });

  it("renders symbols and modifier names verbatim", () => {
    const { container } = render(<Kbd keys="⌘+⌥+N" />);
    const cap = container.querySelector("kbd");
    expect(cap?.querySelector("svg")).toBeNull();
    expect(cap?.textContent).toBe("\u2318\u2009\u2325\u2009N");
  });

  it("renders Enter and Backspace as symbols", () => {
    const { container: c1 } = render(<Kbd keys="Enter" />);
    expect(c1.querySelector("kbd")?.textContent).toBe("↵");

    const { container: c2 } = render(<Kbd keys="Backspace" />);
    expect(c2.querySelector("kbd")?.textContent).toBe("⌫");
  });

  it("renders a ghost cap without background or border", () => {
    const { container } = render(<Kbd keys="A" ghost />);
    const cap = container.querySelector("kbd");
    expect(cap?.className).toContain("border-0");
    expect(cap?.className).toContain("bg-transparent");
  });
});

describe("ShortcutKeys", () => {
  it("renders the shortcut as text in a single cap", () => {
    const { container } = render(<ShortcutKeys shortcut="Ctrl+K" />);
    const caps = container.querySelectorAll("kbd");
    expect(caps).toHaveLength(1);
    expect(caps[0].textContent).toBe("Ctrl+K");
  });

  it("renders nothing for an empty shortcut", () => {
    const { container } = render(<ShortcutKeys shortcut="" />);
    expect(container.querySelectorAll("kbd")).toHaveLength(0);
  });
});
