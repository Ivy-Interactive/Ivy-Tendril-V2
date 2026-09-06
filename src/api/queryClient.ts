import { QueryClient } from "@tanstack/react-query";
import type { TendrilRealtimeClient } from "./realtime";

export function createTendrilQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60, // 1 minute
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function bindRealtimeToQueryClient(
  queryClient: QueryClient,
  realtimeClient: TendrilRealtimeClient
): () => void {
  // Invalidate queries when realtime events arrive
  const unsubMessage = realtimeClient.onMessage((msg) => {
    switch (msg.type) {
      case "state":
      case "status":
      case "complete":
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["plans"] });
        break;
      case "log":
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        break;
    }
  });

  return () => {
    unsubMessage();
  };
}

export function getPollingInterval(
  isWsConnected: boolean,
  resource: "jobs" | "plans"
): number | false {
  if (isWsConnected) {
    return false; // Realtime updates via WebSocket
  }

  // Polling fallback when disconnected/reconnecting:
  // 3s for active jobs, 5s for plan lists
  return resource === "jobs" ? 3000 : 5000;
}
