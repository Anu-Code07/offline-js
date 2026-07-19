import { describe, expect, it, vi } from "vitest";
import { BrowserNetworkMonitor } from "@offlinejs/network";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import type { SyncTransport, TransportRequest, TransportResponse } from "@offlinejs/types";
import { createOfflineDB, ValidationError } from "./index";

type TestData = {
  users: {
    id: string;
    age?: number;
    createdAt?: number;
    name: string;
    updatedAt?: number;
  };
};

class TestTransport implements SyncTransport {
  readonly requests: Array<TransportRequest> = [];

  async request<TData = unknown, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TransportResponse<TData>> {
    this.requests.push(request);

    return {
      data: {
        id:
          typeof request.body === "object" && request.body && "id" in request.body
            ? request.body.id
            : "remote",
        ...(typeof request.body === "object" ? request.body : {})
      } as TData,
      status: 200
    };
  }
}

describe("createOfflineDB", () => {
  it("creates optimistic local records and queues sync", async () => {
    const transport = new TestTransport();
    const network = new BrowserNetworkMonitor({ initialOnline: false });
    const db = createOfflineDB<TestData>({
      network,
      storage: createMemoryStorage(),
      sync: { autoStart: false },
      transport
    });
    const users = db.collection("users");
    const record = await users.create({ name: "Ada" });

    await expect(users.findOne(record.id)).resolves.toMatchObject({ name: "Ada" });
    expect(transport.requests).toHaveLength(0);

    network.setOnline(true);
    await users.sync();

    expect(transport.requests).toEqual([
      expect.objectContaining({ method: "POST", path: "/users" }),
      expect.objectContaining({ method: "GET", path: "/users" })
    ]);

    await db.destroy();
  });

  it("notifies subscribers after local writes", async () => {
    const db = createOfflineDB<TestData>({
      storage: createMemoryStorage(),
      sync: { enabled: false }
    });
    const users = db.collection("users");
    const subscriber = vi.fn();

    const unsubscribe = users.subscribe(subscriber);
    await users.create({ name: "Grace" });

    expect(subscriber).toHaveBeenLastCalledWith([expect.objectContaining({ name: "Grace" })]);

    unsubscribe();
    await db.destroy();
  });

  it("rejects updates for missing records", async () => {
    const db = createOfflineDB<TestData>({
      storage: createMemoryStorage(),
      sync: { enabled: false }
    });

    await expect(db.collection("users").update("missing", { age: 1 })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it("supports pagination, delete, transactions, events, and plugin cleanup", async () => {
    const dispose = vi.fn();
    const pluginSetup = vi.fn(async () => dispose);
    const db = createOfflineDB<TestData>({
      plugins: [{ name: "async-plugin", setup: pluginSetup }],
      storage: createMemoryStorage(),
      sync: { enabled: false }
    });
    const errorListener = vi.fn();
    const off = db.on("error", errorListener);
    const users = db.collection("users");

    await users.create({ age: 30, name: "Ada" });
    await users.create({ age: 20, name: "Grace" });

    await expect(users.paginate({ limit: 1, orderBy: "age" })).resolves.toMatchObject({
      data: [expect.objectContaining({ name: "Grace" })],
      limit: 1,
      offset: 0,
      total: 2
    });

    await db.transaction(async (transactionDb) => {
      await transactionDb.collection<TestData["users"]>("users").create({ name: "Linus" });
      return "ok";
    });
    await expect(users.find({ search: "linus" })).resolves.toHaveLength(1);

    const grace = (await users.find({ search: "grace" }))[0];
    expect(grace).toBeDefined();
    if (!grace) {
      throw new Error("Expected Grace record");
    }
    await users.delete(grace.id);
    await expect(users.find({ search: "grace" })).resolves.toEqual([]);

    db.emit("error", new Error("manual"));
    expect(errorListener).toHaveBeenCalledWith(expect.any(Error));
    off();
    db.emit("error", new Error("ignored"));
    expect(errorListener).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await db.destroy();
    expect(dispose).toHaveBeenCalled();
  });

  it("rejects invalid storage and transport contracts", () => {
    expect(() =>
      createOfflineDB({
        storage: {
          name: "bad",
          contractVersion: 999 as never,
          clear: async () => {},
          delete: async () => {},
          find: async () => [],
          get: async () => null,
          set: async () => {},
          transaction: async (_scope, run) => run({} as never)
        }
      })
    ).toThrow("Unsupported storage adapter contract");

    expect(() =>
      createOfflineDB({
        storage: createMemoryStorage(),
        transport: {
          contractVersion: 999 as never,
          request: async <TData = unknown>() => ({ data: null as TData, status: 200 })
        }
      })
    ).toThrow("Unsupported sync transport contract");
  });
});
