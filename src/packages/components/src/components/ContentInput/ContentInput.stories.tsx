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

/**
 * Fixtures, not references: a story that pointed `previewSource` at a path would render the same
 * extension pills this story exists to show the alternative to -- a webview cannot read a path. These
 * are `data:` URLs so the chips preview identically in `pnpm storybook`, in a built Storybook and in
 * the visual-regression run, with no asset server and no network.
 *
 * The images are deliberately at the two ends of the range the scrim has to survive: `MOCK_PNG` is a
 * mid-tone UI mock, `LIGHT_PNG` is near-white (which is what makes dark-theme text over it hard) and
 * `DARK_PNG` is near-black (light theme's hard case). Flip the Storybook theme toolbar over
 * `ScrimLegibility` below to check both at once.
 */
const MOCK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAc0lEQVR42u3WoQqAUAxAUf//m4wGk4hBDAaDySyCzeAXCA9hbwduHpyyrTmvO3QNAEBBwDSvIQIAAKgV4A4AZAe03Vi8d/K2HwUDAAAA+AoIv0ZT3wEAgP8AvlGA7IB+WEIEAAAAAABQJ8AvBAAAAJAO8AC9LTd18CzJWwAAAABJRU5ErkJggg==";

const LIGHT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAUElEQVR42u3PMREAMAgEsPpXXChDPfBr7mIg59aEKtOZIyAgICAgICAgICCwD/SEKtMZAQEBAQEBAQEBAYEg8CZUmc4ICAgICAgICAgICKx9SDQ13gT+QZ8AAAAASUVORK5CYII=";

const DARK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAs0lEQVR42u3ZOQ7DMAwFUVeJF+2W7eT+F01PshAopBvgH2BexYLLaz303lsQW/eotx1JbA9Z7IhFL6QqFnPTS+UUy7WLLQAAAAAAYAqgW81c3TqYq1vNXN1q5pZ2iQEAAAAAgDmA+0IN5rovlJlbz1sMAAAAAADMAdwXajDXfaHM3NYfMQAAAAAAMAdwX6jBXPeFMnPP6yMGAAAAAADmAP9+QLgvlJnb768YAAAAAACYAvwAhlMl37DAt/YAAAAASUVORK5CYII=";

/** A real one-page PDF, so the chip renders page 1 through pdf.js rather than a stand-in. */
const SPEC_PDF =
  "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDYgMzk2XSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAzMjIgPj4Kc3RyZWFtCkJUIC9GMSAxNSBUZiAyOCAzNTIgVGQgKFNwZWNpZmljYXRpb24pIFRqIEVUCkJUIC9GMSA4IFRmIDI4IDMzMiBUZCAoQ2hlY2tvdXQgZmxvdyAtIHJldmlzaW9uIDQpIFRqIEVUCjAuODIgZyAyOCAzMDAgMjUwIDggcmUgZiAyOCAyODYgMjUwIDggcmUgZiAyOCAyNzIgMTkwIDggcmUgZgoyOCAyNDggMjUwIDggcmUgZiAyOCAyMzQgMjUwIDggcmUgZiAyOCAyMjAgMjIwIDggcmUgZgowLjkgZyAyOCAxNzYgMTE4IDM0IHJlIGYgMTYwIDE3NiAxMTggMzQgcmUgZgowLjgyIGcgMjggMTQ4IDI1MCA4IHJlIGYgMjggMTM0IDI1MCA4IHJlIGYgMjggMTIwIDE2MCA4IHJlIGYKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDA2MTQgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo2ODQKJSVFT0YK";

/**
 * The three outcomes side by side: an image previews itself, a PDF previews its first page, and a
 * `.zip` -- which nothing can decode -- keeps the extension pill. The pill is the fallback, not a
 * defect, so it belongs in the same frame as the thing that replaced it.
 */
export const WithAttachments = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput
      id="ci-attachments"
      value="Review attached wireframes and specs [file: /designs/checkout-mockup.png] [file: /docs/specification.pdf] [file: /exports/handoff-assets.zip]"
      attachedFiles={[
        {
          name: "checkout-mockup.png",
          type: "image/png",
          size: "1.2 MB",
          previewSource: MOCK_PNG,
        },
        {
          name: "specification.pdf",
          type: "application/pdf",
          size: "340 KB",
          previewSource: SPEC_PDF,
        },
        // No `previewSource`: an archive has no first frame to show, and inventing one would be a
        // claim about contents we never opened.
        { name: "handoff-assets.zip", type: "application/zip", size: "8.4 MB" },
      ]}
      submitLabel="Send"
    />
  </div>
);

/**
 * The legibility case the scrim exists for. A near-white and a near-black thumbnail sit next to a
 * mid-tone one, so the filename, the extension badge and the × have to stay readable across the whole
 * range in whichever theme the toolbar is set to -- a fixed scrim colour fails one end or the other.
 */
export const ScrimLegibility = () => (
  <div style={{ maxWidth: 720, padding: 24 }}>
    <ContentInput
      id="ci-attachments-contrast"
      value="Contrast check [file: /shots/near-white.png] [file: /shots/near-black.png] [file: /shots/mid-tone.png]"
      attachedFiles={[
        { name: "near-white.png", type: "image/png", size: "12 KB", previewSource: LIGHT_PNG },
        { name: "near-black.png", type: "image/png", size: "12 KB", previewSource: DARK_PNG },
        { name: "mid-tone.png", type: "image/png", size: "12 KB", previewSource: MOCK_PNG },
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
