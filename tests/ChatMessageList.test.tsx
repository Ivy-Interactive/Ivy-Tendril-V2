import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { ChatMessageList } from "../src/components/ChatMessageList";

describe("ChatMessageList", () => {
  it("renders message children inside scroll container", () => {
    const { container } = render(
      <ChatMessageList>
        <div>Message 1</div>
        <div>Message 2</div>
      </ChatMessageList>,
    );
    expect(container.textContent).toContain("Message 1");
    expect(container.textContent).toContain("Message 2");
    expect(container.querySelector(".overflow-y-auto")).not.toBeNull();
  });
});
