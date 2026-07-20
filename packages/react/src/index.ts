import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import type { EntityRecord, NetworkState, OfflineCollection, OfflineDB } from "@offlinejs/types";

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

const OfflineDBContext = createContext<OfflineDB | null>(null);

export interface OfflineProviderProps {
  children: ReactNode;
  db: OfflineDB;
}

export const OfflineProvider = ({ children, db }: OfflineProviderProps) =>
  createElement(OfflineDBContext.Provider, { value: db }, children);

export const useOfflineDB = <TCollections extends object = object>(): OfflineDB<TCollections> => {
  const db = useContext(OfflineDBContext);

  if (!db) {
    throw new Error("useOfflineDB must be used within OfflineProvider");
  }

  return db as OfflineDB<TCollections>;
};

export interface OfflineStatus {
  online: boolean;
  since: number;
}

export const useOfflineStatus = (db?: OfflineDB): OfflineStatus => {
  const contextDb = useContext(OfflineDBContext);
  const target = db ?? contextDb;

  if (!target) {
    throw new Error("useOfflineStatus requires an OfflineDB or OfflineProvider");
  }

  const [status, setStatus] = useState<OfflineStatus>(() => ({
    online: typeof globalThis.navigator === "undefined" ? true : globalThis.navigator.onLine,
    since: Date.now()
  }));

  useEffect(() => {
    const onOnline = (state: NetworkState) => setStatus({ online: true, since: state.since });
    const onOffline = (state: NetworkState) => setStatus({ online: false, since: state.since });
    const unsubscribeOnline = target.on("online", onOnline);
    const unsubscribeOffline = target.on("offline", onOffline);

    return () => {
      unsubscribeOnline();
      unsubscribeOffline();
    };
  }, [target]);

  return status;
};
