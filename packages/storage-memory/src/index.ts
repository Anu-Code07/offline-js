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

export interface MemoryStorageOptions {
  name?: string;
  seed?: Record<string, EntityRecord[]>;
}

export class MemoryStorageAdapter implements IndexableStorageAdapter {
  readonly name: string;
  readonly contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    indexes: true,
    bulkWrites: true,
    migrations: true,
    persistence: "ephemeral",
    transactions: "atomic"
  } as const;

  private readonly records = new Map<string, Map<string, EntityRecord>>();
  private readonly indexes = new Map<string, Map<string, IndexDefinition>>();
  /** collection → indexName → serializedValue → record ids */
  private readonly secondary = new Map<string, Map<string, Map<string, Set<string>>>>();
  private readonly appliedMigrations = new Set<string>();

  constructor(options: MemoryStorageOptions = {}) {
    this.name = options.name ?? "memory";

    for (const [collection, records] of Object.entries(options.seed ?? {})) {
      this.records.set(collection, new Map(records.map((record) => [record.id, clone(record)])));
    }
  }

  async get<TRecord extends EntityRecord>(collection: string, id: string): Promise<TRecord | null> {
    const record = this.records.get(collection)?.get(id);
    return record ? clone(record as TRecord) : null;
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

    // Validate first so a unique violation never leaves a partial batch applied.
    for (const value of records) {
      const previous = this.records.get(collection)?.get(value.id);
      this.assertUniqueIndexes(collection, value, previous?.id);
    }

    for (const value of records) {
      const previous = this.records.get(collection)?.get(value.id);
      if (previous) {
        this.unindexRecord(collection, previous);
      }
      this.ensureCollection(collection).set(value.id, clone(value));
      this.indexRecord(collection, value);
    }
  }

  async delete(collection: string, id: string): Promise<void> {
    const previous = this.records.get(collection)?.get(id);
    if (previous) {
      this.unindexRecord(collection, previous);
    }
    this.records.get(collection)?.delete(id);
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    const indexed = this.findViaIndex<TRecord>(collection, query);
    if (indexed?.complete) {
      return indexed.records.map((record) => clone(record));
    }

    const records =
      indexed?.records ?? ([...(this.records.get(collection)?.values() ?? [])] as TRecord[]);

    // Filter/sort/limit on live refs, then clone only the page returned to callers.
    return applyQuery(records, query).map((record) => clone(record));
  }

  async clear(collection?: string): Promise<void> {
    if (collection) {
      this.records.delete(collection);
      this.indexes.delete(collection);
      this.secondary.delete(collection);
      return;
    }

    this.records.clear();
    this.indexes.clear();
    this.secondary.clear();
  }

  async createIndex<TRecord extends EntityRecord>(
    definition: IndexDefinition<TRecord>
  ): Promise<void> {
    const normalized = clone(definition as IndexDefinition);
    const collectionIndexes = this.indexes.get(definition.collection) ?? new Map();
    collectionIndexes.set(definition.name, normalized);
    this.indexes.set(definition.collection, collectionIndexes);

    const bucket = new Map<string, Set<string>>();
    const collectionSecondary = this.secondary.get(definition.collection) ?? new Map();
    collectionSecondary.set(definition.name, bucket);
    this.secondary.set(definition.collection, collectionSecondary);

    for (const record of this.records.get(definition.collection)?.values() ?? []) {
      this.assertUniqueIndexes(definition.collection, record);
      this.addToSecondary(definition.collection, normalized, record);
    }
  }

  async dropIndex(collection: string, name: string): Promise<void> {
    this.indexes.get(collection)?.delete(name);
    this.secondary.get(collection)?.delete(name);
  }

  async listIndexes(collection?: string): Promise<IndexDefinition[]> {
    if (collection) {
      return [...(this.indexes.get(collection)?.values() ?? [])].map((index) => clone(index));
    }

    return [...this.indexes.values()].flatMap((indexes) =>
      [...indexes.values()].map((index) => clone(index))
    );
  }

  async transaction<TValue>(
    scope: string[],
    run: (store: TransactionStore) => Promise<TValue>
  ): Promise<TValue> {
    const snapshot = new Map<string, Map<string, EntityRecord>>();
    const indexSnapshot = new Map<string, Map<string, IndexDefinition>>();
    const secondarySnapshot = new Map<string, Map<string, Map<string, Set<string>>>>();

    for (const collection of scope) {
      snapshot.set(collection, new Map(this.records.get(collection) ?? []));
      indexSnapshot.set(
        collection,
        new Map(
          [...(this.indexes.get(collection)?.entries() ?? [])].map(([name, definition]) => [
            name,
            clone(definition)
          ])
        )
      );
      secondarySnapshot.set(collection, cloneSecondary(this.secondary.get(collection)));
    }

    try {
      return await run(this);
    } catch (error) {
      for (const collection of scope) {
        const records = snapshot.get(collection);
        if (records) {
          this.records.set(collection, records);
        } else {
          this.records.delete(collection);
        }

        const indexes = indexSnapshot.get(collection);
        if (indexes && indexes.size > 0) {
          this.indexes.set(collection, indexes);
        } else {
          this.indexes.delete(collection);
        }

        const secondary = secondarySnapshot.get(collection);
        if (secondary && secondary.size > 0) {
          this.secondary.set(collection, secondary);
        } else {
          this.secondary.delete(collection);
        }
      }

      throw error;
    }
  }

  async migrate(migrations: StorageMigration[]): Promise<void> {
    for (const migration of migrations) {
      if (this.appliedMigrations.has(migration.name)) {
        continue;
      }

      await this.transaction(["__migrations"], async (store) => {
        await migration.up(store);
        this.appliedMigrations.add(migration.name);
      });
    }
  }

  private findViaIndex<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): { complete: boolean; records: TRecord[] } | null {
    const definitions = [...(this.indexes.get(collection)?.values() ?? [])];
    const match = findMatchingIndex(definitions, getEqualityFilterLookups(query?.filters));

    if (!match) {
      return null;
    }

    const valueKey = serializeCompoundIndexValue(match.values);
    const ids = this.secondary.get(collection)?.get(match.index.name)?.get(valueKey);
    if (!ids) {
      return { complete: indexSatisfiesQuery(match, query), records: [] };
    }

    let idList = [...ids];
    const complete = indexSatisfiesQuery(match, query);
    if (complete) {
      const { offset, limit } = queryPageWindow(query);
      idList = limit === undefined ? idList.slice(offset) : idList.slice(offset, offset + limit);
    }

    const records: TRecord[] = [];
    for (const id of idList) {
      const record = this.records.get(collection)?.get(id);
      if (record) {
        records.push(record as TRecord);
      }
    }

    return { complete, records };
  }

  private assertUniqueIndexes(
    collection: string,
    record: EntityRecord,
    ignoreId?: string
  ): void {
    for (const definition of this.indexes.get(collection)?.values() ?? []) {
      if (!definition.unique) {
        continue;
      }

      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const ids = this.secondary.get(collection)?.get(definition.name)?.get(valueKey);

      if (!ids) {
        continue;
      }

      for (const id of ids) {
        if (id !== record.id && id !== ignoreId) {
          throw new Error(
            `Unique index "${definition.name}" violated for ${collection}.${String(definition.fields[0])}`
          );
        }
      }
    }
  }

  private indexRecord(collection: string, record: EntityRecord): void {
    for (const definition of this.indexes.get(collection)?.values() ?? []) {
      this.addToSecondary(collection, definition, record);
    }
  }

  private unindexRecord(collection: string, record: EntityRecord): void {
    for (const definition of this.indexes.get(collection)?.values() ?? []) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const bucket = this.secondary.get(collection)?.get(definition.name)?.get(valueKey);
      bucket?.delete(record.id);
      if (bucket && bucket.size === 0) {
        this.secondary.get(collection)?.get(definition.name)?.delete(valueKey);
      }
    }
  }

  private addToSecondary(
    collection: string,
    definition: IndexDefinition,
    record: EntityRecord
  ): void {
    const collectionSecondary = this.secondary.get(collection) ?? new Map();
    const indexBucket = collectionSecondary.get(definition.name) ?? new Map<string, Set<string>>();
    const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
    const ids = indexBucket.get(valueKey) ?? new Set<string>();
    ids.add(record.id);
    indexBucket.set(valueKey, ids);
    collectionSecondary.set(definition.name, indexBucket);
    this.secondary.set(collection, collectionSecondary);
  }

  private ensureCollection(collection: string): Map<string, EntityRecord> {
    const existing = this.records.get(collection);

    if (existing) {
      return existing;
    }

    const records = new Map<string, EntityRecord>();
    this.records.set(collection, records);
    return records;
  }
}

const cloneSecondary = (
  source?: Map<string, Map<string, Set<string>>>
): Map<string, Map<string, Set<string>>> => {
  const cloned = new Map<string, Map<string, Set<string>>>();

  for (const [indexName, values] of source ?? []) {
    const valueMap = new Map<string, Set<string>>();
    for (const [valueKey, ids] of values) {
      valueMap.set(valueKey, new Set(ids));
    }
    cloned.set(indexName, valueMap);
  }

  return cloned;
};

export const createMemoryStorage = (options?: MemoryStorageOptions): MemoryStorageAdapter =>
  new MemoryStorageAdapter(options);
