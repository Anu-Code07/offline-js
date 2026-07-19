import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  type EntityRecord,
  type IndexDefinition,
  type IndexableStorageAdapter,
  type QueryOptions,
  type StorageMigration,
  type TransactionStore
} from "@offlinejs/types";
import { applyQuery, clone } from "@offlinejs/utils";

export interface MemoryStorageOptions {
  name?: string;
  seed?: Record<string, EntityRecord[]>;
}

export class MemoryStorageAdapter implements IndexableStorageAdapter {
  readonly name: string;
  readonly contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    indexes: true,
    migrations: true,
    persistence: "ephemeral",
    transactions: "atomic"
  } as const;

  private readonly records = new Map<string, Map<string, EntityRecord>>();
  private readonly indexes = new Map<string, Map<string, IndexDefinition>>();
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
    this.ensureCollection(collection).set(value.id, clone(value));
  }

  async delete(collection: string, id: string): Promise<void> {
    this.records.get(collection)?.delete(id);
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    const records = [...(this.records.get(collection)?.values() ?? [])].map((record) =>
      clone(record as TRecord)
    );

    return applyQuery(records, query);
  }

  async clear(collection?: string): Promise<void> {
    if (collection) {
      this.records.delete(collection);
      this.indexes.delete(collection);
      return;
    }

    this.records.clear();
    this.indexes.clear();
  }

  async createIndex<TRecord extends EntityRecord>(
    definition: IndexDefinition<TRecord>
  ): Promise<void> {
    const collectionIndexes = this.indexes.get(definition.collection) ?? new Map();
    collectionIndexes.set(definition.name, clone(definition as IndexDefinition));
    this.indexes.set(definition.collection, collectionIndexes);
  }

  async dropIndex(collection: string, name: string): Promise<void> {
    this.indexes.get(collection)?.delete(name);
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

    for (const collection of scope) {
      snapshot.set(collection, new Map(this.records.get(collection) ?? []));
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

export const createMemoryStorage = (options?: MemoryStorageOptions): MemoryStorageAdapter =>
  new MemoryStorageAdapter(options);
