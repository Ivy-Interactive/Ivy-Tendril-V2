import type { Meta, StoryObj } from "@storybook/react";
import { ShareTunnelDialog, type ShareTunnelSnapshot } from "./ShareTunnelDialog";

/** A share tunnel frozen in one state. The dialog polls `getStatus`, so a story is a snapshot. */
function tunnel(overrides: Partial<ShareTunnelSnapshot> = {}): ShareTunnelSnapshot {
  return {
    kind: "share",
    status: "disabled",
    installed: true,
    sharePort: 5010,
    ...overrides,
  } as ShareTunnelSnapshot;
}

/** A frozen `ShareTunnelApi`: start and stop return the state the story opened on. */
function api(snapshot: ShareTunnelSnapshot) {
  return {
    getStatus: () => Promise.resolve(snapshot),
    start: () => Promise.resolve(snapshot),
    stop: () => Promise.resolve(snapshot),
  };
}

const CONNECTED = {
  status: "connected" as const,
  url: "https://mellow-bird-1234.trycloudflare.com",
  shareToken: "3f9a2c",
};

/**
 * Shares a plan with a reviewer over a Cloudflare Quick Tunnel.
 *
 * The link carries `?share=1`, matching V1's `ShareContext.IsShareMode`, plus a `shareToken` that
 * is V2's addition: an anonymous visitor has no bearer credential and V2 refuses unauthenticated
 * requests, so the capability has to travel in the link.
 *
 * The `api` prop is the injection seam, so these stories drive real states without a module mock.
 */
const meta = {
  title: "Dialogs/Shell/ShareTunnelDialog",
  component: ShareTunnelDialog,
  parameters: { layout: "fullscreen" },
  args: { isOpen: true, onClose: () => {}, planId: "00412" },
} satisfies Meta<typeof ShareTunnelDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No tunnel yet. `shareUrlForPlan` returns the relative path, so a link renders regardless. */
export const Disabled: Story = {
  args: { api: api(tunnel({ status: "disabled" })) },
};

/** Cloudflared is starting. V1 gets pushed `StatusChanged`; V2 polls every 2s. */
export const Connecting: Story = {
  args: { api: api(tunnel({ status: "connecting" })) },
};

/** The whole point: a full URL carrying `?share=1` and the capability token. */
export const ConnectedPlanLink: Story = {
  args: { api: api(tunnel(CONNECTED)) },
};

/** `isReview` switches the path from /plans to /review. Same tunnel, different destination. */
export const ConnectedReviewLink: Story = {
  args: { isReview: true, api: api(tunnel(CONNECTED)) },
};

/** Without a `planId` the dialog shares the tunnel root rather than deep-linking. */
export const ConnectedNoPlan: Story = {
  args: { planId: undefined, api: api(tunnel(CONNECTED)) },
};

/** The one state the operator has to act on outside Tendril. */
export const CloudflaredNotInstalled: Story = {
  args: { api: api(tunnel({ status: "disabled", installed: false })) },
};

/** An error carried on the snapshot rather than thrown, which is how the daemon reports it. */
export const StartFailed: Story = {
  args: {
    api: api(
      tunnel({ status: "disabled", error: "cloudflared exited with code 1: no route to host" }),
    ),
  },
};
