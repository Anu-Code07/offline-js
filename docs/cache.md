# HTTP cache (`@offlinejs/http-cache`)

General-purpose **read-through** cache for GET/JSON (and optional Cache API for assets).

This is **not** the offline mutation queue. Use `createOfflineDB` when users must write offline and sync later. Use this package when you want faster / offline-*readable* HTTP responses with TTL.

## Install

Already included with [`@offlinejs/client`](https://www.npmjs.com/package/@offlinejs/client) **0.1.2+**, or install the focused package:

```bash
pnpm add @offlinejs/http-cache
# npm i @offlinejs/http-cache
```

[`@offlinejs/http-cache` on npm](https://www.npmjs.com/package/@offlinejs/http-cache)

## How to use `cachedJson`

Signature (same shape as `fetch`, plus cache options):

```ts
cachedJson<T>(url, init?, cacheOptions?) → Promise<CachedResult<T>>
```

| Argument | Type | Purpose |
| --- | --- | --- |
| `url` | `string` \| `URL` \| `Request` | What to fetch (required) |
| `init` | `RequestInit` \| `undefined` | Normal fetch options: `headers`, `method`, `signal`, etc. Pass **`undefined`** when you don’t need any. |
| `cacheOptions` | object | Cache behavior: `store`, `ttlMs`, `staleWhileRevalidateMs`, `key`, … |

### Why `undefined`?

```ts
await cachedJson("/api/items", undefined, { store, ttlMs: 60_000 });
//                         ^^^^^^^^^
//                         no fetch headers/method — just a GET
```

The second slot is reserved for fetch `init`. Cache settings go in the **third** argument. If you skip `undefined` and put the cache object second, it would be treated as fetch options (wrong).

### With auth headers

```ts
await cachedJson("/api/items", {
  headers: { Authorization: `Bearer ${token}` }
}, {
  store,
  ttlMs: 60_000
});
```

### What you get back

```ts
type CachedResult<T> = {
  data: T;           // parsed JSON body
  fromCache: boolean; // true if served from cache
  stale: boolean;     // true if TTL expired but still within SWR window
  status: number;
  headers: Record<string, string>;
  key: string;        // cache key, default "GET <url>"
};
```

## Quick start

```ts
import { cachedJson, createIndexedDBHttpCache } from "@offlinejs/client";

const store = createIndexedDBHttpCache({ databaseName: "my-http-cache" });

const result = await cachedJson<{ items: string[] }>(
  "/api/items",
  undefined, // no RequestInit — plain GET
  {
    store,
    ttlMs: 60_000, // fresh for 1 minute
    staleWhileRevalidateMs: 120_000 // serve stale up to 2 more minutes while refreshing
  }
);

console.log(result.data, result.fromCache, result.stale);
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `store` | in-memory | Where entries live (`createMemoryHttpCache`, `createIndexedDBHttpCache`, …) |
| `ttlMs` | `60_000` | Fresh window — serve from cache, no network |
| `staleWhileRevalidateMs` | `0` | Extra time after TTL to return stale data while a background refresh runs |
| `key` | `"GET <url>"` | Override cache key |
| `methods` | `GET`, `HEAD` | Only these methods are cached |
| `fetch` | `globalThis.fetch` | Inject a custom fetch (tests, polyfills) |

## Stores

| Helper | Persistence | Best for |
| --- | --- | --- |
| `createMemoryHttpCache()` | Tab memory | Tests, short-lived UI |
| `createIndexedDBHttpCache()` | IndexedDB | Durable API response cache |
| `createCacheApiStore()` | Cache API | Raw `Response` / asset caching in SW-friendly apps |

## Invalidate

```ts
import { clearHttpCache, invalidateCacheKey } from "@offlinejs/client";

await invalidateCacheKey("GET /api/items", store);
await clearHttpCache(store);
```

## With OfflineJS together

Typical pattern:

1. **Cache** catalog / reference GETs with `cachedJson` (TTL)  
2. **OfflineDB** for user-owned records that are created/updated offline and synced  

Do not put mutable outbox writes only in the HTTP cache — they need `createOfflineDB`.
