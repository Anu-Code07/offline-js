import { describe, expect, it, vi } from "vitest";
import { createMutationQueue } from "@offlinejs/queue";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import type { EventBus, OfflineEvents, SyncTransport, TransportRequest } from "@offlinejs/types";
import { createSyncEngine, resolveConflictStrategy } from "./index";

describe("resolveConflictStrategy", () => {
  const mutation = {
    id: "m1",
    collection: "users",
    createdAt: 1,
    operation: "update" as const,
    priority: 0,
    recordId: "1",
    retries: 0,
    status: "pending" as const
  };

  it("supports merge conflicts", async () => {
    const resolved = await resolveConflictStrategy("merge", {
      client: { id: "1", local: true, name: "Ada" },
      collection: "users",
      mutation,
      server: { id: "1", name: "Grace", remote: true }
    });

    expect(resolved).toEqual({ id: "1", local: true, name: "Ada", remote: true });
  });

  it("supports client, server, last-write, and custom conflict strategies", async () => {
    const context = {
      client: { id: "1", updatedAt: 2, name: "client" },
      collection: "users",
      mutation,
      server: { id: "1", updatedAt: 1, name: "server" }
    };

    await expect(resolveConflictStrategy("clientWins", context)).resolves.toBe(context.client);
    await expect(resolveConflictStrategy("serverWins", context)).resolves.toBe(context.server);
    await expect(resolveConflictStrategy("lastWriteWins", context)).resolves.toBe(context.client);
    await expect(resolveConflictStrategy(() => null, context)).resolves.toBeNull();
  });
});

describe("SyncEngine", () => {
  const createEvents = () =>
    ({
      emit: vi.fn(),
      off: vi.fn(),
      on: vi.fn()
    }) as unknown as EventBus<OfflineEvents> & { emit: ReturnType<typeof vi.fn> };

  it("pushes queued mutations, pulls collection records, and removes completed queue items", async () => {
    const storage = createMemoryStorage();
    const queue = createMutationQueue({ storage });
    const events = createEvents();
    const requests: TransportRequest[] = [];
    const transport: SyncTransport = {
      async request<TData = unknown>(request: TransportRequest) {
        requests.push(request);
        if (request.method === "GET") {
          return { data: [{ id: "remote", name: "Remote" }] as TData, status: 200 };
        }
        return { data: { id: "1", name: "Ada Remote" } as TData, status: 200 };
      }
    };

    await queue.add({
      collection: "users",
      operation: "create",
      payload: { id: "1", name: "Ada" },
      recordId: "1"
    });

    const result = await createSyncEngine({ events, queue, storage, transport }).sync("users");

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    await expect(queue.all()).resolves.toEqual([]);
    await expect(storage.get("users", "remote")).resolves.toEqual({ id: "remote", name: "Remote" });
  });

  it("marks failed mutations and supports disabled/no-transport sync", async () => {
    const storage = createMemoryStorage();
    const queue = createMutationQueue({ storage });
    const events = createEvents();
    const transport: SyncTransport = {
      async request() {
        throw new Error("network");
      }
    };

    await queue.add({
      collection: "users",
      operation: "delete",
      recordId: "1"
    });

    await expect(
      createSyncEngine({ events, queue, storage, sync: { pull: false }, transport }).sync("users")
    ).resolves.toEqual({
      completed: 0,
      failed: 1
    });
    expect((await queue.all())[0]).toMatchObject({ retries: 1, status: "failed" });
    await expect(
      createSyncEngine({ events, queue, storage, sync: { enabled: false } }).sync()
    ).resolves.toEqual({
      completed: 0,
      failed: 0
    });
  });

  it("resolves conflict errors and updates server with resolved records", async () => {
    const storage = createMemoryStorage();
    const queue = createMutationQueue({ storage });
    const events = createEvents();
    const requests: TransportRequest[] = [];
    const transport: SyncTransport = {
      async request<TData = unknown>(request: TransportRequest) {
        requests.push(request);
        if (request.method === "PATCH") {
          const error = new Error("conflict");
          Object.assign(error, { data: { id: "1", name: "Server" }, status: 409 });
          throw error;
        }
        return { data: null as TData, status: 200 };
      }
    };

    await storage.set("users", { id: "1", name: "Client" });
    await queue.add({
      collection: "users",
      operation: "update",
      payload: { name: "Client" },
      recordId: "1"
    });

    await expect(
      createSyncEngine({
        events,
        queue,
        storage,
        sync: { conflictStrategy: "clientWins", pull: false },
        transport
      }).sync("users")
    ).resolves.toEqual({ completed: 1, failed: 0 });
    expect(requests.map((request) => request.method)).toEqual(["PATCH", "PUT"]);
    expect(events.emit).toHaveBeenCalledWith("conflict", expect.any(Object));
  });
});
