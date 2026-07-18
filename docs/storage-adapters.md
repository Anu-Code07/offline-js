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

## Memory

Use `@offlinejs/storage-memory` for tests, Node.js, SSR fallback behavior, and demos.

## IndexedDB

Use `@offlinejs/storage-indexeddb` for durable browser persistence. It stores records in one
object store with a collection index, which keeps dynamic collections possible without schema
upgrades for every collection.

## Future adapters

SQLite, OPFS, and LocalStorage can be added without changing `@offlinejs/core`.
