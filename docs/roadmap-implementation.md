# Roadmap Implementation

This document maps the v0.2 through v0.8 roadmap to the packages available in the workspace.
These are production-facing foundations: APIs are typed, framework-independent where possible,
and designed to harden further without breaking `@offlinejs/core`.

## v0.2

- `@offlinejs/sw`: background sync plugin, SW registration helper, and tag-aware
  worker handler helpers.
- Adapter-level indexes: `createIndex`, `dropIndex`, and `listIndexes` on indexable adapters,
  with equality-filter acceleration and unique constraints (memory, IndexedDB, SQLite, OPFS).
- `@offlinejs/network`: middleware and timeout-aware fetch transport.
- `@offlinejs/react`: `useOfflineCollection`, `useOfflineRecords`, `OfflineProvider`,
  `useOfflineDB`, and `useOfflineStatus` built on `useSyncExternalStore`.

## v0.3

- `@offlinejs/validation`: validator helpers (`required`, `type`, `compose`) and validated
  storage wrapper with index forwarding + transaction validation.
- `@offlinejs/encryption`: encrypted JSON storage wrapper, WebCrypto AES-GCM codec factory,
  and key helper — indexes forward through the wrapper.
- `@offlinejs/auth`: auth transport wrapper with 401 refresh/retry and plugin pattern.
- `@offlinejs/next`: cache tag helpers, `revalidateTag` bridge, and server-action sync helpers
  (bound or unbound collection).

## v0.5

- `@offlinejs/storage-sqlite`: SQLite adapter over a pluggable async SQL driver with SQL
  secondary index entries.
- `@offlinejs/storage-opfs`: Origin Private File System adapter for large browser datasets
  with secondary index data files.
- `@offlinejs/worker-sync`: worker message protocol, runtime helpers, and attach helper.
- `@offlinejs/devtools-ui`: framework-free event timeline renderer.

## v0.8

- `@offlinejs/broadcast`: BroadcastChannel-based multi-tab coordination with leader
  election and debounced sync.
- `@offlinejs/conflicts`: CRDT-friendly merge helpers (counters, sets, OR-Map, tombstones).
- `@offlinejs/sync-protocol`: reference push/pull protocol envelopes and handlers with
  conflict detection and pull cursors.
- `@offlinejs/benchmarks`: 100k-record write/find/indexed-find benchmark utilities.

## Example composition

Compose packages around `@offlinejs/core`. Start with storage + transport, then layer plugins.

### Browser production stack

Validation + encryption + auth + background sync + multi-tab coordination:

```ts
import { createOfflineDB } from "@offlinejs/core";
import { createAuthTransport } from "@offlinejs/auth";
import { createBroadcastCoordination, coordinationPlugin } from "@offlinejs/broadcast";
import { createFieldMergeResolver } from "@offlinejs/conflicts";
import { createJsonEncryptionStorage, createWebCryptoAesGcmCodec } from "@offlinejs/encryption";
import { createFetchTransport } from "@offlinejs/network";
import { backgroundSyncPlugin } from "@offlinejs/sw";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";
import { createValidatedStorage, createRequiredFieldsValidator } from "@offlinejs/validation";

const baseStorage = createIndexedDBStorage({ databaseName: "app" });

// Optional secondary index for query performance
await baseStorage.createIndex?.({
  collection: "todos",
  name: "byCompleted",
  fields: ["completed"]
});

const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
  "encrypt",
  "decrypt"
]);
const codec = await createWebCryptoAesGcmCodec(key);

const storage = createValidatedStorage(createJsonEncryptionStorage(baseStorage, codec), {
  todos: createRequiredFieldsValidator(["title"])
});

const transport = createAuthTransport(
  createFetchTransport({
    baseURL: "https://api.example.com",
    timeoutMs: 10_000
  }),
  {
    tokenProvider: () => localStorage.getItem("token"),
    refreshToken: async () => localStorage.getItem("refreshToken")
  }
);

const db = createOfflineDB({
  storage,
  transport,
  sync: {
    autoStart: true,
    conflictStrategy: createFieldMergeResolver({
      title: "client",
      completed: "lastWriteWins",
      updatedAt: "max"
    })
  },
  plugins: [backgroundSyncPlugin(), coordinationPlugin(createBroadcastCoordination())]
});

const todos = db.collection("todos");
await todos.create({ title: "Works offline", completed: false });
```

### React UI on top of the same DB

```tsx
import { OfflineProvider, useOfflineCollection, useOfflineStatus } from "@offlinejs/react";

function TodoList({ todos }) {
  const { records, create, update, delete: remove } = useOfflineCollection(todos);
  const { online } = useOfflineStatus();

  return (
    <ul data-online={online}>
      {records.map((todo) => (
        <li key={todo.id}>
          <button onClick={() => update(todo.id, { completed: !todo.completed })}>
            {todo.title}
          </button>
          <button onClick={() => remove(todo.id)}>Delete</button>
        </li>
      ))}
      <button onClick={() => create({ title: "New todo", completed: false })}>Add</button>
    </ul>
  );
}

export function App({ db, todos }) {
  return (
    <OfflineProvider db={db}>
      <TodoList todos={todos} />
    </OfflineProvider>
  );
}
```

### Devtools timeline

```ts
import { createDevtoolsController } from "@offlinejs/devtools-ui";

const devtools = createDevtoolsController(db);
devtools.mount(document.getElementById("offlinejs-devtools"));
```

### Worker-based sync

```ts
import { createWorkerSyncPlugin } from "@offlinejs/worker-sync";

const worker = new Worker(new URL("./offline-sync.worker.ts", import.meta.url), {
  type: "module"
});

const db = createOfflineDB({
  storage,
  transport,
  plugins: [createWorkerSyncPlugin(worker)]
});
```

### Next.js cache tags + server action sync

```ts
import { createCacheTagRevalidator, createServerActionSync, offlineCacheTag } from "@offlinejs/next";

export const syncTodos = createServerActionSync(db, "todos");

export const todoTag = (id: string) => offlineCacheTag("todos", id);

export const cache = createCacheTagRevalidator(revalidateTag);
```

### Large datasets (OPFS or SQLite)

```ts
import { createOPFSStorage } from "@offlinejs/storage-opfs";
// or: import { createSQLiteStorage } from "@offlinejs/storage-sqlite";

const db = createOfflineDB({
  storage: createOPFSStorage({ rootName: "offlinejs" }),
  transport
});
```

### Server sync protocol reference

Use `@offlinejs/sync-protocol` on the API side to speak the same push/pull envelopes the client expects:

```ts
import { handlePull, handlePush } from "@offlinejs/sync-protocol";

app.post("/sync/push", async (req, res) => {
  res.json(await handlePush(store, req.body));
});

app.get("/sync/pull", async (req, res) => {
  res.json(await handlePull(store, req.query));
});
```

## Suggested install sets

Default (one package):

```bash
pnpm add @offlinejs/client
```

```ts
import { createOfflineDB, useOfflineCollection, backgroundSyncPlugin } from "@offlinejs/client";
```

Node / tests:

```ts
import { createOfflineDB } from "@offlinejs/client";

const db = createOfflineDB({ storage: "memory", sync: { enabled: false } });
```

Tree-shake a single advanced adapter when you want a minimal bundle:

```bash
pnpm add @offlinejs/storage-sqlite
```
