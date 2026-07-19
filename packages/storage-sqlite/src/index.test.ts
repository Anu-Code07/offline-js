import { describe, expect, it } from "vitest";
import { createSQLiteStorage, type SQLiteDriver } from "./index";

const createDriver = (withTransaction = true): SQLiteDriver => {
  const records = new Map<string, string>();
  const indexes = new Map<string, string>();

  return {
    async execute(sql, params = []) {
      if (sql.startsWith("INSERT OR REPLACE INTO") && sql.includes("_indexes")) {
        indexes.set(`${params[0]}:${params[1]}`, String(params[2]));
        return;
      }

      if (sql.startsWith("INSERT OR REPLACE INTO")) {
        records.set(`${params[0]}:${params[1]}`, String(params[2]));
        return;
      }

      if (sql.includes("_indexes") && sql.startsWith("DELETE") && params.length === 2) {
        indexes.delete(`${params[0]}:${params[1]}`);
        return;
      }

      if (sql.startsWith("DELETE") && params.length === 2) {
        records.delete(`${params[0]}:${params[1]}`);
        return;
      }

      if (sql.includes("_indexes") && sql.startsWith("DELETE") && params.length === 1) {
        for (const key of indexes.keys()) {
          if (key.startsWith(`${params[0]}:`)) {
            indexes.delete(key);
          }
        }
        return;
      }

      if (sql.startsWith("DELETE") && params.length === 1) {
        for (const key of records.keys()) {
          if (key.startsWith(`${params[0]}:`)) {
            records.delete(key);
          }
        }
        return;
      }

      if (sql.includes("_indexes") && sql.startsWith("DELETE")) {
        indexes.clear();
        return;
      }

      if (sql.startsWith("DELETE")) {
        records.clear();
      }
    },
    async query(sql, params = []) {
      if (sql.includes("_indexes")) {
        return [...indexes.entries()]
          .filter(([key]) => params.length === 0 || key.startsWith(`${params[0]}:`))
          .map(([, value]) => ({ value })) as never[];
      }

      if (sql.includes("LIMIT 1")) {
        const value = records.get(`${params[0]}:${params[1]}`);
        return value ? ([{ value }] as never[]) : [];
      }

      return [...records.entries()]
        .filter(([key]) => key.startsWith(`${params[0]}:`))
        .map(([, value]) => ({ value })) as never[];
    },
    ...(withTransaction ? { transaction: (run) => run() } : {})
  };
};

describe("SQLiteStorageAdapter", () => {
  it("stores, queries, deletes, indexes, and migrates records", async () => {
    const storage = createSQLiteStorage({ driver: createDriver() });

    await storage.set("users", { id: "1", name: "Ada" });
    await storage.set("users", { id: "2", name: "Grace" });

    await expect(storage.get("users", "1")).resolves.toEqual({ id: "1", name: "Ada" });
    await expect(storage.find("users", { search: "grace" })).resolves.toEqual([
      { id: "2", name: "Grace" }
    ]);

    await storage.createIndex({ collection: "users", fields: ["name"], name: "users_name" });
    await expect(storage.listIndexes("users")).resolves.toEqual([
      { collection: "users", fields: ["name"], name: "users_name" }
    ]);
    await storage.dropIndex("users", "users_name");
    await expect(storage.listIndexes("users")).resolves.toEqual([]);

    await storage.migrate([
      {
        name: "seed",
        up: (store) => store.set("users", { id: "3", name: "Linus" })
      }
    ]);
    await expect(storage.get("users", "3")).resolves.toMatchObject({ name: "Linus" });

    await storage.delete("users", "1");
    await expect(storage.get("users", "1")).resolves.toBeNull();
  });

  it("supports fallback transactions, clear all, listing all indexes, and skipped migrations", async () => {
    const storage = createSQLiteStorage({ driver: createDriver(false) });
    let migrationRuns = 0;

    await storage.transaction(["users"], async (store) => {
      await store.set("users", { id: "1", name: "Ada" });
    });
    await storage.createIndex({ collection: "users", fields: ["name"], name: "users_name" });
    await storage.createIndex({
      collection: "projects",
      fields: ["title"],
      name: "projects_title"
    });

    await expect(storage.listIndexes()).resolves.toHaveLength(2);
    await storage.clear("projects");
    await expect(storage.listIndexes()).resolves.toEqual([
      { collection: "users", fields: ["name"], name: "users_name" }
    ]);

    const migration = {
      name: "once",
      up: async () => {
        migrationRuns += 1;
      }
    };
    await storage.migrate([migration]);
    await storage.migrate([migration]);
    expect(migrationRuns).toBe(1);

    await storage.clear();
    await expect(storage.find("users")).resolves.toEqual([]);
    await expect(storage.listIndexes()).resolves.toEqual([]);
  });
});
