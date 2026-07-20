import { describe, expect, it } from "vitest";
import { createSQLiteStorage, type SQLiteDriver } from "./index";

const createDriver = (withTransaction = true): SQLiteDriver => {
  const records = new Map<string, string>();
  const indexes = new Map<string, string>();
  const entries = new Map<string, string>();

  return {
    async execute(sql, params = []) {
      if (sql.startsWith("CREATE")) {
        return;
      }

      if (sql.startsWith("INSERT OR REPLACE INTO") && sql.includes("_index_entries")) {
        entries.set(`${params[0]}:${params[1]}:${params[2]}:${params[3]}`, String(params[3]));
        return;
      }

      if (sql.startsWith("INSERT OR REPLACE INTO") && sql.includes("_indexes")) {
        indexes.set(`${params[0]}:${params[1]}`, String(params[2]));
        return;
      }

      if (sql.startsWith("INSERT OR REPLACE INTO")) {
        records.set(`${params[0]}:${params[1]}`, String(params[2]));
        return;
      }

      if (sql.includes("_index_entries") && sql.startsWith("DELETE")) {
        if (params.length >= 4) {
          entries.delete(`${params[0]}:${params[1]}:${params[2]}:${params[3]}`);
          return;
        }

        if (params.length === 2) {
          for (const key of [...entries.keys()]) {
            if (key.startsWith(`${params[0]}:${params[1]}:`)) {
              entries.delete(key);
            }
          }
          return;
        }

        if (params.length === 1) {
          for (const key of [...entries.keys()]) {
            if (key.startsWith(`${params[0]}:`)) {
              entries.delete(key);
            }
          }
          return;
        }

        entries.clear();
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
      if (sql.includes("_index_entries")) {
        return [...entries.keys()]
          .filter((key) => {
            const [collection, indexName, valueKey] = key.split(":");
            return (
              collection === params[0] &&
              indexName === params[1] &&
              valueKey === params[2]
            );
          })
          .map((key) => ({ record_id: key.split(":").at(-1) })) as never[];
      }

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
    await expect(storage.find("users", { filters: { name: "Grace" } })).resolves.toEqual([
      { id: "2", name: "Grace" }
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

    await storage.transaction(["users"], async (store) => {
      await store.set("users", { id: "4", name: "Barbara" });
    });

    await storage.delete("users", "1");
    await expect(storage.get("users", "1")).resolves.toBeNull();
  });

  it("lists and clears indexes across collections", async () => {
    const storage = createSQLiteStorage({ driver: createDriver(false) });

    await storage.createIndex({ collection: "users", fields: ["name"], name: "users_name" });
    await storage.createIndex({
      collection: "posts",
      fields: ["title"],
      name: "posts_title"
    });

    await expect(storage.listIndexes()).resolves.toHaveLength(2);
    await storage.clear("users");
    await expect(storage.listIndexes()).resolves.toEqual([
      { collection: "posts", fields: ["title"], name: "posts_title" }
    ]);
    await storage.clear();
    await expect(storage.find("users")).resolves.toEqual([]);
    await expect(storage.listIndexes()).resolves.toEqual([]);
  });
});
