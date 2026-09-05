import { expect, test } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { TextShimmer } from "../src/components/TextShimmer";

test("TextShimmer renders text content", () => {
  render(<TextShimmer>Loading</TextShimmer>);
  expect(screen.getByText("Loading")).toBeInTheDocument();
});

test("TextShimmer renders with custom component", () => {
  render(<TextShimmer as="h1">Shimmer Title</TextShimmer>);
  expect(screen.getByText("Shimmer Title")).toBeInTheDocument();
});

test("TextShimmer renders with custom className", () => {
  render(<TextShimmer className="custom-class">Test</TextShimmer>);
  const element = screen.getByText("Test");
  expect(element).toHaveClass("custom-class");
});
