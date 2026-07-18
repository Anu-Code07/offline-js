# OfflineJS

OfflineJS is a production-grade offline-first data layer for TypeScript and JavaScript.
The flagship package is `@offlinejs/core`, a framework-agnostic client that hides network
detection, local persistence, optimistic updates, mutation queues, retries, sync, and conflict
resolution behind a small collection API.

```ts
import { createOfflineDB } from "@offlinejs/core";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";

type AppData = {
  users: { id: string; name: string; age?: number; updatedAt?: number };
};

const db = createOfflineDB<AppData>({
  baseURL: "https://api.example.com",
  storage: createIndexedDBStorage(),
  sync: {
    conflictStrategy: "lastWriteWins"
  }
});

const users = db.collection("users");

await users.create({ name: "John" });
await users.update("user_1", { age: 25 });
await users.delete("user_1");

const data = await users.find({
  filters: { age: { gte: 18 } },
  orderBy: "name",
  sort: "asc"
});
```

## Installation

```bash
pnpm add @offlinejs/core @offlinejs/storage-indexeddb
```

For tests, SSR, workers, or ephemeral data:

```bash
pnpm add @offlinejs/core @offlinejs/storage-memory
```

## Package architecture

| Package | Why it exists |
| --- | --- |
| `@offlinejs/core` | Public database API, collections, optimistic writes, events, plugins, typed errors, and orchestration. |
| `@offlinejs/types` | Shared contracts for adapters, sync, queues, plugins, and framework integrations. |
| `@offlinejs/utils` | Tree-shakable helpers for IDs, query matching, sorting, pagination, search, backoff, and error normalization. |
| `@offlinejs/storage-memory` | Fast in-memory adapter for Node.js, tests, SSR fallbacks, and demos. |
| `@offlinejs/storage-indexeddb` | Durable browser storage adapter built on IndexedDB with collection indexing. |
| `@offlinejs/queue` | Persistent mutation queue with priority, retries, pause/resume, and batch selection. |
| `@offlinejs/network` | Browser/Node-safe network monitor and fetch transport. |
| `@offlinejs/sync` | Push, pull, delta-ready sync engine and conflict resolution strategies. |
| `@offlinejs/react` | Optional React integration surface around subscription stores. |
| `@offlinejs/next` | Optional Next.js helpers for runtime-aware clients. |
| `@offlinejs/devtools` | Plugin for inspecting OfflineJS events during development. |
| `examples/*` | Runnable examples demonstrating package composition. |

## Folder structure

```txt
packages/
  core/
  storage-indexeddb/
  storage-memory/
  sync/
  network/
  queue/
  types/
  utils/
  react/
  next/
  devtools/
examples/
  basic-node/
docs/
  api-reference.md
  architecture.md
  best-practices.md
  faq.md
  plugins.md
  storage-adapters.md
  sync-engine.md
```

## Public API

```ts
const db = createOfflineDB({
  baseURL,
  storage,
  sync,
  plugins
});

const users = db.collection("users");

await users.find();
await users.findOne(id);
await users.create(data);
await users.update(id, data);
await users.delete(id);
await users.sync();
users.subscribe((records) => {});

db.on("sync:start", ({ queued }) => {});
db.on("sync:end", ({ completed, failed }) => {});
db.on("offline", (state) => {});
db.on("online", (state) => {});
db.on("queue:add", (mutation) => {});
db.on("queue:complete", (mutation) => {});
db.on("conflict", (context) => {});
db.on("error", (error) => {});
```

## High-level architecture

```mermaid
flowchart TD
  UI[Application / Framework] --> Core["@offlinejs/core"]
  Core --> Storage["StorageAdapter"]
  Core --> Queue["@offlinejs/queue"]
  Core --> Network["@offlinejs/network"]
  Core --> Events["Typed Event Bus"]
  Core --> Plugins["Plugin Runtime"]
  Queue --> Storage
  Core --> Sync["@offlinejs/sync"]
  Sync --> Queue
  Sync --> Storage
  Sync --> Transport["SyncTransport / fetch"]
  Transport --> API[Remote API]
```

## Class diagram

```mermaid
classDiagram
  class OfflineDB {
    +collection(name)
    +sync()
    +transaction(run)
    +use(plugin)
    +on(event, listener)
  }

  class OfflineCollection {
    +find(query)
    +findOne(id)
    +create(data)
    +update(id, data)
    +delete(id)
    +subscribe(callback)
    +sync()
  }

  class StorageAdapter {
    <<interface>>
    +get(collection, id)
    +set(collection, value)
    +delete(collection, id)
    +find(collection, query)
    +clear(collection)
    +transaction(scope, run)
  }

  class MutationQueue {
    +add(input)
    +all()
    +due(options)
    +markAttempt(id)
    +remove(id)
    +pause()
    +resume()
  }

  class SyncEngine {
    +sync(collection)
    +pull(collection, since)
  }

  OfflineDB --> OfflineCollection
  OfflineCollection --> StorageAdapter
  OfflineCollection --> MutationQueue
  OfflineDB --> SyncEngine
  SyncEngine --> MutationQueue
  SyncEngine --> StorageAdapter
```

## Storage adapter design

```ts
interface StorageAdapter {
  get<TRecord>(collection: string, id: string): Promise<TRecord | null>;
  set<TRecord>(collection: string, value: TRecord): Promise<void>;
  delete(collection: string, id: string): Promise<void>;
  find<TRecord>(collection: string, query?: QueryOptions<TRecord>): Promise<TRecord[]>;
  clear(collection?: string): Promise<void>;
  transaction<TValue>(
    scope: string[],
    run: (store: TransactionStore) => Promise<TValue>
  ): Promise<TValue>;
}
```

Current adapters:

- IndexedDB for durable browser persistence.
- Memory for Node.js, tests, SSR fallbacks, and short-lived workers.

Future adapters:

- SQLite for mobile, Electron, and server runtimes.
- OPFS for browser file-backed datasets.
- LocalStorage for tiny datasets and legacy environments.

## Sync engine design

```txt
Offline
  -> optimistic local write
  -> persistent queue
  -> reconnect
  -> batch due mutations
  -> push sync
  -> conflict resolution
  -> pull/delta sync
  -> remove completed queue items
```

Supported sync modes:

- Push sync: queued local mutations are sent to the server.
- Pull sync: server records are written into local storage.
- Delta sync: `since` values can be passed to `pull()` and API query params.
- Incremental sync: collection-level `sync()` limits work to a single collection.

## Queue implementation

Queued mutations include operation, collection, record id, payload, base snapshot, priority,
retry count, last attempt timestamp, and status. The queue is storage-backed, so it survives
refreshes when paired with IndexedDB. Processing selects due mutations by priority and creation
time, applies exponential backoff with jitter, and removes mutations only after success.

## Conflict resolution

Built-in strategies:

- `clientWins`
- `serverWins`
- `lastWriteWins`
- `merge`
- custom async resolver

```ts
const db = createOfflineDB({
  sync: {
    conflictStrategy: async ({ client, server }) => ({
      ...server,
      ...client,
      reviewed: true
    })
  }
});
```

## Plugin system

Plugins receive the database, event bus, network monitor, and storage adapter. They can subscribe
to lifecycle events, decorate behavior externally, and return a disposer.

```ts
const logger = () => ({
  name: "logger",
  setup({ events }) {
    return events.on("error", (error) => console.error(error));
  }
});

db.use(logger());
```

Use plugins for auth headers, encryption, analytics, logging, schema validation, and devtools.

## Error handling

`@offlinejs/core` exports:

- `OfflineError`
- `ConflictError`
- `StorageError`
- `SyncError`
- `ValidationError`

Exceptions are surfaced through rejected promises and the `error` event. Sync failures never delete
queued mutations; they are retried according to queue policy.

## Performance strategy

- Storage adapters own persistence and can add native indexes.
- Querying supports pagination, filtering, sorting, and search at the adapter boundary.
- Sync uses batches to avoid long main-thread work and oversized network requests.
- Queue backoff avoids hot retry loops when APIs are unavailable.
- Collections notify subscribers only after local writes or collection sync.
- Packages are ESM, side-effect free, and tree-shakable.
- Large datasets should use indexed adapters, server-side delta sync, and small `limit` windows.

## Testing strategy

Vitest covers:

- offline optimistic writes
- reconnect sync
- retries and queue preservation
- conflict strategy behavior
- memory storage
- collection subscriptions
- pagination, filtering, sorting, and search

The repository is configured for coverage reporting with a 90%+ target as packages mature.

## Internal implementation plan

1. Keep public contracts in `@offlinejs/types`.
2. Keep framework-independent behavior in core packages.
3. Add adapters without changing `@offlinejs/core`.
4. Add framework packages as optional peer integrations.
5. Add advanced production features behind stable interfaces: schema validation, encryption,
   worker-based sync, service-worker background sync, and adapter-specific indexes.

## Roadmap

### v0.1

- Core collection API.
- Memory and IndexedDB adapters.
- Persistent mutation queue.
- Push/pull sync engine.
- Events, subscriptions, plugins, typed errors.
- Foundational documentation and tests.

### v0.2

- Service Worker background sync plugin.
- Adapter-level secondary indexes.
- Richer API transport configuration.
- First React hooks built on `useSyncExternalStore`.

### v0.3

- Schema validation plugin.
- Encryption plugin.
- Auth plugin patterns.
- Next.js cache and server-action examples.

### v0.5

- SQLite adapter.
- OPFS adapter.
- Worker-based sync runtime.
- Devtools UI package.

### v0.8

- Multi-tab coordination.
- CRDT-friendly conflict resolver helpers.
- Server sync protocol reference implementation.
- Performance benchmarks for 100k+ records.

### v1.0

- Stable public contracts.
- Backwards-compatible adapter API.
- Full docs site.
- 90%+ coverage across core packages.
- Production hardening for large datasets, migrations, and background sync.
