import { describe, expect, it } from "vitest";
import {
  ConflictStrategyName,
  createOfflineDB,
  createIndexedDBStorage,
  createMemoryStorage,
  OfflineStorage,
  resolveStorage
} from "./index";

describe("@offlinejs umbrella package", () => {
  it("creates a database with OfflineStorage.Memory", async () => {
    const db = createOfflineDB({
      storage: OfflineStorage.Memory,
      sync: { enabled: false, conflictStrategy: ConflictStrategyName.LastWriteWins }
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

  it("resolves adapters, enums, and legacy string presets", () => {
    const memory = createMemoryStorage({ name: "custom-memory" });

    expect(resolveStorage(memory).name).toBe("custom-memory");
    expect(resolveStorage(OfflineStorage.Memory).name).toBe("memory");
    expect(resolveStorage(OfflineStorage.IndexedDB).name).toBe("indexeddb");
    expect(resolveStorage(OfflineStorage.OPFS).name).toBe("opfs");
    expect(resolveStorage("memory").name).toBe("memory");
    expect(createIndexedDBStorage({ databaseName: "demo" }).name).toBe("indexeddb");
    expect(ConflictStrategyName.LastWriteWins).toBe("lastWriteWins");
  });
});
