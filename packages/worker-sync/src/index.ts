import type { OfflineDB, OfflinePlugin, WorkerSyncMessage } from "@offlinejs/types";
import { createId } from "@offlinejs/utils";

export interface WorkerLike {
  postMessage(message: WorkerSyncMessage): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerSyncMessage>) => void
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerSyncMessage>) => void
  ): void;
  terminate?(): void;
}

export const createWorkerSyncPlugin = (worker: WorkerLike): OfflinePlugin => ({
  name: "worker-sync",
  setup({ events, network }) {
    const send = (type: WorkerSyncMessage["type"]) => {
      worker.postMessage({
        id: createId(),
        timestamp: Date.now(),
        type
      });
    };
    const handleMessage = (event: MessageEvent<WorkerSyncMessage>) => {
      events.emit("worker:message", event.data);
    };
    const unsubscribeNetwork = network.subscribe((state) => {
      send(state.online ? "resume" : "pause");

      if (state.online) {
        send("sync");
      }
    });

    worker.addEventListener("message", handleMessage);

    return () => {
      unsubscribeNetwork();
      worker.removeEventListener("message", handleMessage);
      worker.terminate?.();
    };
  }
});

export const createWorkerSyncHandler = (db: OfflineDB) => {
  let paused = false;

  return async (message: WorkerSyncMessage): Promise<WorkerSyncMessage> => {
    if (message.type === "pause") {
      paused = true;
    }

    if (message.type === "resume") {
      paused = false;
    }

    if (message.type === "sync" && !paused) {
      await db.sync();
    }

    return {
      id: message.id,
      payload: { paused },
      timestamp: Date.now(),
      type: "status"
    };
  };
};
