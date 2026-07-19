import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  type EntityRecord,
  type IndexDefinition,
  type IndexableStorageAdapter,
  type QueryOptions,
  type StorageMigration,
  type TransactionStore
} from "@offlinejs/types";
import { applyQuery } from "@offlinejs/utils";

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

  constructor(options: SQLiteStorageOptions) {
    this.driver = options.driver;
    this.tableName = options.tableName ?? "offlinejs_records";
  }

  async initialize(): Promise<void> {
    await this.driver.execute(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, id))`
    );
    await this.driver.execute(
      `CREATE TABLE IF NOT EXISTS ${this.tableName}_indexes (collection TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, name))`
    );
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
    await this.driver.execute(
      `INSERT OR REPLACE INTO ${this.tableName} (collection, id, value) VALUES (?, ?, ?)`,
      [collection, value.id, JSON.stringify(value)]
    );
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.initialize();
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
    const rows = await this.driver.query<SQLiteRecordRow>(
      `SELECT value FROM ${this.tableName} WHERE collection = ?`,
      [collection]
    );

    return applyQuery(
      rows.map((row) => JSON.parse(row.value) as TRecord),
      query
    );
  }

  async clear(collection?: string): Promise<void> {
    await this.initialize();

    if (collection) {
      await this.driver.execute(`DELETE FROM ${this.tableName} WHERE collection = ?`, [collection]);
      await this.driver.execute(`DELETE FROM ${this.tableName}_indexes WHERE collection = ?`, [
        collection
      ]);
      return;
    }

    await this.driver.execute(`DELETE FROM ${this.tableName}`);
    await this.driver.execute(`DELETE FROM ${this.tableName}_indexes`);
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
  }

  async dropIndex(collection: string, name: string): Promise<void> {
    await this.initialize();
    await this.driver.execute(
      `DELETE FROM ${this.tableName}_indexes WHERE collection = ? AND name = ?`,
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
}

export const createSQLiteStorage = (options: SQLiteStorageOptions): SQLiteStorageAdapter =>
  new SQLiteStorageAdapter(options);
