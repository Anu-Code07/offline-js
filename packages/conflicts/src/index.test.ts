import { describe, expect, it } from "vitest";
import {
  createFieldMergeResolver,
  mergeGrowOnlyCounter,
  mergeLastWriteWinsRegister,
  mergeOrMap,
  mergePositiveNegativeCounter,
  mergeSetUnion,
  mergeWithTombstones
} from "./index";

describe("conflict helpers", () => {
  it("merges fields with policy strategies", async () => {
    const resolver = createFieldMergeResolver({
      score: "max",
      tags: "setUnion",
      visits: "growOnly"
    });

    const resolved = await resolver({
      client: { id: "1", score: 2, tags: ["local"], visits: 3 },
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
      server: { id: "1", score: 5, tags: ["remote"], visits: 4 }
    });

    expect(resolved).toMatchObject({
      id: "1",
      score: 5,
      tags: ["remote", "local"],
      visits: 4
    });
  });

  it("supports CRDT-style counters and set union", () => {
    expect(mergeGrowOnlyCounter(2, 5)).toBe(5);
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
      register: "lastWriteWins",
      stamped: "lastWriteWins"
    });

    expect(
      await resolver({
        client: {
          id: "1",
          local: "client",
          low: 2,
          register: { updatedAt: 2, value: "client" },
          remote: "client",
          stamped: { timestamp: 3, value: "client" },
          updatedAt: 10
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
          remote: "server",
          stamped: { timestamp: 1, value: "server" },
          updatedAt: 1
        }
      })
    ).toMatchObject({
      local: "client",
      low: 1,
      register: { updatedAt: 2, value: "client" },
      remote: "server",
      stamped: "client"
    });
  });

  it("merges OR-maps and tombstoned collections", () => {
    expect(
      mergeOrMap(
        { a: { timestamp: 2, value: "client" }, b: "only-client" },
        { a: { timestamp: 1, value: "server" }, c: "only-server" }
      )
    ).toEqual({
      a: "client",
      b: "only-client",
      c: "only-server"
    });

    expect(
      mergeWithTombstones(
        [
          { id: "1", value: "new", updatedAt: 2 },
          { id: "2", deleted: true, value: "gone", updatedAt: 3 }
        ],
        [
          { id: "1", value: "old", updatedAt: 1 },
          { id: "2", value: "alive", updatedAt: 1 }
        ]
      )
    ).toEqual([{ id: "1", value: "new", updatedAt: 2 }]);
  });

  it("returns the non-null side when one conflict record is missing", async () => {
    const resolver = createFieldMergeResolver({});

    expect(
      await resolver({
        client: null,
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
        server: { id: "1", name: "Server" }
      })
    ).toEqual({ id: "1", name: "Server" });

    expect(
      await resolver({
        client: { id: "1", name: "Client" },
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
        server: null
      })
    ).toEqual({ id: "1", name: "Client" });
  });
});
