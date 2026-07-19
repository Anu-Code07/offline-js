import { describe, expect, it, vi } from "vitest";
import type { EventBus, NetworkMonitor, NetworkState, OfflineEvents } from "@offlinejs/types";
import {
  backgroundSyncPlugin,
  createOfflineSyncWorkerHandler,
  createWorkerSyncMessage
} from "./index";

describe("service worker", () => {
  it("creates sync messages with optional payload", () => {
    expect(createWorkerSyncMessage("sync", { collection: "users" })).toMatchObject({
      payload: { collection: "users" },
      type: "sync"
    });
    expect(createWorkerSyncMessage("pause")).not.toHaveProperty("payload");
  });

  it("registers background sync when online", async () => {
    const register = vi.fn();
    const plugin = backgroundSyncPlugin({
      registration: { sync: { register } } as unknown as ServiceWorkerRegistration
    });

    plugin.setup({
      db: { sync: vi.fn() } as never,
      events: { emit: vi.fn() } as unknown as EventBus<OfflineEvents>,
      network: {
        getState: () => ({ online: true, since: 1 }),
        isOnline: () => true,
        subscribe(listener: (state: NetworkState) => void) {
          listener({ online: true, since: 1 });
          return vi.fn();
        }
      } as unknown as NetworkMonitor,
      storage: undefined as never
    });
    await Promise.resolve();

    expect(register).toHaveBeenCalledWith("offlinejs-sync");
  });

  it("posts a message when sync manager is unavailable", async () => {
    const postMessage = vi.fn();
    const plugin = backgroundSyncPlugin({
      registration: { active: { postMessage } } as unknown as ServiceWorkerRegistration
    });

    plugin.setup({
      db: { sync: vi.fn() } as never,
      events: { emit: vi.fn() } as unknown as EventBus<OfflineEvents>,
      network: {
        getState: () => ({ online: true, since: 1 }),
        isOnline: () => true,
        subscribe(listener: (state: NetworkState) => void) {
          listener({ online: true, since: 1 });
          return vi.fn();
        }
      } as unknown as NetworkMonitor,
      storage: undefined as never
    });
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "sync" }));
  });

  it("falls back to direct db sync without service worker registration", async () => {
    const sync = vi.fn();
    const plugin = backgroundSyncPlugin();

    plugin.setup({
      db: { sync } as never,
      events: { emit: vi.fn() } as unknown as EventBus<OfflineEvents>,
      network: {
        getState: () => ({ online: true, since: 1 }),
        isOnline: () => true,
        subscribe(listener: (state: NetworkState) => void) {
          listener({ online: true, since: 1 });
          return vi.fn();
        }
      } as unknown as NetworkMonitor,
      storage: undefined as never
    });
    await Promise.resolve();

    expect(sync).toHaveBeenCalled();
  });

  it("uses waitUntil in offline sync worker handlers", async () => {
    const sync = vi.fn(async () => {});
    const waitUntil = vi.fn();
    const handler = createOfflineSyncWorkerHandler(sync);

    await handler({ waitUntil });

    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));

    await handler({});
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
