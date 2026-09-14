import { expect, test } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import { TextShimmer } from "../src/components/TextShimmer";

test("TextShimmer renders text content", () => {
  render(<TextShimmer>Loading</TextShimmer>);
  const text = screen.getByText("Loading");
  expect(text).toBeDefined();
  expect(text.textContent).toBe("Loading");
});

test("TextShimmer renders with custom component", () => {
  render(<TextShimmer as="h1">Shimmer Title</TextShimmer>);
  const text = screen.getByText("Shimmer Title");
  expect(text).toBeDefined();
  expect(text.textContent).toBe("Shimmer Title");
});

test("TextShimmer renders with custom className", () => {
  render(<TextShimmer className="custom-class">Test</TextShimmer>);
  const element = screen.getByText("Test");
  expect(element.className).toContain("custom-class");
});
