import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type EventUnsubscribe = () => void;

export async function onServiceStatus(
  handler: (status: "connected" | "reconnecting" | "disconnected") => void
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<string>("service-status", (event) => {
    handler(event.payload as "connected" | "reconnecting" | "disconnected");
  });
  return () => unlisten();
}

export async function onJobEvent(
  handler: (payload: unknown) => void
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<unknown>("job-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

export async function onPlanEvent(
  handler: (payload: unknown) => void
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<unknown>("plan-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

export async function onChatEvent(
  handler: (event: import("../types/chat").ChatEvent) => void
): Promise<EventUnsubscribe> {
  const unlisten: UnlistenFn = await listen<import("../types/chat").ChatEvent>("chat-event", (event) => {
    handler(event.payload);
  });
  return () => unlisten();
}

