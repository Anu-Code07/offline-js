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
  indexSatisfiesQuery,
  queryPageWindow,
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
    bulkWrites: true,
    migrations: true,
    persistence: "durable",
    transactions: "atomic"
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
    await this.setMany(collection, [value]);
  }

  async setMany<TRecord extends EntityRecord>(collection: string, values: TRecord[]): Promise<void> {
    if (values.length === 0) {
      return;
    }

    const byId = new Map<string, TRecord>();
    for (const value of values) {
      byId.set(value.id, value);
    }
    const records = [...byId.values()];

    await this.runInTransaction(
      [STORE_NAME, INDEX_STORE_NAME, INDEX_ENTRIES_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(STORE_NAME);
        const indexStore = transaction.objectStore(INDEX_STORE_NAME);
        const entryStore = transaction.objectStore(INDEX_ENTRIES_STORE);
        const definitions = await this.listIndexesFromStore(indexStore, collection);
        const batchIds = new Set(records.map((record) => record.id));

        const previousRows = await Promise.all(
          records.map((record) =>
            this.request<IndexedDBRow | undefined>(recordStore.get(this.key(collection, record.id)))
          )
        );

        for (const record of records) {
          await this.assertUniqueIndexesInStore(entryStore, definitions, collection, record, batchIds);
        }

        for (const previous of previousRows) {
          if (previous) {
            await this.removeIndexEntriesInStore(entryStore, definitions, collection, previous.value);
          }
        }

        for (const record of records) {
          const row: IndexedDBRow = {
            collection,
            id: record.id,
            key: this.key(collection, record.id),
            value: clone(record)
          };
          await this.request(recordStore.put(row));
          await this.writeIndexEntriesInStore(entryStore, definitions, collection, record);
        }
      }
    );
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.runInTransaction(
      [STORE_NAME, INDEX_STORE_NAME, INDEX_ENTRIES_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(STORE_NAME);
        const indexStore = transaction.objectStore(INDEX_STORE_NAME);
        const entryStore = transaction.objectStore(INDEX_ENTRIES_STORE);
        const previous = await this.request<IndexedDBRow | undefined>(
          recordStore.get(this.key(collection, id))
        );
        if (previous) {
          const definitions = await this.listIndexesFromStore(indexStore, collection);
          await this.removeIndexEntriesInStore(entryStore, definitions, collection, previous.value);
        }
        await this.request(recordStore.delete(this.key(collection, id)));
      }
    );
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    const indexed = await this.findViaIndex<TRecord>(collection, query);
    if (indexed?.complete) {
      return indexed.records;
    }

    const records =
      indexed?.records ??
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
      .filter((row) => !collection || row.collection === collection || row.id.startsWith(`${collection}:`))
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
  ): Promise<{ complete: boolean; records: TRecord[] } | null> {
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
    let entries = await this.request<IndexEntryRow[]>(this.entryLookup("readonly").getAll(lookup));
    const complete = indexSatisfiesQuery(match, query);

    if (complete) {
      const { offset, limit } = queryPageWindow(query);
      entries =
        limit === undefined ? entries.slice(offset) : entries.slice(offset, offset + limit);
    }

    if (entries.length === 0) {
      return { complete, records: [] };
    }

    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const rows = await Promise.all(
      entries.map((entry) =>
        this.request<IndexedDBRow | undefined>(store.get(this.key(collection, entry.recordId)))
      )
    );

    return {
      complete,
      records: rows
        .filter((row): row is IndexedDBRow => Boolean(row))
        .map((row) => clone(row.value as TRecord))
    };
  }

  private async assertUniqueIndexes(
    collection: string,
    record: EntityRecord,
    ignoreId?: string
  ): Promise<void> {
    const definitions = await this.listIndexes(collection);
    await this.runInTransaction(INDEX_ENTRIES_STORE, "readonly", async (transaction) => {
      await this.assertUniqueIndexesInStore(
        transaction.objectStore(INDEX_ENTRIES_STORE),
        definitions,
        collection,
        record,
        ignoreId ? new Set([ignoreId, record.id]) : new Set([record.id])
      );
    });
  }

  private async writeIndexEntries(
    collection: string,
    record: EntityRecord,
    definitions?: IndexDefinition[]
  ): Promise<void> {
    const indexes = definitions ?? (await this.listIndexes(collection));
    await this.runInTransaction(INDEX_ENTRIES_STORE, "readwrite", async (transaction) => {
      await this.writeIndexEntriesInStore(
        transaction.objectStore(INDEX_ENTRIES_STORE),
        indexes,
        collection,
        record
      );
    });
  }

  private async removeIndexEntries(collection: string, record: EntityRecord): Promise<void> {
    const definitions = await this.listIndexes(collection);
    await this.runInTransaction(INDEX_ENTRIES_STORE, "readwrite", async (transaction) => {
      await this.removeIndexEntriesInStore(
        transaction.objectStore(INDEX_ENTRIES_STORE),
        definitions,
        collection,
        record
      );
    });
  }

  private async listIndexesFromStore(
    store: IDBObjectStore,
    collection?: string
  ): Promise<IndexDefinition[]> {
    const rows = await this.request<Array<IndexDefinition & { id: string }>>(store.getAll());
    return rows
      .filter((row) => !collection || row.collection === collection || row.id.startsWith(`${collection}:`))
      .map((row) => {
        const definition = { ...row } as IndexDefinition & { id?: string };
        delete definition.id;
        return clone(definition);
      });
  }

  private async assertUniqueIndexesInStore(
    entryStore: IDBObjectStore,
    definitions: IndexDefinition[],
    collection: string,
    record: EntityRecord,
    allowedIds: Set<string>
  ): Promise<void> {
    const lookupIndex = entryStore.index(LOOKUP_INDEX);
    for (const definition of definitions) {
      if (!definition.unique) {
        continue;
      }
      const lookup = this.lookupKey(
        collection,
        definition.name,
        serializeCompoundIndexValue(readIndexFields(record, definition.fields))
      );
      const entries = await this.request<IndexEntryRow[]>(lookupIndex.getAll(lookup));
      if (entries.some((entry) => !allowedIds.has(entry.recordId))) {
        throw new Error(`Unique index "${definition.name}" violated for ${collection}`);
      }
    }
  }

  private async writeIndexEntriesInStore(
    entryStore: IDBObjectStore,
    definitions: IndexDefinition[],
    collection: string,
    record: EntityRecord
  ): Promise<void> {
    for (const definition of definitions) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const entry: IndexEntryRow = {
        collection,
        id: this.entryId(collection, definition.name, valueKey, record.id),
        indexName: definition.name,
        lookup: this.lookupKey(collection, definition.name, valueKey),
        recordId: record.id,
        valueKey
      };
      await this.request(entryStore.put(entry));
    }
  }

  private async removeIndexEntriesInStore(
    entryStore: IDBObjectStore,
    definitions: IndexDefinition[],
    collection: string,
    record: EntityRecord
  ): Promise<void> {
    for (const definition of definitions) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      await this.request(
        entryStore.delete(this.entryId(collection, definition.name, valueKey, record.id))
      );
    }
  }

  private async runInTransaction<TValue>(
    storeNames: string | string[],
    mode: IDBTransactionMode,
    run: (transaction: IDBTransaction) => Promise<TValue>
  ): Promise<TValue> {
    const database = await this.database();
    const transaction = database.transaction(storeNames, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });

    try {
      const result = await run(transaction);
      await done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already be finished.
      }
      await done.catch(() => undefined);
      throw error;
    }
  }

  private async getCollectionRows(collection: string): Promise<IndexedDBRow[]> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index(COLLECTION_INDEX);

    return this.request<IndexedDBRow[]>(index.getAll(collection));
  }

  private async getEntriesForCollection(collection: string): Promise<IndexEntryRow[]> {
    const database = await this.database();
    const transaction = database.transaction(INDEX_ENTRIES_STORE, "readonly");
    const index = transaction.objectStore(INDEX_ENTRIES_STORE).index(COLLECTION_INDEX);
    return this.request<IndexEntryRow[]>(index.getAll(collection));
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
