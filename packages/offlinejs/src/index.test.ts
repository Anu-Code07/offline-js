import { describe, expect, it } from "vitest";
import {
  createOfflineDB,
  createIndexedDBStorage,
  createMemoryStorage,
  resolveStorage
} from "./index";

describe("@offlinejs umbrella package", () => {
  it("creates a database with a memory storage preset", async () => {
    const db = createOfflineDB({
      storage: "memory",
      sync: { enabled: false }
    });

    const todos = db.collection("todos");
    const created = await todos.create({ title: "One import", completed: false });

    expect(created.title).toBe("One import");
    expect(await todos.find()).toHaveLength(1);
  });

  it("defaults to memory storage outside the browser", async () => {
    const db = createOfflineDB({ sync: { enabled: false } });
    await db.collection("notes").create({ title: "auto storage" });
    expect(await db.collection("notes").find()).toHaveLength(1);
  });

  it("resolves explicit adapters and presets", () => {
    const memory = createMemoryStorage({ name: "custom-memory" });

    expect(resolveStorage(memory).name).toBe("custom-memory");
    expect(resolveStorage("memory").name).toBe("memory");
    expect(resolveStorage("indexeddb").name).toBe("indexeddb");
    expect(resolveStorage("opfs").name).toBe("opfs");
    expect(createIndexedDBStorage({ databaseName: "demo" }).name).toBe("indexeddb");
  });
});
