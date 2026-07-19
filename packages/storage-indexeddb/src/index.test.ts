import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createIndexedDBStorage } from "./index";

describe("IndexedDBStorageAdapter", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "indexedDB");
  });

  it("stores, queries, deletes, indexes, and migrates records", async () => {
    const storage = createIndexedDBStorage({ databaseName: `test-${Date.now()}` });

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
    await storage.clear("users");
    await expect(storage.find("users")).resolves.toEqual([]);
    await storage.clear();
  });

  it("throws when IndexedDB is unavailable", async () => {
    Reflect.deleteProperty(globalThis, "indexedDB");

    await expect(createIndexedDBStorage().find("users")).rejects.toThrow(
      "IndexedDB is not available"
    );
  });
});
