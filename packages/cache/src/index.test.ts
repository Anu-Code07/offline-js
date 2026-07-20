import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCacheKey,
  cachedFetch,
  cachedJson,
  clearHttpCache,
  createIndexedDBHttpCache,
  createMemoryHttpCache,
  invalidateCacheKey
} from "./index";

describe("@offlinejs/cache", () => {
  afterEach(async () => {
    await clearHttpCache();
    vi.restoreAllMocks();
  });

  it("buildCacheKey includes method and url", () => {
    expect(buildCacheKey("https://api.example.com/items", { method: "GET" })).toBe(
      "GET https://api.example.com/items"
    );
  });

  it("cachedJson returns network data then serves fresh cache", async () => {
    const store = createMemoryHttpCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    const first = await cachedJson<{ ok: number }>("https://api.example.com/x", undefined, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000
    });
    expect(first.data.ok).toBe(1);
    expect(first.fromCache).toBe(false);

    const second = await cachedJson<{ ok: number }>("https://api.example.com/x", undefined, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000
    });
    expect(second.data.ok).toBe(1);
    expect(second.fromCache).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serves stale while revalidating", async () => {
    const store = createMemoryHttpCache();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ n: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ n: 2 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );

    await cachedJson("https://api.example.com/stale", undefined, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      ttlMs: 1,
      staleWhileRevalidateMs: 60_000
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const stale = await cachedJson<{ n: number }>("https://api.example.com/stale", undefined, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      ttlMs: 1,
      staleWhileRevalidateMs: 60_000
    });

    expect(stale.fromCache).toBe(true);
    expect(stale.stale).toBe(true);
    expect(stale.data.n).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const refreshed = await cachedJson<{ n: number }>("https://api.example.com/stale", undefined, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      ttlMs: 60_000,
      staleWhileRevalidateMs: 0
    });
    expect(refreshed.data.n).toBe(2);
  });

  it("persists entries in IndexedDB store", async () => {
    const store = createIndexedDBHttpCache({ databaseName: "offlinejs-cache-test" });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "a" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    await cachedFetch("https://api.example.com/idb", undefined, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      json: true,
      ttlMs: 60_000
    });

    const hit = await cachedFetch("https://api.example.com/idb", undefined, {
      store,
      fetch: fetchImpl as unknown as typeof fetch,
      json: true,
      ttlMs: 60_000
    });

    expect(hit.fromCache).toBe(true);
    expect(hit.data).toEqual({ id: "a" });
    await invalidateCacheKey("GET https://api.example.com/idb", store);
  });
});
