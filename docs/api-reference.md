# API Reference

## Install

```bash
pnpm add @offlinejs/client
# npm i @offlinejs/client
```

Published on npm as [`@offlinejs/client`](https://www.npmjs.com/package/@offlinejs/client) (latest **0.1.2**). One package covers the common path — offline DB, storage presets, plugins, React hooks, and HTTP cache helpers. Prefer enums (`OfflineStorage`, `ConflictStrategyName`) over raw strings. Import a focused `@offlinejs/*` package only when you need a smaller bundle.

## `createOfflineDB(options)`

Creates a framework-agnostic offline database.

```ts
import { ConflictStrategyName, createOfflineDB, OfflineStorage } from "@offlinejs/client";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: OfflineStorage.IndexedDB, // Memory | IndexedDB | OPFS
  sync: { conflictStrategy: ConflictStrategyName.LastWriteWins },
  plugins: [] // see Plugins below
});
```

If `storage` is omitted, OfflineJS picks `OfflineStorage.IndexedDB` in browsers and `OfflineStorage.Memory` elsewhere.

| Enum | Values |
| --- | --- |
| `OfflineStorage` | `Memory`, `IndexedDB`, `OPFS` |
| `ConflictStrategyName` | `ClientWins`, `ServerWins`, `LastWriteWins`, `Merge` |

Common options:

| Option | Purpose |
| --- | --- |
| `baseURL` | Prefix for default fetch transport |
| `storage` | Adapter instance or `OfflineStorage` preset |
| `network` | Online/offline monitor (defaults to browser monitor) |
| `transport` | Custom `SyncTransport` (push/pull HTTP or fake API) |
| `sync` | Auto-start, pull, conflict strategy, batching |
| `plugins` | Array of `OfflinePlugin` factories (devtools, auth, …) |

Need a specialized helper from the same package:

```ts
import {
  createOfflineDB,
  createAuthTransport,
  createSQLiteStorage,
  useOfflineCollection,
  devtools,
  validationPlugin
} from "@offlinejs/client";
```

## Collections

```ts
const users = db.collection("users");

await users.find({ limit: 20 });
await users.findOne(id);
await users.create({ name: "Ada" });
await users.update(id, { name: "Grace" });
await users.delete(id);
await users.sync();
const unsubscribe = users.subscribe((records) => {});
```

Writes land in local storage immediately and enqueue a durable outbox mutation. Call `db.sync()` (or rely on auto-sync) to flush when online.

## Events

| Event | When it fires |
| --- | --- |
| `sync:start` / `sync:end` | Sync cycle begins / finishes |
| `offline` / `online` | Network monitor changes |
| `queue:add` / `queue:complete` | Mutation enters / leaves the outbox |
| `conflict` | Client and server versions diverge |
| `error` | Transport, validation, or storage failure |
| `worker:message` | Service worker / worker-sync message |
| `coordination:message` | Multi-tab broadcast coordination |

```ts
db.on("queue:add", (mutation) => {
  console.debug("queued", mutation);
});
```

## Plugins (what ships today)

Plugins add behavior without forking core. Pass them to `createOfflineDB({ plugins: [...] })` or call `db.use(plugin)` later.

Each plugin gets `{ db, events, network, storage }` in `setup` and may return a disposer.

### Built-in plugins & helpers

| Export | Package | What it does |
| --- | --- | --- |
| `devtools({ ui? })` | `@offlinejs/devtools` | Logs OfflineJS events; set `ui: true` to open a floating Action/State dock |
| `openOfflineDevtools(db)` / `createDevtoolsController(db)` | `@offlinejs/devtools-ui` | Redux-style panel — floating dock or inline `mount(el)` |
| `authPlugin` / `createAuthTransport` | `@offlinejs/auth` | Attaches Bearer (or custom) tokens; optional refresh on 401 |
| `validationPlugin` / `createValidatedStorage` | `@offlinejs/validation` | Schema checks on write (`createRequiredFieldsValidator`, `createTypeValidator`, …) |
| `createJsonEncryptionStorage` | `@offlinejs/encryption` | AES-GCM encrypt/decrypt records at rest (Web Crypto) |
| `coordinationPlugin` / `createBroadcastCoordination` | `@offlinejs/broadcast` | Multi-tab leader election + sync debounce via `BroadcastChannel` |
| `backgroundSyncPlugin` / `registerOfflineServiceWorker` | `@offlinejs/sw` | Request Background Sync / SW messages when the link returns |
| `createWorkerSyncPlugin` | `@offlinejs/worker-sync` | Move sync work into a Web Worker |

### DevTools (most common)

```ts
import { createOfflineDB, OfflineStorage, devtools, openOfflineDevtools } from "@offlinejs/client";

const db = createOfflineDB({
  storage: OfflineStorage.IndexedDB,
  plugins: [devtools({ ui: true })] // console + floating dock
});

// or open manually later:
openOfflineDevtools(db, { position: "bottom" });
// Ctrl/⌘ + Shift + O toggles the dock
```

Inline panel (docs / embeds — used by the live demo):

```ts
import { createDevtoolsController, devtools } from "@offlinejs/client";

const db = createOfflineDB({ plugins: [devtools()] });
const panel = createDevtoolsController(db);
panel.mount(document.getElementById("offlinejs-devtools"));
```

The panel shows a live **Action** log (`queue:*`, `sync:*`, network, conflicts, errors), filter chips + search, pause/clear, and a **State / Outbox** tab.

### Auth

```ts
import { createAuthTransport, createFetchTransport, authPlugin } from "@offlinejs/client";

const transport = createAuthTransport(createFetchTransport({ baseURL: "/api" }), {
  tokenProvider: () => localStorage.getItem("token"),
  refreshToken: async () => fetchNewToken(),
  retryOnUnauthorized: true
});

const db = createOfflineDB({
  transport,
  plugins: [authPlugin({ tokenProvider: () => localStorage.getItem("token") })]
});
```

### Validation

```ts
import {
  createOfflineDB,
  createRequiredFieldsValidator,
  createTypeValidator,
  validationPlugin
} from "@offlinejs/client";

const db = createOfflineDB({
  plugins: [
    validationPlugin({
      stock: createRequiredFieldsValidator(["name", "qty"]),
      // or composeValidators(createRequiredFieldsValidator([...]), createTypeValidator({ qty: "number" }))
    })
  ]
});
```

### Encryption at rest

```ts
import {
  createIndexedDBStorage,
  createJsonEncryptionStorage,
  createWebCryptoAesGcmCodec,
  generateAesGcmKey,
  createOfflineDB
} from "@offlinejs/client";

const key = await generateAesGcmKey();
const codec = await createWebCryptoAesGcmCodec(key);
const storage = createJsonEncryptionStorage(createIndexedDBStorage(), codec);
const db = createOfflineDB({ storage });
```

### Multi-tab coordination

```ts
import { coordinationPlugin, createOfflineDB } from "@offlinejs/client";

const db = createOfflineDB({
  plugins: [coordinationPlugin({ channelName: "my-app-offline", syncDebounceMs: 250 })]
});
```

### Background sync (service worker)

```ts
import {
  backgroundSyncPlugin,
  registerOfflineServiceWorker,
  createOfflineDB
} from "@offlinejs/client";

await registerOfflineServiceWorker({ scriptUrl: "/sw.js" });
const db = createOfflineDB({
  plugins: [backgroundSyncPlugin({ syncTag: "offlinejs-sync" })]
});
```

### Custom plugin shape

```ts
const analytics = () => ({
  name: "analytics",
  setup({ events }) {
    return events.on("sync:end", (result) => {
      sendMetric("offlinejs.sync", result);
    });
  }
});

db.use(analytics());
```

See [Plugins](plugins.html) for the full guide and [AI.md](ai.html) for copy-paste implementation prompts aimed at AI editors.

## React

```ts
import { OfflineProvider, useOfflineCollection, useOfflineStatus } from "@offlinejs/client";
```

Wrap your tree in `OfflineProvider` with a `db` instance, then use `useOfflineCollection("todos")` and `useOfflineStatus()` in components.

## Storage adapters

| Adapter | Import | Notes |
| --- | --- | --- |
| Memory | `OfflineStorage.Memory` / `createMemoryStorage()` | Fast, non-durable — tests & SSR |
| IndexedDB | `OfflineStorage.IndexedDB` / `createIndexedDBStorage()` | Default browser durable store; supports `setMany` |
| OPFS | `OfflineStorage.OPFS` / `createOPFSStorage()` | Origin Private File System |
| SQLite | `createSQLiteStorage({ driver })` | SQL pushdown; Node via `createBetterSqlite3DriverAsync` |

## HTTP cache

For TTL / stale-while-revalidate **GET caching** (not the offline outbox), use helpers from `@offlinejs/client` or [`@offlinejs/http-cache`](https://www.npmjs.com/package/@offlinejs/http-cache):

```ts
import { cachedJson, createIndexedDBHttpCache } from "@offlinejs/client";

const store = createIndexedDBHttpCache();

// cachedJson(url, fetchInit?, cacheOptions?)
// Pass undefined for fetchInit when you don't need headers/method.
const { data, fromCache, stale } = await cachedJson("/api/catalog", undefined, {
  store,
  ttlMs: 60_000,
  staleWhileRevalidateMs: 30_000
});
```

With headers:

```ts
await cachedJson("/api/catalog", {
  headers: { Authorization: `Bearer ${token}` }
}, { store, ttlMs: 60_000 });
```

See [HTTP cache](cache.html) for the full how-to (arguments, stores, invalidation).

## Media queue

Durable **photo / blob uploads** (IndexedDB queue, image compress, chunked resume) via `createMediaQueue` from `@offlinejs/client` or [`@offlinejs/media-queue`](https://www.npmjs.com/package/@offlinejs/media-queue):

```ts
import { createMediaQueue } from "@offlinejs/client";

const media = createMediaQueue({
  endpoint: "/api/uploads",
  compress: { images: { maxWidth: 1600 } }
});

media.on("progress", ({ id, pct }) => {});
media.on("complete", ({ id, url }) => {});
await media.enqueue(file);
```

See [Media queue](media-queue.html) for server headers, resume, and API.

## Next steps

- [Live demo](demo.html) — device → outbox → remote with DevTools
- [Plugins](plugins.html) — deeper plugin APIs
- [Media queue](media-queue.html) — offline photo uploads that resume
- [HTTP cache](cache.html) — TTL GET/JSON caching (`cachedJson`)
- [AI.md](ai.html) — paste into Cursor / Copilot / ChatGPT to implement OfflineJS
- [Sync engine](sync.html) · [Storage](storage.html) · [Performance](performance.html)
