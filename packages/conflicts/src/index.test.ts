import { describe, expect, it } from "vitest";
import {
  createFieldMergeResolver,
  mergeLastWriteWinsRegister,
  mergePositiveNegativeCounter,
  mergeSetUnion
} from "./index";

describe("conflict helpers", () => {
  it("merges fields with policy strategies", async () => {
    const resolver = createFieldMergeResolver({
      score: "max",
      tags: "setUnion"
    });

    const resolved = await resolver({
      client: { id: "1", score: 2, tags: ["local"] },
      collection: "users",
      mutation: {
        id: "m1",
        collection: "users",
        createdAt: 1,
        operation: "update",
        priority: 0,
        recordId: "1",
        retries: 0,
        status: "pending"
      },
      server: { id: "1", score: 5, tags: ["remote"] }
    });

    expect(resolved).toMatchObject({ id: "1", score: 5, tags: ["remote", "local"] });
  });

  it("supports CRDT-style counters and set union", () => {
    expect(
      mergePositiveNegativeCounter({ decrement: 1, increment: 4 }, { decrement: 2, increment: 3 })
    ).toEqual({
      decrement: 2,
      increment: 4,
      value: 2
    });
    expect(mergeSetUnion(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(
      mergeLastWriteWinsRegister(
        { timestamp: 1, value: "client" },
        { timestamp: 2, value: "server" }
      )
    ).toBe("server");
  });

  it("supports client, server, min, and last-write field policies", async () => {
    const resolver = createFieldMergeResolver({
      local: "client",
      low: "min",
      remote: "server",
      register: "lastWriteWins"
    });

    expect(
      await resolver({
        client: {
          id: "1",
          local: "client",
          low: 2,
          register: { updatedAt: 2, value: "client" },
          remote: "client"
        },
        collection: "users",
        mutation: {
          id: "m1",
          collection: "users",
          createdAt: 1,
          operation: "update",
          priority: 0,
          recordId: "1",
          retries: 0,
          status: "pending"
        },
        server: {
          id: "1",
          local: "server",
          low: 1,
          register: { updatedAt: 1, value: "server" },
          remote: "server"
        }
      })
    ).toMatchObject({
      local: "client",
      low: 1,
      register: { updatedAt: 2, value: "client" },
      remote: "server"
    });
  });
});
