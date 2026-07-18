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
      records: [{ id: "1", name: "Ada" }]
    });
  });
});
