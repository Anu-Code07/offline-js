# Roadmap Implementation

This document maps the v0.2 through v0.8 roadmap to the packages available in the workspace.
These are production-facing foundations: APIs are typed, framework-independent where possible,
and designed to harden further without breaking `@offlinejs/core`.

## v0.2

- `@offlinejs/service-worker`: background sync plugin and worker handler helpers.
- Adapter-level indexes: `createIndex`, `dropIndex`, and `listIndexes` on indexable adapters.
- `@offlinejs/network`: middleware and timeout-aware fetch transport.
- `@offlinejs/react`: `useOfflineCollection` and `useOfflineRecords` built on
  `useSyncExternalStore`.

## v0.3

- `@offlinejs/validation`: validator helpers and validated storage wrapper.
- `@offlinejs/encryption`: encrypted JSON storage wrapper and WebCrypto AES-GCM codec factory.
- `@offlinejs/auth`: auth transport wrapper and plugin pattern.
- `@offlinejs/next`: cache tag and server-action sync helpers.

## v0.5

- `@offlinejs/storage-sqlite`: SQLite adapter over a pluggable async SQL driver.
- `@offlinejs/storage-opfs`: Origin Private File System adapter for large browser datasets.
- `@offlinejs/worker-sync`: worker message protocol and runtime helpers.
- `@offlinejs/devtools-ui`: framework-free event timeline renderer.

## v0.8

- `@offlinejs/coordination`: BroadcastChannel-based multi-tab coordination.
- `@offlinejs/conflicts`: CRDT-friendly merge helpers.
- `@offlinejs/sync-protocol`: reference push/pull protocol envelopes and handlers.
- `@offlinejs/benchmarks`: 100k-record benchmark utilities.

## Example composition

Compose packages around `@offlinejs/core`. Start with storage + transport, then layer plugins.

### Browser production stack

Validation + encryption + auth + background sync + multi-tab coordination:

```ts
import { createOfflineDB } from "@offlinejs/core";
import { createAuthTransport } from "@offlinejs/auth";
import { createBroadcastCoordination, coordinationPlugin } from "@offlinejs/coordination";
import { createFieldMergeResolver } from "@offlinejs/conflicts";
import { createJsonEncryptionStorage, createWebCryptoAesGcmCodec } from "@offlinejs/encryption";
import { createFetchTransport } from "@offlinejs/network";
import { backgroundSyncPlugin } from "@offlinejs/service-worker";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";
import { createValidatedStorage, createRequiredFieldsValidator } from "@offlinejs/validation";

const baseStorage = createIndexedDBStorage({ databaseName: "app" });

// Optional secondary index for query performance
await baseStorage.createIndex?.({
  collection: "todos",
  name: "byCompleted",
  keyPath: "completed"
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
    tokenProvider: () => localStorage.getItem("token")
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
import { useOfflineCollection } from "@offlinejs/react";

function TodoList({ todos }) {
  const { records, create, update, delete: remove } = useOfflineCollection(todos);

  return (
    <ul>
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
import { createServerActionSync, offlineCacheTag } from "@offlinejs/next";

export const syncTodos = createServerActionSync(db, "todos");

export const todoTag = (id: string) => offlineCacheTag("todos", id);
```

### Large datasets (OPFS or SQLite)

```ts
import { createOPFSStorage } from "@offlinejs/storage-opfs";
// or: import { createSQLiteStorage } from "@offlinejs/storage-sqlite";

const db = createOfflineDB({
  storage: createOPFSStorage({ rootDirectoryName: "offlinejs" }),
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

Browser app:

```bash
pnpm add @offlinejs/core @offlinejs/storage-indexeddb @offlinejs/network @offlinejs/react
```

Hardened browser app:

```bash
pnpm add @offlinejs/core @offlinejs/storage-indexeddb @offlinejs/network \
  @offlinejs/validation @offlinejs/encryption @offlinejs/auth \
  @offlinejs/service-worker @offlinejs/coordination @offlinejs/conflicts @offlinejs/react
```

Node / tests:

```bash
pnpm add @offlinejs/core @offlinejs/storage-memory
```
