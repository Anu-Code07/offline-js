import { describe, expect, it } from "vitest";
import { createOPFSStorage } from "./index";

class FakeFileHandle {
  constructor(private content = "") {}

  async createWritable() {
    return {
      close: async () => {},
      write: async (value: string) => {
        this.content = value;
      }
    };
  }

  async getFile() {
    return {
      text: async () => this.content
    };
  }
}

class FakeDirectoryHandle {
  directories = new Map<string, FakeDirectoryHandle>();
  files = new Map<string, FakeFileHandle>();

  async getDirectoryHandle(name: string) {
    const directory = this.directories.get(name) ?? new FakeDirectoryHandle();
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string) {
    const file = this.files.get(name) ?? new FakeFileHandle();
    this.files.set(name, file);
    return file;
  }

  async removeEntry(name: string) {
    this.files.delete(name);
    this.directories.delete(name);
  }
}

describe("OPFSStorageAdapter", () => {
  it("stores, finds, deletes, migrates, and tracks indexes", async () => {
    const storage = createOPFSStorage({ directory: new FakeDirectoryHandle() });

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
    await expect(storage.listIndexes()).resolves.toEqual([]);
    await storage.clear("users");
    await expect(storage.find("users")).resolves.toEqual([]);
    await storage.clear();
  });

  it("throws when OPFS is unavailable", async () => {
    await expect(createOPFSStorage().set("users", { id: "1" })).rejects.toThrow(
      "OPFS is not available"
    );
  });

  it("accelerates equality filters and lists indexes across collections", async () => {
    const storage = createOPFSStorage({
      directory: new FakeDirectoryHandle(),
      rootDirectoryName: "offlinejs-root"
    });
    await storage.set("users", { id: "1", name: "Ada" });
    await storage.set("users", { id: "2", name: "Grace" });
    await storage.createIndex({
      collection: "users",
      fields: ["name"],
      name: "users_name",
      unique: true
    });

    await expect(storage.find("users", { filters: { name: "Grace" } })).resolves.toEqual([
      { id: "2", name: "Grace" }
    ]);
    await expect(storage.listIndexes()).resolves.toEqual([
      { collection: "users", fields: ["name"], name: "users_name", unique: true }
    ]);
    await expect(
      storage.set("users", { id: "3", name: "Ada" })
    ).rejects.toThrow(/Unique index/);
  });
});
