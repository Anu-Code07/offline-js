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
      transport
    });
    const users = db.collection("users");
    const record = await users.create({ name: "Ada" });

    await expect(users.findOne(record.id)).resolves.toMatchObject({ name: "Ada" });
    expect(transport.requests).toHaveLength(0);

    network.setOnline(true);
    await users.sync();

    expect(transport.requests).toEqual([
      expect.objectContaining({ method: "POST", path: "/users" })
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

    expect(subscriber).toHaveBeenLastCalledWith([
      expect.objectContaining({ name: "Grace" })
    ]);

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
});
