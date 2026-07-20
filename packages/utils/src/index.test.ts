import { describe, expect, it, vi } from "vitest";
import {
  applyQuery,
  assertStorageAdapter,
  assertSyncTransport,
  backoffDelay,
  clone,
  countQuery,
  createId,
  delay,
  findMatchingIndex,
  getEqualityFilterLookups,
  isBrowser,
  normalizeError,
  serializeCompoundIndexValue,
  toQueryString
} from "./index";

describe("utils", () => {
  it("generates ids, clones values, normalizes errors, delays, and detects browser state", async () => {
    const id = createId();

    expect(id).toEqual(expect.any(String));
    expect(clone({ nested: true })).toEqual({ nested: true });
    expect(normalizeError("bad").message).toBe("bad");
    expect(isBrowser()).toBe(false);
    await expect(delay(0)).resolves.toBeUndefined();
  });

  it("serializes query strings and computes backoff", () => {
    expect(toQueryString({ active: true, page: 2, skip: undefined })).toBe("?active=true&page=2");
    expect(backoffDelay(3, { baseDelayMs: 10, factor: 2, jitter: false, maxDelayMs: 100 })).toBe(
      40
    );

    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(backoffDelay(1, { baseDelayMs: 10, factor: 2, jitter: true, maxDelayMs: 100 })).toBe(5);
    random.mockRestore();
  });

  it("filters, sorts, searches, paginates, and counts records", () => {
    const records = [
      { id: "1", age: 30, name: "Ada", tags: "math" },
      { id: "2", age: 20, name: "Grace", tags: "code" },
      { id: "3", age: 40, name: "Alan", tags: "math" }
    ];

    expect(
      applyQuery(records, {
        filters: { age: { gt: 20, lte: 40 }, tags: { contains: "ma" } },
        limit: 1,
        offset: 1,
        orderBy: "age",
        search: "a",
        sort: "desc"
      })
    ).toEqual([{ id: "1", age: 30, name: "Ada", tags: "math" }]);
    expect(countQuery(records, { filters: { age: { in: [20, 40] } } })).toBe(2);
    expect(countQuery(records, { filters: { age: { ne: 20, gte: 30, lt: 40 } } })).toBe(1);
    expect(countQuery(records, { filters: { name: ["Ada"] } })).toBe(1);
  });

  it("asserts storage adapters and sync transports", () => {
    expect(() =>
      assertStorageAdapter({
        name: "",
        clear: async () => {},
        delete: async () => {},
        find: async () => [],
        get: async () => null,
        set: async () => {},
        transaction: async (_scope, run) => run({} as never)
      })
    ).toThrow("stable name");
    expect(() => assertSyncTransport({ request: undefined as never })).toThrow("request");
  });

  it("matches equality filters to the most specific secondary index", () => {
    expect(getEqualityFilterLookups({ email: "a", age: { eq: 30 } })).toEqual([
      { field: "email", value: "a" },
      { field: "age", value: 30 }
    ]);
    expect(serializeCompoundIndexValue(["a", 30])).toBe(JSON.stringify(["a", 30]));

    const match = findMatchingIndex(
      [
        { collection: "users", fields: ["email"], name: "by_email" },
        { collection: "users", fields: ["email", "age"], name: "by_email_age" }
      ],
      [
        { field: "email", value: "a" },
        { field: "age", value: 30 }
      ]
    );

    expect(match?.index.name).toBe("by_email_age");
    expect(match?.values).toEqual(["a", 30]);
  });
});
