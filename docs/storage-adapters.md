# Storage Adapters

Adapters implement `StorageAdapter` from `@offlinejs/types`.

```ts
interface StorageAdapter {
  get(collection, id);
  set(collection, value);
  setMany?(collection, values); // optional bulk write
  delete(collection, id);
  find(collection, query);
  clear(collection?);
  transaction(scope, run);
}
```

Prefer `setMany` for ingest and sync pull when the adapter sets `capabilities.bulkWrites`.
IndexedDB, memory, SQLite, and OPFS implement it — one durable batch instead of N transactions.
Adapters that support secondary index metadata also implement:

```ts
interface IndexableStorageAdapter extends StorageAdapter {
  createIndex(definition);
  dropIndex(collection, name);
  listIndexes(collection?);
}
```

## Memory

Use `@offlinejs/storage-memory` for tests, Node.js, SSR fallback behavior, and demos.

## IndexedDB

Use `@offlinejs/storage-indexeddb` for durable browser persistence. It stores records in one
object store with a collection index, which keeps dynamic collections possible without schema
upgrades for every collection.

## SQLite

Use `@offlinejs/storage-sqlite` with a pluggable async SQL driver. For Node production:

```ts
import Database from "better-sqlite3";
import { createBetterSqlite3DriverAsync, createSQLiteStorage } from "@offlinejs/storage-sqlite";

const storage = createSQLiteStorage({
  driver: createBetterSqlite3DriverAsync(new Database("offline.db"))
});
```

Equality filters + order/limit can push into SQL (`json_extract`) when the query is engine-safe.

## OPFS

Use `@offlinejs/storage-opfs` for large browser datasets backed by the Origin Private File System.

## Future adapters

LocalStorage and other platform-specific adapters can be added without changing `@offlinejs/core`.
