# API Reference

## Install

```bash
pnpm add @offlinejs/client
```

## `createOfflineDB(options)`

Creates a framework-agnostic offline database from the one-import package.

```ts
import { ConflictStrategyName, createOfflineDB, OfflineStorage } from "@offlinejs/client";

const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage: OfflineStorage.IndexedDB, // or OfflineStorage.Memory | OfflineStorage.OPFS
  sync: { conflictStrategy: ConflictStrategyName.LastWriteWins }
});
```

If `storage` is omitted, OfflineJS picks `OfflineStorage.IndexedDB` in browsers and `OfflineStorage.Memory` elsewhere.

| Enum | Values |
| --- | --- |
| `OfflineStorage` | `Memory`, `IndexedDB`, `OPFS` |
| `ConflictStrategyName` | `ClientWins`, `ServerWins`, `LastWriteWins`, `Merge` |

Need a specialized helper? Import it from the same package:

```ts
import {
  createOfflineDB,
  createAuthTransport,
  createSQLiteStorage,
  useOfflineCollection
} from "@offlinejs/client";
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
