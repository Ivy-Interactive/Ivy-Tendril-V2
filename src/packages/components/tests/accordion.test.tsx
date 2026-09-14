import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "../src/components/ui/accordion";

describe("Accordion component", () => {
  it("expands and collapses items", () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Section 1</AccordionTrigger>
          <AccordionContent>Section 1 Body</AccordionContent>
        </AccordionItem>
      </Accordion>,
    );

    const trigger = screen.getByRole("button", { name: "Section 1" });
    expect(trigger.getAttribute("data-state")).toBe("closed");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("data-state")).toBe("open");
    expect(screen.getByText("Section 1 Body")).toBeDefined();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("data-state")).toBe("closed");
  });
});
