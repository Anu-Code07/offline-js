# Storage Adapters

Adapters implement `StorageAdapter` from `@offlinejs/types`.

```ts
interface StorageAdapter {
  get(collection, id);
  set(collection, value);
  delete(collection, id);
  find(collection, query);
  clear(collection?);
  transaction(scope, run);
}
```

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

Use `@offlinejs/storage-sqlite` with a pluggable async SQL driver. This keeps the adapter usable
with Electron, Expo, Bun, server-side SQLite wrappers, and edge runtimes.

## OPFS

Use `@offlinejs/storage-opfs` for large browser datasets backed by the Origin Private File System.

## Future adapters

LocalStorage and other platform-specific adapters can be added without changing `@offlinejs/core`.
