import type { CoordinationMessage, OfflinePlugin } from "@offlinejs/types";
import { createId } from "@offlinejs/utils";

export interface CoordinationChannel {
  close(): void;
  publish<TPayload>(type: string, payload: TPayload): void;
  subscribe(listener: (message: CoordinationMessage) => void): () => void;
}

export interface CoordinationOptions {
  channelName?: string;
  source?: string;
}

export const createBroadcastCoordination = (
  options: CoordinationOptions = {}
): CoordinationChannel => {
  const channelName = options.channelName ?? "offlinejs";
  const source = options.source ?? createId();
  const listeners = new Set<(message: CoordinationMessage) => void>();
  const channel =
    typeof globalThis.BroadcastChannel === "function"
      ? new globalThis.BroadcastChannel(channelName)
      : undefined;

  channel?.addEventListener("message", (event: MessageEvent<CoordinationMessage>) => {
    if (event.data.source === source) {
      return;
    }

    for (const listener of listeners) {
      listener(event.data);
    }
  });

  return {
    close: () => channel?.close(),
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

export const coordinationPlugin = (channel: CoordinationChannel): OfflinePlugin => ({
  name: "coordination",
  setup({ db, events }) {
    const unsubscribe = channel.subscribe((message) => {
      events.emit("coordination:message", message);

      if (message.type === "sync:request") {
        void db
          .sync()
          .catch((error) =>
            events.emit("error", error instanceof Error ? error : new Error(String(error)))
          );
      }
    });
    const unsubscribeSync = events.on("queue:add", () => {
      channel.publish("sync:request", {});
    });

    return () => {
      unsubscribe();
      unsubscribeSync();
      channel.close();
    };
  }
});
