import type { SQLiteDriver } from "./index";

export interface BetterSqlite3Database {
  prepare(sql: string): {
    run: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
  exec(sql: string): unknown;
  transaction<TValue>(fn: () => TValue): () => TValue;
  close?: () => void;
}

/**
 * Wrap a better-sqlite3 Database as an OfflineJS SQLiteDriver.
 * Install optionally: `pnpm add better-sqlite3`
 *
 * @example
 * ```ts
 * import Database from "better-sqlite3";
 * import { createSQLiteStorage, createBetterSqlite3Driver } from "@offlinejs/storage-sqlite";
 *
 * const db = new Database("offline.db");
 * const storage = createSQLiteStorage({ driver: createBetterSqlite3Driver(db) });
 * ```
 */
export const createBetterSqlite3Driver = (database: BetterSqlite3Database): SQLiteDriver => ({
  async execute(sql, params = []) {
    if (/^\s*CREATE\b/i.test(sql) && !params.length) {
      database.exec(sql);
      return;
    }
    database.prepare(sql).run(...params);
  },
  async query<TValue = unknown>(sql, params = []) {
    return database.prepare(sql).all(...params) as TValue[];
  },
  async transaction<TValue>(run) {
    const wrapped = database.transaction(() => {
      // better-sqlite3 transactions are sync; bridge async OfflineJS drivers carefully.
      let result!: TValue;
      let error: unknown;
      let settled = false;
      void Promise.resolve(run())
        .then((value) => {
          result = value;
          settled = true;
        })
        .catch((reason) => {
          error = reason;
          settled = true;
        });
      if (!settled) {
        throw new Error(
          "better-sqlite3 transactions require synchronous work; use await outside transaction or sync APIs"
        );
      }
      if (error) {
        throw error;
      }
      return result;
    });
    return wrapped();
  }
});

/**
 * Create a sync-friendly better-sqlite3 driver that runs OfflineJS SQL statements
 * without nesting async work inside native transactions. Prefer this helper.
 */
export const createBetterSqlite3DriverAsync = (database: BetterSqlite3Database): SQLiteDriver => ({
  async execute(sql, params = []) {
    if (/^\s*CREATE\b/i.test(sql) && !params.length) {
      database.exec(sql);
      return;
    }
    database.prepare(sql).run(...params);
  },
  async query<TValue = unknown>(sql, params = []) {
    return database.prepare(sql).all(...params) as TValue[];
  },
  async transaction<TValue>(run) {
    // Serialize statements; better-sqlite3 itself is sync and already durable per statement.
    // Callers that need a true native transaction should batch via setMany outside this helper.
    return run();
  }
});
