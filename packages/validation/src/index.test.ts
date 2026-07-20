import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import type { EventBus, IndexableStorageAdapter, OfflineEvents } from "@offlinejs/types";
import {
  assertValid,
  composeValidators,
  createRequiredFieldsValidator,
  createTypeValidator,
  createValidatedStorage,
  OfflineValidationError,
  validationPlugin
} from "./index";

describe("validation", () => {
  it("rejects invalid records in validated storage", async () => {
    const storage = createValidatedStorage(createMemoryStorage(), {
      users: createRequiredFieldsValidator(["name"])
    });

    await expect(storage.set("users", { id: "1" })).rejects.toBeInstanceOf(OfflineValidationError);
  });

  it("allows valid records", async () => {
    const storage = createValidatedStorage(createMemoryStorage(), {
      users: createRequiredFieldsValidator(["name"])
    });

    await storage.set("users", { id: "1", name: "Ada" });

    await expect(storage.get("users", "1")).resolves.toEqual({ id: "1", name: "Ada" });
  });

  it("composes validators and forwards index APIs", async () => {
    const memory = createMemoryStorage();
    const storage: IndexableStorageAdapter = createValidatedStorage(memory, {
      users: composeValidators(
        createRequiredFieldsValidator(["name"]),
        createTypeValidator({ age: "number" })
      )
    });

    await expect(storage.set("users", { id: "1", name: "Ada", age: "x" })).rejects.toThrow(
      /type number/
    );
    await storage.createIndex!({
      collection: "users",
      fields: ["name"],
      name: "users_name"
    });
    await expect(storage.listIndexes!("users")).resolves.toEqual([
      { collection: "users", fields: ["name"], name: "users_name" }
    ]);
  });

  it("validates writes inside transactions", async () => {
    const storage = createValidatedStorage(createMemoryStorage(), {
      users: createRequiredFieldsValidator(["name"])
    });

    await expect(
      storage.transaction(["users"], async (store) => {
        await store.set("users", { id: "1" });
      })
    ).rejects.toBeInstanceOf(OfflineValidationError);
  });

  it("delegates reads, deletes, clears, transactions, and migrations", async () => {
    const storage = createValidatedStorage(createMemoryStorage(), {});

    await storage.set("users", { id: "1", name: "Ada" });
    await expect(storage.find("users")).resolves.toEqual([{ id: "1", name: "Ada" }]);
    await storage.transaction(["users"], async (store) => {
      await store.set("users", { id: "2", name: "Grace" });
    });
    await expect(storage.get("users", "2")).resolves.toEqual({ id: "2", name: "Grace" });
    await storage.delete("users", "1");
    await expect(storage.get("users", "1")).resolves.toBeNull();
    await storage.migrate?.([
      {
        name: "seed",
        up: (store) => store.set("users", { id: "3", name: "Linus" })
      }
    ]);
    await expect(storage.get("users", "3")).resolves.toMatchObject({ name: "Linus" });
    await storage.clear("users");
    await expect(storage.find("users")).resolves.toEqual([]);
  });

  it("validates queued mutations through the plugin", async () => {
    const emit = vi.fn();
    let listener: ((mutation: OfflineEvents["queue:add"]) => void | Promise<void>) | undefined;
    const plugin = validationPlugin({
      users: createRequiredFieldsValidator(["name"])
    });

    plugin.setup({
      db: undefined as never,
      events: {
        emit,
        on(
          _name: keyof OfflineEvents,
          callback: (payload: OfflineEvents[keyof OfflineEvents]) => void
        ) {
          listener = callback as typeof listener;
          return vi.fn();
        }
      } as unknown as EventBus<OfflineEvents>,
      network: undefined as never,
      storage: undefined as never
    });

    await listener?.({
      id: "m1",
      collection: "projects",
      createdAt: 1,
      operation: "create",
      priority: 0,
      recordId: "1",
      retries: 0,
      status: "pending"
    });
    await listener?.({
      id: "m2",
      collection: "users",
      createdAt: 1,
      operation: "create",
      payload: {},
      priority: 0,
      recordId: "2",
      retries: 0,
      status: "pending"
    });

    expect(emit).toHaveBeenCalledWith("error", expect.any(OfflineValidationError));
    await expect(assertValid(undefined, { id: "1" }, "users")).resolves.toEqual({
      issues: [],
      valid: true
    });
  });
});
