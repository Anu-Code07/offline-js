import { describe, expect, it, vi } from "vitest";
import type { CoordinationMessage, EventBus, OfflineEvents } from "@offlinejs/types";
import { coordinationPlugin, createBroadcastCoordination } from "./index";

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  listeners = new Set<(event: MessageEvent<CoordinationMessage>) => void>();
  closed = false;

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(_type: "message", listener: (event: MessageEvent<CoordinationMessage>) => void) {
    this.listeners.add(listener);
  }

  close() {
    this.closed = true;
  }

  postMessage(message: CoordinationMessage) {
    for (const instance of FakeBroadcastChannel.instances) {
      for (const listener of instance.listeners) {
        listener({ data: message } as MessageEvent<CoordinationMessage>);
      }
    }
  }
}

describe("coordination", () => {
  it("publishes messages between broadcast channels and ignores same-source messages", () => {
    const original = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel;
    FakeBroadcastChannel.instances = [];

    try {
      const first = createBroadcastCoordination({ source: "one" });
      const second = createBroadcastCoordination({ source: "two" });
      const listener = vi.fn();
      second.subscribe(listener);

      first.publish("sync:request", { ok: true });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "sync:request" }));
      first.close();
      second.close();
      expect(FakeBroadcastChannel.instances.every((channel) => channel.closed)).toBe(true);
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });

  it("syncs on coordination requests and publishes when queue changes", async () => {
    const sync = vi.fn(async () => {});
    const publish = vi.fn();
    let coordinationListener: ((message: CoordinationMessage) => void) | undefined;
    let queueListener: (() => void) | undefined;
    const plugin = coordinationPlugin({
      close: vi.fn(),
      publish,
      subscribe(listener) {
        coordinationListener = listener;
        return vi.fn();
      }
    });

    const dispose = plugin.setup({
      db: { sync } as never,
      events: {
        emit: vi.fn(),
        on(
          _name: keyof OfflineEvents,
          listener: (payload: OfflineEvents[keyof OfflineEvents]) => void
        ) {
          queueListener = listener as () => void;
          return vi.fn();
        }
      } as unknown as EventBus<OfflineEvents>,
      network: undefined as never,
      storage: undefined as never
    });
    coordinationListener?.({
      id: "1",
      payload: {},
      source: "other",
      timestamp: 1,
      type: "sync:request"
    });
    queueListener?.();
    await Promise.resolve();

    expect(sync).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith("sync:request", {});

    (dispose as () => void)();
  });
});
