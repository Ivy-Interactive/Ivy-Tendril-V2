import { ContentInput } from "./ContentInput";

export default {
  title: "Components/ContentInput",
  component: ContentInput,
};

export const EmptyPlaceholder = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput id="ci-empty" placeholder="How can I help you today?" />
  </div>
);

export const MultilineText = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput
      id="ci-multiline"
      value={`Please refactor the authentication middleware to support JWT refresh tokens.
Specifically:
1. Validate incoming bearer token expiry.
2. Check refresh token in secure cookie.
3. Issue new access token if refresh token is valid.`}
      submitLabel="Send message"
    />
  </div>
);

export const WithAttachments = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput
      id="ci-attachments"
      value="Review attached wireframes and specs [file: /designs/checkout-mockup.png] [file: /docs/specification.pdf]"
      attachedFiles={[
        { name: "checkout-mockup.png", type: "image/png", size: "1.2 MB" },
        { name: "specification.pdf", type: "application/pdf", size: "340 KB" },
      ]}
      submitLabel="Send"
    />
  </div>
);

export const ActiveVoiceRecording = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput
      id="ci-voice"
      placeholder="Click the microphone to start voice recording..."
      transcriptionUrl="wss://echo.websocket.org"
    />
  </div>
);

export const Disabled = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput
      id="ci-disabled"
      value="Processing your previous request..."
      placeholder="Input is disabled during generation"
      menuOptions={["Cancel", "Retry"]}
    />
  </div>
);

export const WithMenuOptions = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput
      id="ci-split"
      value="Create new plan for user onboarding"
      submitLabel="Create Plan"
      menuOptions={["Execute immediately", "Save as draft", "Expand plan"]}
    />
  </div>
);
