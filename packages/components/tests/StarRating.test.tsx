import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { StarRating } from "../src/components/StarRating";

describe("StarRating", () => {
  it("renders 5 stars by default", () => {
    const { container } = render(<StarRating value={3} />);
    const stars = container.querySelectorAll("svg");
    expect(stars.length).toBeGreaterThanOrEqual(5);
  });

  it("disables interaction when disabled is true", () => {
    const handleRate = vi.fn();
    const { container } = render(<StarRating disabled value={2} onRate={handleRate} />);
    const firstStar = container.querySelector("svg");
    if (firstStar) {
      fireEvent.click(firstStar);
    }
    expect(handleRate).not.toHaveBeenCalled();
  });
});
