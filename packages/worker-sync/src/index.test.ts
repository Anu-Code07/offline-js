import { describe, expect, it, vi } from "vitest";
import type {
  EventBus,
  NetworkMonitor,
  NetworkState,
  OfflineEvents,
  WorkerSyncMessage
} from "@offlinejs/types";
import { createWorkerSyncHandler, createWorkerSyncPlugin, type WorkerLike } from "./index";

class FakeWorker implements WorkerLike {
  messages: WorkerSyncMessage[] = [];
  listener?: (event: MessageEvent<WorkerSyncMessage>) => void;
  removeEventListener = vi.fn();
  terminate = vi.fn();

  addEventListener(_type: "message", listener: (event: MessageEvent<WorkerSyncMessage>) => void) {
    this.listener = listener;
  }

  postMessage(message: WorkerSyncMessage) {
    this.messages.push(message);
  }
}

describe("worker sync", () => {
  it("posts pause/resume/sync messages and forwards worker messages", () => {
    const worker = new FakeWorker();
    const emit = vi.fn();
    const dispose = createWorkerSyncPlugin(worker).setup({
      db: undefined as never,
      events: { emit } as unknown as EventBus<OfflineEvents>,
      network: {
        getState: () => ({ online: true, since: 2 }),
        isOnline: () => true,
        subscribe(listener: (state: NetworkState) => void) {
          listener({ online: false, since: 1 });
          listener({ online: true, since: 2 });
          return vi.fn();
        }
      } as unknown as NetworkMonitor,
      storage: undefined as never
    }) as () => void;

    worker.listener?.({
      data: { id: "1", timestamp: 1, type: "status" }
    } as MessageEvent<WorkerSyncMessage>);

    expect(worker.messages.map((message) => message.type)).toEqual(["pause", "resume", "sync"]);
    expect(emit).toHaveBeenCalledWith("worker:message", { id: "1", timestamp: 1, type: "status" });

    dispose();

    expect(worker.terminate).toHaveBeenCalled();
  });

  it("handles worker sync messages with pause state", async () => {
    const sync = vi.fn();
    const handler = createWorkerSyncHandler({ sync } as never);

    await expect(handler({ id: "1", timestamp: 1, type: "pause" })).resolves.toMatchObject({
      payload: { paused: true },
      type: "status"
    });
    await handler({ id: "2", timestamp: 2, type: "sync" });
    await handler({ id: "3", timestamp: 3, type: "resume" });
    await handler({ id: "4", timestamp: 4, type: "sync" });

    expect(sync).toHaveBeenCalledTimes(1);
  });
});
