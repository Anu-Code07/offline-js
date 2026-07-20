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
  findMatchingIndex,
  getEqualityFilterLookups,
  readIndexFields,
  serializeCompoundIndexValue
} from "@offlinejs/utils";

export interface SQLiteDriver {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<TValue = unknown>(sql: string, params?: unknown[]): Promise<TValue[]>;
  transaction?<TValue>(run: () => Promise<TValue>): Promise<TValue>;
}

export interface SQLiteStorageOptions {
  driver: SQLiteDriver;
  tableName?: string;
}

interface SQLiteRecordRow {
  collection: string;
  id: string;
  value: string;
}

export class SQLiteStorageAdapter implements IndexableStorageAdapter {
  readonly name = "sqlite";
  readonly contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    indexes: true,
    migrations: true,
    persistence: "durable",
    transactions: "best-effort"
  } as const;

  private readonly driver: SQLiteDriver;
  private readonly tableName: string;
  private initialized = false;

  constructor(options: SQLiteStorageOptions) {
    this.driver = options.driver;
    this.tableName = options.tableName ?? "offlinejs_records";
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.driver.execute(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, id))`
    );
    await this.driver.execute(
      `CREATE TABLE IF NOT EXISTS ${this.tableName}_indexes (collection TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, name))`
    );
    await this.driver.execute(
      `CREATE TABLE IF NOT EXISTS ${this.tableName}_index_entries (collection TEXT NOT NULL, index_name TEXT NOT NULL, value_key TEXT NOT NULL, record_id TEXT NOT NULL, PRIMARY KEY (collection, index_name, value_key, record_id))`
    );
    await this.driver.execute(
      `CREATE INDEX IF NOT EXISTS ${this.tableName}_index_entries_lookup ON ${this.tableName}_index_entries (collection, index_name, value_key)`
    );
    this.initialized = true;
  }

  async get<TRecord extends EntityRecord>(collection: string, id: string): Promise<TRecord | null> {
    await this.initialize();
    const rows = await this.driver.query<SQLiteRecordRow>(
      `SELECT value FROM ${this.tableName} WHERE collection = ? AND id = ? LIMIT 1`,
      [collection, id]
    );

    return rows[0] ? (JSON.parse(rows[0].value) as TRecord) : null;
  }

  async set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void> {
    await this.initialize();
    const previous = await this.get(collection, value.id);
    if (previous) {
      await this.removeIndexEntries(collection, previous);
    }

    await this.assertUniqueIndexes(collection, value, previous?.id);
    await this.driver.execute(
      `INSERT OR REPLACE INTO ${this.tableName} (collection, id, value) VALUES (?, ?, ?)`,
      [collection, value.id, JSON.stringify(value)]
    );
    await this.writeIndexEntries(collection, value);
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.initialize();
    const previous = await this.get(collection, id);
    if (previous) {
      await this.removeIndexEntries(collection, previous);
    }
    await this.driver.execute(`DELETE FROM ${this.tableName} WHERE collection = ? AND id = ?`, [
      collection,
      id
    ]);
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    await this.initialize();
    const indexed = await this.findViaIndex<TRecord>(collection, query);
    const records =
      indexed ??
      (
        await this.driver.query<SQLiteRecordRow>(
          `SELECT value FROM ${this.tableName} WHERE collection = ?`,
          [collection]
        )
      ).map((row) => JSON.parse(row.value) as TRecord);

    return applyQuery(records, query);
  }

  async clear(collection?: string): Promise<void> {
    await this.initialize();

    if (collection) {
      await this.driver.execute(`DELETE FROM ${this.tableName} WHERE collection = ?`, [collection]);
      await this.driver.execute(`DELETE FROM ${this.tableName}_indexes WHERE collection = ?`, [
        collection
      ]);
      await this.driver.execute(
        `DELETE FROM ${this.tableName}_index_entries WHERE collection = ?`,
        [collection]
      );
      return;
    }

    await this.driver.execute(`DELETE FROM ${this.tableName}`);
    await this.driver.execute(`DELETE FROM ${this.tableName}_indexes`);
    await this.driver.execute(`DELETE FROM ${this.tableName}_index_entries`);
  }

  async transaction<TValue>(
    _scope: string[],
    run: (store: TransactionStore) => Promise<TValue>
  ): Promise<TValue> {
    if (this.driver.transaction) {
      return this.driver.transaction(() => run(this));
    }

    return run(this);
  }

  async migrate(migrations: StorageMigration[]): Promise<void> {
    await this.initialize();
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

  async createIndex<TRecord extends EntityRecord>(
    definition: IndexDefinition<TRecord>
  ): Promise<void> {
    await this.initialize();
    await this.driver.execute(
      `INSERT OR REPLACE INTO ${this.tableName}_indexes (collection, name, value) VALUES (?, ?, ?)`,
      [definition.collection, definition.name, JSON.stringify(definition)]
    );

    const rows = await this.driver.query<SQLiteRecordRow>(
      `SELECT value FROM ${this.tableName} WHERE collection = ?`,
      [definition.collection]
    );

    for (const row of rows) {
      const record = JSON.parse(row.value) as EntityRecord;
      await this.assertUniqueIndexes(definition.collection, record);
      await this.writeIndexEntries(definition.collection, record, [definition as IndexDefinition]);
    }
  }

  async dropIndex(collection: string, name: string): Promise<void> {
    await this.initialize();
    await this.driver.execute(
      `DELETE FROM ${this.tableName}_indexes WHERE collection = ? AND name = ?`,
      [collection, name]
    );
    await this.driver.execute(
      `DELETE FROM ${this.tableName}_index_entries WHERE collection = ? AND index_name = ?`,
      [collection, name]
    );
  }

  async listIndexes(collection?: string): Promise<IndexDefinition[]> {
    await this.initialize();
    const rows = collection
      ? await this.driver.query<{ value: string }>(
          `SELECT value FROM ${this.tableName}_indexes WHERE collection = ?`,
          [collection]
        )
      : await this.driver.query<{ value: string }>(`SELECT value FROM ${this.tableName}_indexes`);

    return rows.map((row) => JSON.parse(row.value) as IndexDefinition);
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

    const valueKey = serializeCompoundIndexValue(match.values);
    const rows = await this.driver.query<{ record_id: string }>(
      `SELECT record_id FROM ${this.tableName}_index_entries WHERE collection = ? AND index_name = ? AND value_key = ?`,
      [collection, match.index.name, valueKey]
    );
    const records: TRecord[] = [];

    for (const row of rows) {
      const record = await this.get<TRecord>(collection, row.record_id);
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

      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const rows = await this.driver.query<{ record_id: string }>(
        `SELECT record_id FROM ${this.tableName}_index_entries WHERE collection = ? AND index_name = ? AND value_key = ?`,
        [collection, definition.name, valueKey]
      );

      if (rows.some((row) => row.record_id !== record.id && row.record_id !== ignoreId)) {
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
      await this.driver.execute(
        `INSERT OR REPLACE INTO ${this.tableName}_index_entries (collection, index_name, value_key, record_id) VALUES (?, ?, ?, ?)`,
        [collection, definition.name, valueKey, record.id]
      );
    }
  }

  private async removeIndexEntries(collection: string, record: EntityRecord): Promise<void> {
    for (const definition of await this.listIndexes(collection)) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      await this.driver.execute(
        `DELETE FROM ${this.tableName}_index_entries WHERE collection = ? AND index_name = ? AND value_key = ? AND record_id = ?`,
        [collection, definition.name, valueKey, record.id]
      );
    }
  }
}

export const createSQLiteStorage = (options: SQLiteStorageOptions): SQLiteStorageAdapter =>
  new SQLiteStorageAdapter(options);
