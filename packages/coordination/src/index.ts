import type { CoordinationMessage, OfflinePlugin } from "@offlinejs/types";
import { createId } from "@offlinejs/utils";

export interface CoordinationChannel {
  close(): void;
  isLeader?(): boolean;
  publish<TPayload>(type: string, payload: TPayload): void;
  subscribe(listener: (message: CoordinationMessage) => void): () => void;
}

export interface CoordinationOptions {
  channelName?: string;
  electionIntervalMs?: number;
  source?: string;
  syncDebounceMs?: number;
}

export const createBroadcastCoordination = (
  options: CoordinationOptions = {}
): CoordinationChannel => {
  const channelName = options.channelName ?? "offlinejs";
  const source = options.source ?? createId();
  const electionIntervalMs = options.electionIntervalMs ?? 2_000;
  const listeners = new Set<(message: CoordinationMessage) => void>();
  const channel =
    typeof globalThis.BroadcastChannel === "function"
      ? new globalThis.BroadcastChannel(channelName)
      : undefined;

  let leaderId = source;
  let lastLeaderSeenAt = Date.now();

  const becomeLeader = (): void => {
    leaderId = source;
    channel?.postMessage({
      id: createId(),
      payload: { leaderId: source },
      source,
      timestamp: Date.now(),
      type: "leader:announce"
    } satisfies CoordinationMessage);
  };

  channel?.addEventListener("message", (event: MessageEvent<CoordinationMessage>) => {
    if (event.data.source === source) {
      return;
    }

    if (event.data.type === "leader:announce" || event.data.type === "leader:heartbeat") {
      const remoteLeader =
        typeof event.data.payload === "object" &&
        event.data.payload &&
        "leaderId" in event.data.payload
          ? String((event.data.payload as { leaderId: string }).leaderId)
          : event.data.source;

      if (remoteLeader < leaderId || leaderId === source) {
        leaderId = remoteLeader;
        lastLeaderSeenAt = Date.now();
      } else if (remoteLeader === leaderId) {
        lastLeaderSeenAt = Date.now();
      }
    }

    for (const listener of listeners) {
      listener(event.data);
    }
  });

  becomeLeader();

  const heartbeatId = globalThis.setInterval(() => {
    if (leaderId === source) {
      channel?.postMessage({
        id: createId(),
        payload: { leaderId: source },
        source,
        timestamp: Date.now(),
        type: "leader:heartbeat"
      } satisfies CoordinationMessage);
      return;
    }

    if (Date.now() - lastLeaderSeenAt > electionIntervalMs * 2) {
      becomeLeader();
    }
  }, electionIntervalMs);

  return {
    close: () => {
      globalThis.clearInterval(heartbeatId);
      channel?.close();
    },
    isLeader: () => leaderId === source,
    publish: (type, payload) => {
      const message: CoordinationMessage = {
        id: createId(),
        payload,
        source,
        timestamp: Date.now(),
        type
      };
      channel?.postMessage(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

export const coordinationPlugin = (
  channel: CoordinationChannel,
  options: { syncDebounceMs?: number; leaderOnlySync?: boolean } = {}
): OfflinePlugin => ({
  name: "coordination",
  setup({ db, events }) {
    const syncDebounceMs = options.syncDebounceMs ?? 250;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;

    const requestSync = (): void => {
      if (
        options.leaderOnlySync !== false &&
        typeof channel.isLeader === "function" &&
        !channel.isLeader()
      ) {
        return;
      }

      if (syncTimer) {
        globalThis.clearTimeout(syncTimer);
      }

      syncTimer = globalThis.setTimeout(() => {
        void db
          .sync()
          .catch((error) =>
            events.emit("error", error instanceof Error ? error : new Error(String(error)))
          );
      }, syncDebounceMs);
    };

    const unsubscribe = channel.subscribe((message) => {
      events.emit("coordination:message", message);

      if (message.type === "sync:request") {
        requestSync();
      }

      if (message.type === "storage:invalidate") {
        events.emit("coordination:message", message);
      }
    });
    const unsubscribeSync = events.on("queue:add", () => {
      channel.publish("sync:request", {});
    });

    return () => {
      if (syncTimer) {
        globalThis.clearTimeout(syncTimer);
      }
      unsubscribe();
      unsubscribeSync();
      channel.close();
    };
  }
});
