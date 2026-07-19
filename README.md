# OfflineJS

Offline-first data layer for TypeScript and JavaScript.

Write to local storage immediately. Sync when the network is back. Retry failed mutations automatically. Resolve conflicts with a strategy you choose.

```ts
import { createOfflineDB } from "@offlinejs/core";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: createIndexedDBStorage({ databaseName: "my-app" }),
  sync: { conflictStrategy: "lastWriteWins" }
});

const todos = db.collection("todos");

await todos.create({ title: "Works offline", completed: false });
const open = await todos.find({ filters: { completed: false } });
```

## Install

Browser apps:

```bash
pnpm add @offlinejs/core @offlinejs/storage-indexeddb
```

Node, tests, or SSR (no persistence needed):

```bash
pnpm add @offlinejs/core @offlinejs/storage-memory
```

React:

```bash
pnpm add @offlinejs/core @offlinejs/storage-indexeddb @offlinejs/react
```

## Quick start

### 1. Define your collections

```ts
type AppData = {
  todos: {
    id: string;
    title: string;
    completed: boolean;
    createdAt?: number;
    updatedAt?: number;
  };
  users: {
    id: string;
    name: string;
    role?: "admin" | "member";
  };
};
```

### 2. Create the database

```ts
import { createOfflineDB } from "@offlinejs/core";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";

const db = createOfflineDB<AppData>({
  baseURL: "https://api.example.com",
  storage: createIndexedDBStorage({ databaseName: "my-app" }),
  sync: {
    autoStart: true,
    conflictStrategy: "lastWriteWins"
  }
});
```

### 3. Read and write through collections

```ts
const todos = db.collection("todos");

const todo = await todos.create({
  title: "Ship offline sync",
  completed: false
});

await todos.update(todo.id, { completed: true });

const openTodos = await todos.find({
  filters: { completed: false },
  orderBy: "createdAt",
  sort: "desc"
});

const one = await todos.findOne(todo.id);
await todos.delete(todo.id);
```

What happens under the hood:

1. The write lands in local storage immediately (optimistic).
2. The mutation is queued for sync.
3. When online, OfflineJS pushes queued changes and pulls remote updates.
4. Conflicts are resolved with your chosen strategy.

## Implementation examples

### Query, filter, sort, and paginate

```ts
const users = db.collection("users");

await users.find({
  filters: {
    role: "admin",
    age: { gte: 18 }
  },
  search: "ada",
  orderBy: "name",
  sort: "asc",
  limit: 20,
  offset: 0
});

const page = await users.paginate({
  limit: 20,
  offset: 40,
  orderBy: "name"
});
```

### Subscribe to local changes

Use this to keep UI in sync with local writes and collection sync.

```ts
const unsubscribe = todos.subscribe((records) => {
  renderTodos(records);
});

await todos.create({ title: "New task", completed: false });

unsubscribe();
```

### Manual sync

```ts
// Sync one collection
await todos.sync();

// Sync everything
await db.sync();
```

### Listen for offline / sync events

```ts
db.on("offline", () => {
  showBanner("You are offline. Changes will sync later.");
});

db.on("online", () => {
  showBanner("Back online. Syncing…");
});

db.on("queue:add", (mutation) => {
  console.debug("queued", mutation.operation, mutation.collection);
});

db.on("sync:end", ({ completed, failed }) => {
  console.info(`Sync finished: ${completed} ok, ${failed} failed`);
});

db.on("conflict", (context) => {
  console.warn("Conflict resolved", context);
});

db.on("error", (error) => {
  reportError(error);
});
```

### Choose a conflict strategy

Built-in options: `clientWins`, `serverWins`, `lastWriteWins`, `merge`, or a custom resolver.

```ts
const db = createOfflineDB({
  storage: createIndexedDBStorage(),
  sync: {
    conflictStrategy: async ({ client, server }) => ({
      ...server,
      ...client,
      reviewed: true
    })
  }
});
```

### Use memory storage in tests or Node

```ts
import { createOfflineDB } from "@offlinejs/core";
import { createMemoryStorage } from "@offlinejs/storage-memory";

const db = createOfflineDB({
  storage: createMemoryStorage(),
  sync: { enabled: false }
});

const users = db.collection("users");
await users.create({ name: "Ada", role: "admin" });
```

Runnable example: [`examples/basic-node`](./examples/basic-node).

### Use React hooks

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

### Add a plugin

```ts
const logger = () => ({
  name: "logger",
  setup({ events }) {
    return events.on("sync:start", ({ queued }) => {
      console.debug(`Starting sync for ${queued} mutations`);
    });
  }
});

db.use(logger());
```

Common plugin use cases: auth headers, logging, validation, encryption, analytics, and devtools.

### Connect a custom API transport

Use this when your backend does not match the default fetch paths.

```ts
import type { SyncTransport } from "@offlinejs/core";
import { createOfflineDB } from "@offlinejs/core";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";

const transport: SyncTransport = {
  async request(request) {
    const response = await fetch(`/api/offline${request.path}`, {
      method: request.method,
      headers: request.headers,
      body: request.body ? JSON.stringify(request.body) : undefined
    });

    return {
      data: await response.json(),
      status: response.status
    };
  }
};

const db = createOfflineDB({
  storage: createIndexedDBStorage(),
  transport
});
```

### Handle errors

```ts
import {
  ConflictError,
  OfflineError,
  StorageError,
  SyncError,
  ValidationError
} from "@offlinejs/core";

try {
  await todos.sync();
} catch (error) {
  if (error instanceof SyncError) {
    // mutation stays queued and will retry
  } else if (error instanceof ConflictError) {
    // conflict strategy could not resolve
  } else if (error instanceof StorageError) {
    // local persistence failed
  } else if (error instanceof ValidationError) {
    // invalid input
  } else if (error instanceof OfflineError) {
    // other OfflineJS error
  }
}
```

Failed syncs do not drop queued mutations. They retry with backoff until they succeed or you clear them.

## API cheat sheet

```ts
const db = createOfflineDB({
  baseURL,
  storage,
  sync,
  transport,
  plugins
});

const users = db.collection("users");

await users.find(query);
await users.findOne(id);
await users.paginate(query);
await users.create(data);
await users.update(id, data);
await users.delete(id);
await users.sync();
users.subscribe((records) => {});

await db.sync();
db.use(plugin);
db.on("sync:start" | "sync:end" | "offline" | "online" | "queue:add" | "queue:complete" | "conflict" | "error", handler);
```

## Packages you will actually use

| Package | When to use it |
| --- | --- |
| `@offlinejs/core` | Create the DB, collections, events, plugins |
| `@offlinejs/storage-indexeddb` | Durable browser storage |
| `@offlinejs/storage-memory` | Tests, Node, SSR, demos |
| `@offlinejs/storage-sqlite` | Mobile, Electron, server SQLite |
| `@offlinejs/storage-opfs` | Large browser datasets via OPFS |
| `@offlinejs/react` | React hooks for collections |
| `@offlinejs/next` | Next.js helpers |
| `@offlinejs/auth` | Auth-aware transport / plugin patterns |
| `@offlinejs/validation` | Schema validation around storage |
| `@offlinejs/encryption` | Encrypt records at rest |
| `@offlinejs/devtools` / `@offlinejs/devtools-ui` | Inspect events while developing |

## Docs

| Doc | What it covers |
| --- | --- |
| [API reference](./docs/api-reference.md) | `createOfflineDB`, collections, events |
| [Best practices](./docs/best-practices.md) | Storage, sync, and production tips |
| [Storage adapters](./docs/storage-adapters.md) | Choosing and configuring adapters |
| [Sync engine](./docs/sync-engine.md) | Push, pull, delta, retries |
| [Plugins](./docs/plugins.md) | Extending OfflineJS |
| [FAQ](./docs/faq.md) | Common consumer questions |
| [Architecture](./docs/architecture.md) | How the pieces fit together |

### Docs site

```bash
pnpm docs:build
```

Static output is written to `docs-site/dist`. Root `vercel.json` is ready for Vercel.

## Tips for production apps

- Prefer IndexedDB (or SQLite/OPFS) over memory storage in real apps.
- Keep records JSON-serializable.
- Paginate large collections (`limit` / `offset` or `paginate()`).
- Pick an explicit conflict strategy for each product flow.
- Subscribe at page/feature boundaries, not every tiny component.
- Listen to `error` and send it to your observability tool.
- Use a custom `transport` when your API shape differs from the defaults.
