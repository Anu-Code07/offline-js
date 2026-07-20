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
  indexSatisfiesQuery,
  queryPageWindow,
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
    bulkWrites: true,
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
    await this.setMany(collection, [value]);
  }

  async setMany<TRecord extends EntityRecord>(collection: string, values: TRecord[]): Promise<void> {
    if (values.length === 0) {
      return;
    }

    await this.initialize();
    const byId = new Map<string, TRecord>();
    for (const value of values) {
      byId.set(value.id, value);
    }
    const records = [...byId.values()];

    const writeBatch = async (): Promise<void> => {
      for (const value of records) {
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
    };

    if (this.driver.transaction) {
      await this.driver.transaction(writeBatch);
      return;
    }

    await writeBatch();
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
    if (indexed?.complete) {
      return indexed.records;
    }

    if (!indexed) {
      const pushed = this.buildPushedFindSQL(collection, query);
      if (pushed) {
        try {
          const rows = await this.driver.query<SQLiteRecordRow>(pushed.sql, pushed.params);
          return rows.map((row) => JSON.parse(row.value) as TRecord);
        } catch {
          // Driver may not support json_extract — fall through to full scan.
        }
      }
    }

    const records =
      indexed?.records ??
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

  /**
   * Push equality filters + order/limit into SQL when the whole query is engine-safe.
   * Complex search/operators stay in JS `applyQuery`.
   */
  private buildPushedFindSQL<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): { sql: string; params: unknown[] } | null {
    if (!query || query.search) {
      return null;
    }

    const params: unknown[] = [collection];
    const clauses = [`collection = ?`];

    if (query.filters) {
      for (const [field, expected] of Object.entries(query.filters)) {
        if (expected === undefined) {
          return null;
        }
        if (Array.isArray(expected) || expected === null || typeof expected !== "object") {
          clauses.push(`json_extract(value, '$.${field}') = ?`);
          params.push(expected);
          continue;
        }
        if ("eq" in expected && Object.keys(expected).length === 1 && expected.eq !== undefined) {
          clauses.push(`json_extract(value, '$.${field}') = ?`);
          params.push(expected.eq);
          continue;
        }
        return null;
      }
    }

    let sql = `SELECT value FROM ${this.tableName} WHERE ${clauses.join(" AND ")}`;
    if (query.orderBy) {
      sql += ` ORDER BY json_extract(value, '$.${String(query.orderBy)}') ${
        query.sort === "desc" ? "DESC" : "ASC"
      }`;
    }
    if (query.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(query.limit);
    }
    if (query.offset !== undefined && query.offset > 0) {
      if (query.limit === undefined) {
        sql += ` LIMIT -1`;
      }
      sql += ` OFFSET ?`;
      params.push(query.offset);
    }

    return { sql, params };
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

    const valueKey = serializeCompoundIndexValue(match.values);
    let rows = await this.driver.query<{ record_id: string }>(
      `SELECT record_id FROM ${this.tableName}_index_entries WHERE collection = ? AND index_name = ? AND value_key = ?`,
      [collection, match.index.name, valueKey]
    );
    const complete = indexSatisfiesQuery(match, query);

    if (complete) {
      const { offset, limit } = queryPageWindow(query);
      rows = limit === undefined ? rows.slice(offset) : rows.slice(offset, offset + limit);
    }

    if (rows.length === 0) {
      return { complete, records: [] };
    }

    const placeholders = rows.map(() => "?").join(", ");
    const values = await this.driver.query<SQLiteRecordRow>(
      `SELECT value FROM ${this.tableName} WHERE collection = ? AND id IN (${placeholders})`,
      [collection, ...rows.map((row) => row.record_id)]
    );

    return {
      complete,
      records: values.map((row) => JSON.parse(row.value) as TRecord)
    };
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

export {
  createBetterSqlite3Driver,
  createBetterSqlite3DriverAsync,
  type BetterSqlite3Database
} from "./better-sqlite3";
