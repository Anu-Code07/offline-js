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

export interface WorkerSyncRuntime {
  dispose(): void;
  handle(message: WorkerSyncMessage): Promise<WorkerSyncMessage>;
  isPaused(): boolean;
}

export const createWorkerSyncMessage = (
  type: WorkerSyncMessage["type"],
  payload?: unknown
): WorkerSyncMessage => ({
  id: createId(),
  ...(payload === undefined ? {} : { payload }),
  timestamp: Date.now(),
  type
});

export const createWorkerSyncPlugin = (worker: WorkerLike): OfflinePlugin => ({
  name: "worker-sync",
  setup({ events, network }) {
    const send = (type: WorkerSyncMessage["type"], payload?: unknown) => {
      worker.postMessage(createWorkerSyncMessage(type, payload));
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
      send("shutdown");
      unsubscribeNetwork();
      worker.removeEventListener("message", handleMessage);
      worker.terminate?.();
    };
  }
});

export const createWorkerSyncHandler = (db: OfflineDB): WorkerSyncRuntime["handle"] => {
  const runtime = createWorkerSyncRuntime(db);
  return runtime.handle;
};

export const createWorkerSyncRuntime = (db: OfflineDB): WorkerSyncRuntime => {
  let paused = false;
  let disposed = false;

  return {
    dispose() {
      disposed = true;
      paused = true;
    },
    isPaused: () => paused,
    async handle(message) {
      if (disposed || message.type === "shutdown") {
        disposed = true;
        paused = true;
        return createWorkerSyncMessage("status", { disposed: true, paused: true });
      }

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
        payload: { paused, disposed },
        timestamp: Date.now(),
        type: "status"
      };
    }
  };
};

/** Wire a worker `message` listener to an OfflineDB sync runtime. */
export const attachWorkerSyncRuntime = (
  workerScope: {
    addEventListener(
      type: "message",
      listener: (event: MessageEvent<WorkerSyncMessage>) => void
    ): void;
    postMessage(message: WorkerSyncMessage): void;
  },
  db: OfflineDB
): (() => void) => {
  const runtime = createWorkerSyncRuntime(db);
  const listener = (event: MessageEvent<WorkerSyncMessage>) => {
    void runtime.handle(event.data).then((response) => {
      workerScope.postMessage(response);
    });
  };

  workerScope.addEventListener("message", listener);

  return () => {
    runtime.dispose();
  };
};
