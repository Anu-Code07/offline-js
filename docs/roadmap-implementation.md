# Roadmap Implementation

This document maps the v0.2 through v0.8 roadmap to the packages now available in the
workspace. These are production-facing foundations: APIs are typed, framework-independent where
possible, and designed to harden further without breaking `@offlinejs/core`.

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

```ts
import { createOfflineDB } from "@offlinejs/core";
import { createAuthTransport } from "@offlinejs/auth";
import { createBroadcastCoordination, coordinationPlugin } from "@offlinejs/coordination";
import { createJsonEncryptionStorage, createWebCryptoAesGcmCodec } from "@offlinejs/encryption";
import { createFetchTransport } from "@offlinejs/network";
import { backgroundSyncPlugin } from "@offlinejs/service-worker";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";
import { createValidatedStorage, createRequiredFieldsValidator } from "@offlinejs/validation";

const baseStorage = createIndexedDBStorage({ databaseName: "app" });
const codec = await createWebCryptoAesGcmCodec(key);
const storage = createValidatedStorage(createJsonEncryptionStorage(baseStorage, codec), {
  todos: createRequiredFieldsValidator(["title"])
});
const transport = createAuthTransport(
  createFetchTransport({ baseURL: "https://api.example.com", timeoutMs: 10_000 }),
  { tokenProvider: () => localStorage.getItem("token") }
);

const db = createOfflineDB({
  storage,
  transport,
  plugins: [backgroundSyncPlugin(), coordinationPlugin(createBroadcastCoordination())]
});
```
