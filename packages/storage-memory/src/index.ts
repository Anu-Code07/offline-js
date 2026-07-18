import type {
  EntityRecord,
  QueryOptions,
  StorageAdapter,
  StorageMigration,
  TransactionStore
} from "@offlinejs/types";
import { applyQuery, clone } from "@offlinejs/utils";

export interface MemoryStorageOptions {
  name?: string;
  seed?: Record<string, EntityRecord[]>;
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly name: string;

  private readonly records = new Map<string, Map<string, EntityRecord>>();
  private readonly appliedMigrations = new Set<string>();

  constructor(options: MemoryStorageOptions = {}) {
    this.name = options.name ?? "memory";

    for (const [collection, records] of Object.entries(options.seed ?? {})) {
      this.records.set(
        collection,
        new Map(records.map((record) => [record.id, clone(record)]))
      );
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
      return;
    }

    this.records.clear();
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
