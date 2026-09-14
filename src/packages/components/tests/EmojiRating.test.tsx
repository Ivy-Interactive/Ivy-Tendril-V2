import { render, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { EmojiRating } from "../src/components/EmojiRating";

describe("EmojiRating", () => {
  it("renders 5 default emoji buttons", () => {
    const { container } = render(<EmojiRating />);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(5);
  });

  it("fires onRate callback on click with correct rating value", () => {
    const handleRate = vi.fn();
    const { container } = render(<EmojiRating onRate={handleRate} />);
    const buttons = container.querySelectorAll("button");

    fireEvent.click(buttons[3]);
    expect(handleRate).toHaveBeenCalledWith(4);
  });

  it("disables interaction when disabled is true", () => {
    const handleRate = vi.fn();
    const { container } = render(<EmojiRating disabled onRate={handleRate} />);
    const buttons = container.querySelectorAll("button");
    fireEvent.click(buttons[2]);
    expect(handleRate).not.toHaveBeenCalled();
  });
});
