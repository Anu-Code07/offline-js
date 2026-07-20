import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  type EntityRecord,
  type IndexDefinition,
  type IndexableStorageAdapter,
  type QueryOptions,
  type StorageMigration,
  type TransactionStore
} from "@offlinejs/types";
import {
  applyQuery,
  clone,
  findMatchingIndex,
  getEqualityFilterLookups,
  readIndexFields,
  serializeCompoundIndexValue
} from "@offlinejs/utils";

interface IndexedDBRow {
  collection: string;
  id: string;
  key: string;
  value: EntityRecord;
}

interface IndexEntryRow {
  collection: string;
  id: string;
  indexName: string;
  lookup: string;
  recordId: string;
  valueKey: string;
}

export interface IndexedDBStorageOptions {
  databaseName?: string;
  version?: number;
}

const STORE_NAME = "records";
const INDEX_STORE_NAME = "indexes";
const INDEX_ENTRIES_STORE = "index_entries";
const COLLECTION_INDEX = "collection";
const LOOKUP_INDEX = "lookup";

export class IndexedDBStorageAdapter implements IndexableStorageAdapter {
  readonly name = "indexeddb";
  readonly contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    indexes: true,
    migrations: true,
    persistence: "durable",
    transactions: "best-effort"
  } as const;

  private readonly databaseName: string;
  private readonly version: number;
  private databasePromise?: Promise<IDBDatabase>;

  constructor(options: IndexedDBStorageOptions = {}) {
    this.databaseName = options.databaseName ?? "offlinejs";
    this.version = options.version ?? 2;
  }

  async get<TRecord extends EntityRecord>(collection: string, id: string): Promise<TRecord | null> {
    const row = await this.request<IndexedDBRow | undefined>(
      this.store("readonly").get(this.key(collection, id))
    );

    return row ? clone(row.value as TRecord) : null;
  }

  async set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void> {
    const previous = await this.get(collection, value.id);
    if (previous) {
      await this.removeIndexEntries(collection, previous);
    }

    await this.assertUniqueIndexes(collection, value, previous?.id);

    const row: IndexedDBRow = {
      collection,
      id: value.id,
      key: this.key(collection, value.id),
      value: clone(value)
    };

    await this.request(this.store("readwrite").put(row));
    await this.writeIndexEntries(collection, value);
  }

  async delete(collection: string, id: string): Promise<void> {
    const previous = await this.get(collection, id);
    if (previous) {
      await this.removeIndexEntries(collection, previous);
    }
    await this.request(this.store("readwrite").delete(this.key(collection, id)));
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    const indexed = await this.findViaIndex<TRecord>(collection, query);
    const records =
      indexed ??
      (await this.getCollectionRows(collection)).map((row) => clone(row.value as TRecord));

    return applyQuery(records, query);
  }

  async clear(collection?: string): Promise<void> {
    if (!collection) {
      await this.request(this.store("readwrite").clear());
      await this.request(this.indexStore("readwrite").clear());
      await this.request(this.entryStore("readwrite").clear());
      return;
    }

    const rows = await this.getCollectionRows(collection);
    const store = this.store("readwrite");

    await Promise.all(rows.map((row) => this.request(store.delete(row.key))));
    await Promise.all(
      (await this.listIndexes(collection)).map((index) =>
        this.request(this.indexStore("readwrite").delete(this.indexKey(collection, index.name)))
      )
    );

    const entries = await this.getEntriesForCollection(collection);
    await Promise.all(
      entries.map((entry) => this.request(this.entryStore("readwrite").delete(entry.id)))
    );
  }

  async createIndex<TRecord extends EntityRecord>(
    definition: IndexDefinition<TRecord>
  ): Promise<void> {
    const normalized = clone(definition as IndexDefinition);
    await this.request(
      this.indexStore("readwrite").put({
        ...normalized,
        id: this.indexKey(definition.collection, definition.name)
      })
    );

    const rows = await this.getCollectionRows(definition.collection);
    for (const row of rows) {
      await this.assertUniqueIndexes(definition.collection, row.value);
      await this.writeIndexEntries(definition.collection, row.value, [normalized]);
    }
  }

  async dropIndex(collection: string, name: string): Promise<void> {
    await this.request(this.indexStore("readwrite").delete(this.indexKey(collection, name)));
    const entries = await this.getEntriesForCollection(collection);
    await Promise.all(
      entries
        .filter((entry) => entry.indexName === name)
        .map((entry) => this.request(this.entryStore("readwrite").delete(entry.id)))
    );
  }

  async listIndexes(collection?: string): Promise<IndexDefinition[]> {
    const rows = await this.request<Array<IndexDefinition & { id: string }>>(
      this.indexStore("readonly").getAll()
    );

    return rows
      .filter((row) => !collection || row.collection === collection)
      .map((row) => {
        const definition = { ...row } as IndexDefinition & { id?: string };
        delete definition.id;
        return clone(definition);
      });
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

  private async findViaIndex<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[] | null> {
    const match = findMatchingIndex(
      await this.listIndexes(collection),
      getEqualityFilterLookups(query?.filters)
    );

    if (!match) {
      return null;
    }

    const lookup = this.lookupKey(
      collection,
      match.index.name,
      serializeCompoundIndexValue(match.values)
    );
    const entries = await this.request<IndexEntryRow[]>(
      this.entryLookup("readonly").getAll(lookup)
    );
    const records: TRecord[] = [];

    for (const entry of entries) {
      const record = await this.get<TRecord>(collection, entry.recordId);
      if (record) {
        records.push(record);
      }
    }

    return records;
  }

  private async assertUniqueIndexes(
    collection: string,
    record: EntityRecord,
    ignoreId?: string
  ): Promise<void> {
    for (const definition of await this.listIndexes(collection)) {
      if (!definition.unique) {
        continue;
      }

      const lookup = this.lookupKey(
        collection,
        definition.name,
        serializeCompoundIndexValue(readIndexFields(record, definition.fields))
      );
      const entries = await this.request<IndexEntryRow[]>(
        this.entryLookup("readonly").getAll(lookup)
      );

      if (entries.some((entry) => entry.recordId !== record.id && entry.recordId !== ignoreId)) {
        throw new Error(`Unique index "${definition.name}" violated for ${collection}`);
      }
    }
  }

  private async writeIndexEntries(
    collection: string,
    record: EntityRecord,
    definitions?: IndexDefinition[]
  ): Promise<void> {
    const indexes = definitions ?? (await this.listIndexes(collection));

    for (const definition of indexes) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const entry: IndexEntryRow = {
        collection,
        id: this.entryId(collection, definition.name, valueKey, record.id),
        indexName: definition.name,
        lookup: this.lookupKey(collection, definition.name, valueKey),
        recordId: record.id,
        valueKey
      };
      await this.request(this.entryStore("readwrite").put(entry));
    }
  }

  private async removeIndexEntries(collection: string, record: EntityRecord): Promise<void> {
    for (const definition of await this.listIndexes(collection)) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      await this.request(
        this.entryStore("readwrite").delete(
          this.entryId(collection, definition.name, valueKey, record.id)
        )
      );
    }
  }

  private async getCollectionRows(collection: string): Promise<IndexedDBRow[]> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index(COLLECTION_INDEX);

    return this.request<IndexedDBRow[]>(index.getAll(collection));
  }

  private async getEntriesForCollection(collection: string): Promise<IndexEntryRow[]> {
    const all = await this.request<IndexEntryRow[]>(this.entryStore("readonly").getAll());
    return all.filter((entry) => entry.collection === collection);
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.objectStoreProxy(STORE_NAME, mode) as unknown as IDBObjectStore;
  }

  private indexStore(mode: IDBTransactionMode): IDBObjectStore {
    return this.objectStoreProxy(INDEX_STORE_NAME, mode) as unknown as IDBObjectStore;
  }

  private entryStore(mode: IDBTransactionMode): IDBObjectStore {
    return this.objectStoreProxy(INDEX_ENTRIES_STORE, mode) as unknown as IDBObjectStore;
  }

  private entryLookup(mode: IDBTransactionMode): {
    getAll: (lookup: string) => Promise<IDBRequest<IndexEntryRow[]>>;
  } {
    const databasePromise = this.database();
    return {
      getAll: (lookup: string) =>
        databasePromise.then((database) =>
          database
            .transaction(INDEX_ENTRIES_STORE, mode)
            .objectStore(INDEX_ENTRIES_STORE)
            .index(LOOKUP_INDEX)
            .getAll(lookup)
        )
    };
  }

  private objectStoreProxy(storeName: string, mode: IDBTransactionMode) {
    const databasePromise = this.database();
    return {
      get: (key: string) =>
        databasePromise.then((database) =>
          database.transaction(storeName, mode).objectStore(storeName).get(key)
        ),
      put: (value: unknown) =>
        databasePromise.then((database) =>
          database.transaction(storeName, mode).objectStore(storeName).put(value)
        ),
      delete: (key: string) =>
        databasePromise.then((database) =>
          database.transaction(storeName, mode).objectStore(storeName).delete(key)
        ),
      clear: () =>
        databasePromise.then((database) =>
          database.transaction(storeName, mode).objectStore(storeName).clear()
        ),
      getAll: () =>
        databasePromise.then((database) =>
          database.transaction(storeName, mode).objectStore(storeName).getAll()
        )
    };
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
        if (!database.objectStoreNames.contains(INDEX_STORE_NAME)) {
          database.createObjectStore(INDEX_STORE_NAME, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(INDEX_ENTRIES_STORE)) {
          const entries = database.createObjectStore(INDEX_ENTRIES_STORE, { keyPath: "id" });
          entries.createIndex(LOOKUP_INDEX, LOOKUP_INDEX, { unique: false });
          entries.createIndex(COLLECTION_INDEX, COLLECTION_INDEX, { unique: false });
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

  private indexKey(collection: string, name: string): string {
    return `${collection}:${name}`;
  }

  private lookupKey(collection: string, indexName: string, valueKey: string): string {
    return `${collection}:${indexName}:${valueKey}`;
  }

  private entryId(
    collection: string,
    indexName: string,
    valueKey: string,
    recordId: string
  ): string {
    return `${collection}:${indexName}:${valueKey}:${recordId}`;
  }
}

export const createIndexedDBStorage = (
  options?: IndexedDBStorageOptions
): IndexedDBStorageAdapter => new IndexedDBStorageAdapter(options);
