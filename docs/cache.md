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
## Quick start

```ts
import { cachedJson, createIndexedDBHttpCache } from "@offlinejs/client";

const store = createIndexedDBHttpCache({ databaseName: "my-http-cache" });

const result = await cachedJson<{ items: string[] }>("/api/items", undefined, {
  store,
  ttlMs: 60_000, // fresh for 1 minute
  staleWhileRevalidateMs: 120_000 // serve stale up to 2 more minutes while refreshing
});

console.log(result.data, result.fromCache, result.stale);
```

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
