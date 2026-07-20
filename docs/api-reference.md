# API Reference

## Install

```bash
pnpm add @offlinejs
```

## `createOfflineDB(options)`

Creates a framework-agnostic offline database from the one-import package.

```ts
import { createOfflineDB } from "@offlinejs";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: "indexeddb", // or "memory" | "opfs" | a custom adapter
  sync: { conflictStrategy: "lastWriteWins" }
});
```

If `storage` is omitted, OfflineJS picks `"indexeddb"` in browsers and `"memory"` elsewhere.

Need a specialized helper? Import it from the same package:

```ts
import {
  createOfflineDB,
  createAuthTransport,
  createSQLiteStorage,
  useOfflineCollection
} from "@offlinejs";
```

Or import only that package when you want a smaller bundle:

```ts
import { createSQLiteStorage } from "@offlinejs/storage-sqlite";
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

## Events

Available events are `sync:start`, `sync:end`, `offline`, `online`, `queue:add`,
`queue:complete`, `conflict`, and `error`.

```ts
db.on("queue:add", (mutation) => {
  console.debug("queued", mutation);
});
```
