import { useMemo, useSyncExternalStore } from "react";
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

export interface UseOfflineCollectionResult<TRecord extends EntityRecord> {
  create: OfflineCollection<TRecord>["create"];
  delete: OfflineCollection<TRecord>["delete"];
  records: TRecord[];
  sync: OfflineCollection<TRecord>["sync"];
  update: OfflineCollection<TRecord>["update"];
}

export const useOfflineCollection = <TRecord extends EntityRecord>(
  collection: OfflineCollection<TRecord>
): UseOfflineCollectionResult<TRecord> => {
  const store = useMemo(() => createOfflineExternalStore(collection), [collection]);
  const records = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    create: collection.create.bind(collection),
    delete: collection.delete.bind(collection),
    records,
    sync: collection.sync.bind(collection),
    update: collection.update.bind(collection)
  };
};

export const useOfflineRecords = <TRecord extends EntityRecord>(
  collection: OfflineCollection<TRecord>
): TRecord[] => useOfflineCollection(collection).records;
