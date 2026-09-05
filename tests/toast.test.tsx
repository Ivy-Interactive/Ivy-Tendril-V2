import { render, screen, act } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { Toaster } from "../src/components/ui/toaster";
import { toast } from "../src/hooks/use-toast";

describe("Toast notification system", () => {
  it("dispatches and renders a toast notification", () => {
    render(<Toaster />);

    act(() => {
      toast({
        title: "Test Toast",
        description: "Test Description",
      });
    });

    expect(screen.getByText("Test Toast")).toBeDefined();
    expect(screen.getByText("Test Description")).toBeDefined();
  });

  it("allows dismissing a toast manually", () => {
    render(<Toaster />);

    let handle: { dismiss: () => void } | undefined;
    act(() => {
      handle = toast({
        title: "Dismissible",
      });
    });

    expect(screen.getByText("Dismissible")).toBeDefined();

    act(() => {
      handle?.dismiss();
    });
  });
});
