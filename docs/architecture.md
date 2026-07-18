# Architecture

OfflineJS is split into small ESM packages. `@offlinejs/core` owns the public API and composes
storage, queue, network, and sync packages through interfaces from `@offlinejs/types`.

## Boundaries

- UI frameworks depend on `core`, never on storage internals.
- `core` talks to `StorageAdapter`, `MutationQueue`, `NetworkMonitor`, and `SyncEngine`.
- Storage adapters do not know about HTTP or framework state.
- Queue processing is independent of collection APIs.
- Sync uses `SyncTransport`, so fetch, Axios, GraphQL, RPC, or test doubles can be used.

## Flow

```txt
collection.create()
  -> validate record identity
  -> write local storage
  -> enqueue mutation
  -> notify subscribers
  -> sync immediately when online
```

This preserves offline UX and makes remote sync eventually consistent.
