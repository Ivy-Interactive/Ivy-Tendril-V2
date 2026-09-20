import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../src/components/ui/tabs";

describe("Tabs component", () => {
  it("activates tabs and switches panels", () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText("Content 1")).toBeDefined();
    const tab2 = screen.getByRole("tab", { name: "Tab 2" });
    fireEvent.click(tab2);
    expect(screen.getByText("Content 2")).toBeDefined();
  });

  it("renders correct accessibility attributes", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "A" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  /**
   * jsdom resolves no Tailwind cascade -- it never computes a colour -- so the class string is the
   * only honest witness available here. Asserting the visible token is present AND the invisible ones
   * are absent (the `SidebarListRow.test.tsx:232-233` pattern) keeps this catching the real bug: the
   * old `hover:bg-muted/50` sat on a `bg-muted` `TabsList`, i.e. muted-at-50% over muted, which
   * measures exactly 1.000:1 and changed zero pixels on hover. A bare `toContain` of a literal string
   * would have pinned that defect in place instead of catching it.
   */
  it("gives tab triggers a hover fill that is actually visible", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
      </Tabs>,
    );
    const tab = screen.getByRole("tab", { name: "A" });
    expect(tab.className).toContain("hover:bg-secondary/60");
    expect(tab.className).toContain("hover:text-foreground");
    expect(tab.className).not.toContain("hover:bg-muted");
    expect(tab.className).not.toContain("hover:bg-accent");
  });
});
