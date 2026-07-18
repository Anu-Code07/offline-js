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
});
