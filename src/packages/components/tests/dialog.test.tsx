import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../src/components/ui/dialog";

describe("Dialog component", () => {
  it("opens and closes via trigger and close button", () => {
    render(
      <Dialog>
        <DialogTrigger>Open Modal</DialogTrigger>
        <DialogContent>
          <DialogTitle>Modal Title</DialogTitle>
          <DialogDescription>Modal Description</DialogDescription>
          <DialogClose>Close Modal</DialogClose>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText("Modal Title")).toBeNull();
    const trigger = screen.getByText("Open Modal");
    fireEvent.click(trigger);
    expect(screen.getByText("Modal Title")).toBeDefined();

    const closeBtn = screen.getByText("Close Modal");
    fireEvent.click(closeBtn);
    expect(screen.queryByText("Modal Title")).toBeNull();
  });
});
