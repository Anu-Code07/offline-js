import type {
  EntityRecord,
  QueryOptions,
  StorageAdapter,
  StorageMigration,
  TransactionStore
} from "@offlinejs/types";
import { applyQuery, clone } from "@offlinejs/utils";

interface IndexedDBRow {
  collection: string;
  id: string;
  key: string;
  value: EntityRecord;
}

export interface IndexedDBStorageOptions {
  databaseName?: string;
  version?: number;
}

const STORE_NAME = "records";
const COLLECTION_INDEX = "collection";

export class IndexedDBStorageAdapter implements StorageAdapter {
  readonly name = "indexeddb";

  private readonly databaseName: string;
  private readonly version: number;
  private databasePromise?: Promise<IDBDatabase>;

  constructor(options: IndexedDBStorageOptions = {}) {
    this.databaseName = options.databaseName ?? "offlinejs";
    this.version = options.version ?? 1;
  }

  async get<TRecord extends EntityRecord>(collection: string, id: string): Promise<TRecord | null> {
    const row = await this.request<IndexedDBRow | undefined>(
      this.store("readonly").get(this.key(collection, id))
    );

    return row ? clone(row.value as TRecord) : null;
  }

  async set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void> {
    const row: IndexedDBRow = {
      collection,
      id: value.id,
      key: this.key(collection, value.id),
      value: clone(value)
    };

    await this.request(this.store("readwrite").put(row));
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.request(this.store("readwrite").delete(this.key(collection, id)));
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    const rows = await this.getCollectionRows(collection);
    return applyQuery(
      rows.map((row) => clone(row.value as TRecord)),
      query
    );
  }

  async clear(collection?: string): Promise<void> {
    if (!collection) {
      await this.request(this.store("readwrite").clear());
      return;
    }

    const rows = await this.getCollectionRows(collection);
    const store = this.store("readwrite");

    await Promise.all(rows.map((row) => this.request(store.delete(row.key))));
  }

  async transaction<TValue>(
    _scope: string[],
    run: (store: TransactionStore) => Promise<TValue>
  ): Promise<TValue> {
    return run(this);
  }

  async migrate(migrations: StorageMigration[]): Promise<void> {
    const applied = new Set(
      (await this.find<EntityRecord>("__migrations")).map((record) => record.id)
    );

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue;
      }

      await migration.up(this);
      await this.set("__migrations", { id: migration.name, appliedAt: Date.now() });
    }
  }

  private async getCollectionRows(collection: string): Promise<IndexedDBRow[]> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index(COLLECTION_INDEX);

    return this.request<IndexedDBRow[]>(index.getAll(collection));
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    const databasePromise = this.database();
    const requestProxy = {
      get: (key: string) =>
        databasePromise.then((database) =>
          database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).get(key)
        ),
      put: (value: IndexedDBRow) =>
        databasePromise.then((database) =>
          database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).put(value)
        ),
      delete: (key: string) =>
        databasePromise.then((database) =>
          database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).delete(key)
        ),
      clear: () =>
        databasePromise.then((database) =>
          database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).clear()
        )
    };

    return requestProxy as unknown as IDBObjectStore;
  }

  private async database(): Promise<IDBDatabase> {
    if (this.databasePromise) {
      return this.databasePromise;
    }

    this.databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB is not available in this runtime"));
        return;
      }

      const request = globalThis.indexedDB.open(this.databaseName, this.version);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex(COLLECTION_INDEX, COLLECTION_INDEX, { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    });

    return this.databasePromise;
  }

  private async request<TValue>(
    requestOrPromise: IDBRequest<TValue> | Promise<IDBRequest<TValue>>
  ): Promise<TValue> {
    const request = await requestOrPromise;

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }

  private key(collection: string, id: string): string {
    return `${collection}:${id}`;
  }
}

export const createIndexedDBStorage = (
  options?: IndexedDBStorageOptions
): IndexedDBStorageAdapter => new IndexedDBStorageAdapter(options);
