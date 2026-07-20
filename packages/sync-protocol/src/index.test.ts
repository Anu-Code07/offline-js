import { describe, expect, it } from "vitest";
import type { EntityRecord } from "@offlinejs/types";
import {
  createPullRequest,
  createPushRequest,
  handlePull,
  handlePush,
  type SyncProtocolStore
} from "./index";

describe("sync protocol", () => {
  it("handles push and pull envelopes", async () => {
    const records = new Map<string, EntityRecord>();
    const store: SyncProtocolStore = {
      async delete(_collection, id) {
        records.delete(id);
      },
      async get(_collection, id) {
        return records.get(id) ?? null;
      },
      async list() {
        return [...records.values()];
      },
      async set(_collection, record) {
        records.set(record.id, record);
        return record;
      }
    };
    const push = createPushRequest("client_1", [
      {
        id: "mutation_1",
        collection: "users",
        operation: "create",
        payload: { name: "Ada" },
        recordId: "1"
      }
    ]);

    await expect(handlePush(store, push)).resolves.toMatchObject({
      accepted: ["mutation_1"],
      rejected: []
    });
    await expect(handlePull(store, createPullRequest("client_1", "users"))).resolves.toEqual({
      cursor: "1",
      records: [{ id: "1", name: "Ada" }]
    });
  });

  it("reports create conflicts when the server record already exists", async () => {
    const records = new Map<string, EntityRecord>([["1", { id: "1", name: "Server", updatedAt: 5 }]]);
    const store: SyncProtocolStore = {
      async delete(_collection, id) {
        records.delete(id);
      },
      async get(_collection, id) {
        return records.get(id) ?? null;
      },
      async list() {
        return [...records.values()];
      },
      async set(_collection, record) {
        records.set(record.id, record);
        return record;
      }
    };

    const result = await handlePush(
      store,
      createPushRequest("client_1", [
        {
          id: "mutation_2",
          collection: "users",
          operation: "create",
          payload: { name: "Client" },
          recordId: "1"
        }
      ])
    );

    expect(result.accepted).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.server).toMatchObject({ name: "Server" });
  });

  it("rejects missing payloads and detects stale update versions", async () => {
    const records = new Map<string, EntityRecord>([
      ["1", { id: "1", name: "Server", updatedAt: 10 }]
    ]);
    const store: SyncProtocolStore = {
      async delete(_collection, id) {
        records.delete(id);
      },
      async get(_collection, id) {
        return records.get(id) ?? null;
      },
      async list() {
        return [...records.values()];
      },
      async set(_collection, record) {
        records.set(record.id, record);
        return record;
      }
    };

    const missing = await handlePush(
      store,
      createPushRequest("client_1", [
        {
          id: "mutation_3",
          collection: "users",
          operation: "update",
          recordId: "1"
        }
      ])
    );
    expect(missing.rejected).toEqual([{ id: "mutation_3", reason: "Missing mutation payload" }]);

    const stale = await handlePush(
      store,
      createPushRequest("client_1", [
        {
          id: "mutation_4",
          collection: "users",
          operation: "update",
          payload: { name: "Client", updatedAt: 2 },
          recordId: "1"
        }
      ])
    );
    expect(stale.conflicts).toHaveLength(1);
    expect(records.get("1")).toMatchObject({ name: "Server" });

    await handlePush(
      store,
      createPushRequest("client_1", [
        {
          id: "mutation_5",
          collection: "users",
          operation: "delete",
          recordId: "1"
        }
      ])
    );
    expect(records.has("1")).toBe(false);
  });
});
