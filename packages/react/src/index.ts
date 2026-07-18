import type { EntityRecord, OfflineCollection } from "@offlinejs/types";

export interface OfflineExternalStore<TRecord extends EntityRecord> {
  getSnapshot(): TRecord[];
  subscribe(listener: () => void): () => void;
}

export const createOfflineExternalStore = <TRecord extends EntityRecord>(
  collection: OfflineCollection<TRecord>
): OfflineExternalStore<TRecord> => {
  let snapshot: TRecord[] = [];
  const listeners = new Set<() => void>();
  const unsubscribe = collection.subscribe((records) => {
    snapshot = records;

    for (const listener of listeners) {
      listener();
    }
  });

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          unsubscribe();
        }
      };
    }
  };
};
