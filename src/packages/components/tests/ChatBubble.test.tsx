import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { ChatBubble, ChatBubbleMessage } from "../src/components/ChatBubble";

describe("ChatBubble", () => {
  it("renders sent variant with flex-row-reverse", () => {
    const { container } = render(
      <ChatBubble variant="sent">
        <ChatBubbleMessage variant="sent">Sent message</ChatBubbleMessage>
      </ChatBubble>,
    );
    const bubble = container.firstElementChild;
    expect(bubble?.className).toContain("flex-row-reverse");
  });

  it("renders received variant with default alignment", () => {
    const { container } = render(
      <ChatBubble variant="received">
        <ChatBubbleMessage variant="received">Received message</ChatBubbleMessage>
      </ChatBubble>,
    );
    const bubble = container.firstElementChild;
    expect(bubble?.className).not.toContain("flex-row-reverse");
    expect(container.textContent).toContain("Received message");
  });
});
