import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";
import { SendHorizontal, Paperclip, Square } from "lucide-react";
import { ChatBubble, ChatBubbleMessage, ChatBubbleActionWrapper } from "@/components/ChatBubble";
import { ChatMessageList } from "@/components/ChatMessageList";
import { ChatInput } from "@/components/ChatInput";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { TendrilQuestions } from "@/components/TendrilQuestions";
import { IconButton } from "@/components/ui/IconButton";
import { TuiBadge } from "@/components/ui/TuiBadge";
import { AppFrame, chatSectionItems, fullBleedDecorator } from "./app-layout-harness";

/**
 * The Chat page in the states a screenshot of the app would actually catch: mid-conversation, with
 * the agent still answering, waiting on the user to pick between options, and empty.
 *
 * Every state is props alone - the real page drives these same widgets from `chatStore`, which
 * lives in the app and cannot be imported here.
 */
const meta: Meta = {
  title: "App/Chat Layout",
  parameters: {
    layout: "fullscreen",
    // The thread auto-scrolls to the newest message on mount, so the scroll offset a screenshot
    // catches is timing-dependent. These stories are for reading the layout, not for pinning pixels.
    visual: { disable: true },
  },
  decorators: [fullBleedDecorator],
};

export default meta;
type Story = StoryObj;

const Composer: React.FC<{ streaming?: boolean; value?: string; placeholder?: string }> = ({
  streaming = false,
  value,
  placeholder = "Ask anything, or describe a change…",
}) => (
  <div className="mx-auto w-full max-w-3xl shrink-0 px-2.5 pb-4">
    <div className="rounded-2xl border border-border bg-card p-2 shadow-sm">
      <ChatInput
        aria-label="Message"
        placeholder={placeholder}
        defaultValue={value}
        rows={1}
        className="min-h-9 resize-none border-0 bg-transparent p-2 shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1 pb-0.5">
        <IconButton label="Attach a file">
          <Paperclip size={16} />
        </IconButton>
        {streaming ? (
          <IconButton label="Stop generating">
            <Square size={16} />
          </IconButton>
        ) : (
          <IconButton label="Send message">
            <SendHorizontal size={16} />
          </IconButton>
        )}
      </div>
    </div>
  </div>
);

const Sent: React.FC<{ children: React.ReactNode; time: string }> = ({ children, time }) => (
  <ChatBubble variant="sent">
    <div className="flex max-w-[80%] flex-col items-end">
      <ChatBubbleMessage variant="sent">{children}</ChatBubbleMessage>
      <ChatBubbleActionWrapper>
        <span>{time}</span>
      </ChatBubbleActionWrapper>
    </div>
  </ChatBubble>
);

const Received: React.FC<{ children?: React.ReactNode; isLoading?: boolean }> = ({
  children,
  isLoading,
}) => (
  <ChatBubble variant="received">
    <ChatBubbleMessage variant="received" isLoading={isLoading}>
      {children}
    </ChatBubbleMessage>
  </ChatBubble>
);

const ANSWER_MARKDOWN = `Three places decide the sidebar's width, and only one of them survives a reload:

1. \`useResizableSidebar\` holds the live width while you drag.
2. \`writeStoredWidth\` persists it under \`tendril.shell.sidebarWidth\`.
3. \`TendrilShell\` reads it back on mount, *before* the \`collapsed\` prop is applied.

The flash you are seeing is step 3 racing step 1. Reading the stored value in the initialiser
rather than in an effect removes the intermediate paint.`;

const FOLLOW_UP_MARKDOWN = `Done - \`readStoredWidth\` now runs inside \`useState\`'s initialiser:

\`\`\`ts
const [width, setWidth] = useState(() => readStoredWidth() ?? DEFAULT_SIDEBAR_WIDTH);
\`\`\`

That removes the first paint at the default width. Want me to add a regression test that asserts
the very first render already carries the stored width?`;

const QUESTIONS_YAML = `- id: scope
  title: How far should the persistence fix reach?
  description: The same race exists in the plan workspace's chat panel.
  multiple: false
  optional: false
  options:
    - title: Shell sidebar only
      value: shell
      description: Smallest change; the workspace keeps its current behaviour.
      recommended: true
    - title: Shell and plan workspace
      value: both
      description: One shared initialiser, two call sites updated.
- id: regression
  title: Which regression tests should come with it?
  multiple: true
  optional: false
  options:
    - title: First-paint width assertion
      value: first-paint
      recommended: true
    - title: Collapse/expand round trip
      value: round-trip
    - title: Storage unavailable (private mode)
      value: no-storage
      recommended: true
`;

const ChatPage: React.FC<{
  children: React.ReactNode;
  composer?: React.ReactNode;
  title?: string;
  status?: string;
}> = ({ children, composer, title = "Storybook layout coverage", status }) => (
  <div className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-2.5">
      <h1 className="truncate text-sm font-medium">{title}</h1>
      {status && <TuiBadge kind="warning">{status}</TuiBadge>}
    </header>
    <div className="min-h-0 flex-1">{children}</div>
    {composer}
  </div>
);

/** A conversation partway through: user turns, agent prose, and the composer ready for the next. */
export const Conversation: Story = {
  render: () => (
    <AppFrame
      activeNav="chat"
      sectionTitle="Chats"
      sectionItems={chatSectionItems}
      selectedItemId="chat-1"
      chatCount={4}
      fullBleed
    >
      <ChatPage composer={<Composer />}>
        <ChatMessageList enableAutoScroll={false}>
          <Sent time="09:12">
            The sidebar flashes at its default width for a frame after every reload. Where does that
            come from?
          </Sent>
          <Received>
            <MarkdownRenderer content={ANSWER_MARKDOWN} />
          </Received>
          <Sent time="09:15">Fix it in the initialiser, then.</Sent>
          <Received>
            <MarkdownRenderer content={FOLLOW_UP_MARKDOWN} />
          </Received>
        </ChatMessageList>
      </ChatPage>
    </AppFrame>
  ),
};

/** The agent is still writing: the turn shows the loading indicator and the composer offers Stop. */
export const AgentStreaming: Story = {
  render: () => (
    <AppFrame
      activeNav="chat"
      sectionTitle="Chats"
      sectionItems={chatSectionItems}
      selectedItemId="chat-1"
      chatCount={4}
      fullBleed
    >
      <ChatPage status="Working" composer={<Composer streaming />}>
        <ChatMessageList enableAutoScroll={false}>
          <Sent time="09:12">
            The sidebar flashes at its default width for a frame after every reload. Where does that
            come from?
          </Sent>
          <Received>
            <MarkdownRenderer content={ANSWER_MARKDOWN} />
          </Received>
          <Sent time="09:15">Fix it in the initialiser, then.</Sent>
          <Received isLoading />
        </ChatMessageList>
      </ChatPage>
    </AppFrame>
  ),
};

/** The agent has stopped to ask: a questions block is inline in the thread, blocking the next turn. */
export const AwaitingAnswers: Story = {
  render: () => (
    <AppFrame
      activeNav="chat"
      sectionTitle="Chats"
      sectionItems={chatSectionItems}
      selectedItemId="chat-1"
      chatCount={4}
      fullBleed
    >
      <ChatPage status="Needs answers" composer={<Composer />}>
        <ChatMessageList enableAutoScroll={false}>
          <Sent time="09:15">Fix it in the initialiser, then.</Sent>
          <Received>
            <MarkdownRenderer content="Before I touch it - two decisions I should not make for you:" />
            <TendrilQuestions
              id="chat-questions"
              content={QUESTIONS_YAML}
              showSubmit
              submitLabel="Submit answers"
              events={["OnAnswer", "OnSubmit"]}
              eventHandler={() => {}}
            />
          </Received>
        </ChatMessageList>
      </ChatPage>
    </AppFrame>
  ),
};

/** A fresh chat: no thread yet, the sidebar list still carries the earlier conversations. */
export const EmptyThread: Story = {
  render: () => (
    <AppFrame
      activeNav="chat"
      sectionTitle="Chats"
      sectionItems={chatSectionItems}
      chatCount={4}
      fullBleed
    >
      <ChatPage
        title="New chat"
        composer={<Composer placeholder="Describe a change, or ask a question…" />}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
          <h2 className="text-lg font-medium">What should we work on?</h2>
          {/* `text-muted-foreground` is #8f8f8f, which scores ~3.0:1 on the page background and
              fails the a11y pass at this size; the empty state's prose carries meaning, so it takes
              the full foreground rather than a suppression. */}
          <p className="max-w-md text-sm">
            Describe a change and Tendril drafts a plan for it, or ask about anything already in the
            repository.
          </p>
        </div>
      </ChatPage>
    </AppFrame>
  ),
};
