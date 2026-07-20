import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "./index";

describe("MemoryStorageAdapter", () => {
  it("filters, searches, sorts, and paginates records", async () => {
    const storage = createMemoryStorage({
      seed: {
        users: [
          { id: "1", age: 31, name: "Ada" },
          { id: "2", age: 25, name: "Grace" },
          { id: "3", age: 44, name: "Alan" }
        ]
      }
    });

    const records = await storage.find("users", {
      filters: { age: { gte: 30 } },
      limit: 1,
      orderBy: "name",
      search: "a",
      sort: "desc"
    });

    expect(records).toEqual([{ id: "3", age: 44, name: "Alan" }]);
  });

  it("rolls back failed transactions", async () => {
    const storage = createMemoryStorage();
    await storage.set("users", { id: "1", name: "Ada" });

    await expect(
      storage.transaction(["users"], async (store) => {
        await store.set("users", { id: "2", name: "Grace" });
        throw new Error("fail");
      })
    ).rejects.toThrow("fail");

    await expect(storage.find("users")).resolves.toEqual([{ id: "1", name: "Ada" }]);
  });

  it("accelerates equality filters through secondary indexes", async () => {
    const storage = createMemoryStorage();
    await storage.set("users", { id: "1", email: "ada@example.com", name: "Ada" });
    await storage.set("users", { id: "2", email: "grace@example.com", name: "Grace" });
    await storage.createIndex({
      collection: "users",
      fields: ["email"],
      name: "users_email",
      unique: true
    });

    await expect(
      storage.find("users", { filters: { email: "grace@example.com" } })
    ).resolves.toEqual([{ id: "2", email: "grace@example.com", name: "Grace" }]);
    await expect(
      storage.set("users", { id: "3", email: "ada@example.com", name: "Duplicate" })
    ).rejects.toThrow(/Unique index/);
  });

  it("stores secondary index metadata", async () => {
    const storage = createMemoryStorage();

    await storage.createIndex({
      collection: "users",
      fields: ["email"],
      name: "users_email",
      unique: true
    });

    await expect(storage.listIndexes("users")).resolves.toEqual([
      {
        collection: "users",
        fields: ["email"],
        name: "users_email",
        unique: true
      }
    ]);

    await storage.dropIndex("users", "users_email");

    await expect(storage.listIndexes("users")).resolves.toEqual([]);
  });

  it("lists all indexes, skips applied migrations, and clears all records", async () => {
    const storage = createMemoryStorage();
    let migrationRuns = 0;

    await storage.set("users", { id: "1", name: "Ada" });
    await storage.createIndex({ collection: "users", fields: ["email"], name: "users_email" });
    await storage.createIndex({
      collection: "projects",
      fields: ["title"],
      name: "projects_title"
    });
    await storage.migrate([
      {
        name: "once",
        up: async () => {
          migrationRuns += 1;
        }
      }
    ]);
    await storage.migrate([
      {
        name: "once",
        up: async () => {
          migrationRuns += 1;
        }
      }
    ]);

    await expect(storage.listIndexes()).resolves.toHaveLength(2);
    expect(migrationRuns).toBe(1);
    await storage.clear();
    await expect(storage.find("users")).resolves.toEqual([]);
    await expect(storage.listIndexes()).resolves.toEqual([]);
  });
});
