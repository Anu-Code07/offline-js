import type { OfflinePlugin, WorkerSyncMessage } from "@offlinejs/types";
import { createId } from "@offlinejs/utils";

interface SyncExtendableEvent {
  tag?: string;
  waitUntil?(promise: Promise<void>): void;
}

export interface BackgroundSyncPluginOptions {
  registration?: ServiceWorkerRegistration;
  syncTag?: string;
}

export const backgroundSyncPlugin = (options: BackgroundSyncPluginOptions = {}): OfflinePlugin => ({
  name: "background-sync",
  setup({ db, events, network }) {
    const syncTag = options.syncTag ?? "offlinejs-sync";

    const requestServiceWorkerSync = async (): Promise<void> => {
      const registration =
        options.registration ?? (await globalThis.navigator?.serviceWorker?.ready);

      if (!registration) {
        await db.sync();
        return;
      }

      const syncManager = registration as ServiceWorkerRegistration & {
        sync?: { register(tag: string): Promise<void> };
      };

      if (syncManager.sync) {
        await syncManager.sync.register(syncTag);
        return;
      }

      registration.active?.postMessage(createWorkerSyncMessage("sync"));
    };

    const unsubscribe = network.subscribe((state) => {
      if (!state.online) {
        return;
      }

      void requestServiceWorkerSync().catch((error) => {
        events.emit("error", error instanceof Error ? error : new Error(String(error)));
      });
    });

    return unsubscribe;
  }
});

export const createWorkerSyncMessage = (
  type: WorkerSyncMessage["type"],
  payload?: unknown
): WorkerSyncMessage => ({
  id: createId(),
  ...(payload === undefined ? {} : { payload }),
  timestamp: Date.now(),
  type
});

export const createOfflineSyncWorkerHandler = (sync: () => Promise<void>) => {
  return async (event: SyncExtendableEvent): Promise<void> => {
    if ("waitUntil" in event) {
      event.waitUntil(sync());
      return;
    }

    await sync();
  };
};
