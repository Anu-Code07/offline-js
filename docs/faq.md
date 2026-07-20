# FAQ

## What is OfflineJS for? (PMF in plain words)

OfflineJS is for apps that must **keep working when the network is bad**:

- User taps Save → data lands on the device immediately  
- Changes go into a **durable outbox**  
- When online, OfflineJS **syncs** to your API and resolves **conflicts**

That is **offline-first product data** (stock counts, checklists, CRM rows, forms) — not a generic website speed trick.

**Great fit:** field/ops apps, PWAs, multi-device edits, anything where lost writes hurt.  
**Weak fit:** pure content sites, “make this GET 200ms faster” alone, or server-authoritative every click.

## Can I use OfflineJS for caching?

**Yes for app records** — collections in IndexedDB act like a durable local cache you can read instantly.

**For general HTTP caching** (TTL, stale-while-revalidate, Cache API), use the dedicated cache helpers:

```ts
import { cachedJson, createIndexedDBHttpCache } from "@offlinejs/client";

const store = createIndexedDBHttpCache();

// 2nd arg = fetch init (undefined = plain GET); 3rd arg = cache options
const { data, fromCache } = await cachedJson("/api/catalog", undefined, {
  store,
  ttlMs: 60_000,
  staleWhileRevalidateMs: 30_000
});
```
| Need | Tool |
| --- | --- |
| Offline writes + sync + conflicts | `createOfflineDB` |
| Cache GET/JSON responses with TTL | `cachedJson` / `cachedFetch` (`@offlinejs/http-cache`) |
| Cache static assets (JS/CSS/images) | Service Worker + Cache API (`createCacheApiStore`) |

## Which package should I install?

Start with `@offlinejs/client` — one import for `createOfflineDB`, storage presets, sync, React hooks, and common plugins.

```bash
pnpm add @offlinejs/client
```

For a smaller custom stack, compose `@offlinejs/core` with focused packages such as `@offlinejs/storage-sqlite`, `@offlinejs/broadcast`, or `@offlinejs/sw`.

Node-only apps that import the full `@offlinejs/client` barrel may need a `react` peer dependency (hooks are re-exported). Prefer `@offlinejs/core` when you do not want React on the server.

## Does core depend on React, Vue, Svelte, or Next.js?

No. `@offlinejs/core` is framework agnostic.

## Can I use Axios?

Yes. Implement `SyncTransport` and pass it as `transport`.

## Does optimistic update wait for the network?

No. Local storage updates first, then the mutation is queued and synced when possible.

## What happens when sync fails?

The mutation remains queued, receives retry metadata, and is retried with exponential backoff.

## How are conflicts resolved?

Prefer the `ConflictStrategyName` enum (`LastWriteWins`, `ClientWins`, `ServerWins`, `Merge`) or pass a custom resolver.

## How do I see the sync pipeline?

Open the live demo on the docs site (`demo.html`): edit stock on this device, watch the outbox, flush to the remote API, go offline, and stage conflicts.
