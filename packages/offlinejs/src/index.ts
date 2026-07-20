import {
  createOfflineDB as createCoreOfflineDB,
  type OfflineDB,
  type OfflineDBOptions
} from "@offlinejs/core";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import { createOPFSStorage } from "@offlinejs/storage-opfs";
import type { CollectionMap, StorageAdapter } from "@offlinejs/types";

export type StoragePreset = "memory" | "indexeddb" | "opfs";

export type OfflineJSOptions<TCollections extends CollectionMap = CollectionMap> = Omit<
  OfflineDBOptions<TCollections>,
  "storage"
> & {
  /**
   * Pass an adapter instance, or a built-in preset string.
   * Defaults to `"indexeddb"` in browsers and `"memory"` elsewhere.
   */
  storage?: StorageAdapter | StoragePreset;
};

const isBrowserRuntime = (): boolean =>
  typeof globalThis.window !== "undefined" && typeof globalThis.indexedDB !== "undefined";

export const resolveStorage = (storage?: StorageAdapter | StoragePreset): StorageAdapter => {
  if (typeof storage === "object" && storage !== null) {
    return storage;
  }

  const preset = storage ?? (isBrowserRuntime() ? "indexeddb" : "memory");

  switch (preset) {
    case "memory":
      return createMemoryStorage();
    case "indexeddb":
      return createIndexedDBStorage();
    case "opfs":
      return createOPFSStorage();
    default: {
      const exhaustive: never = preset;
      throw new Error(`Unknown OfflineJS storage preset: ${String(exhaustive)}`);
    }
  }
};

/**
 * One-import entry point for OfflineJS.
 *
 * @example
 * ```ts
 * import { createOfflineDB } from "@offlinejs";
 *
 * const db = createOfflineDB({
 *   baseURL: "https://api.example.com",
 *   storage: "indexeddb"
 * });
 * ```
 */
export const createOfflineDB = <TCollections extends CollectionMap = CollectionMap>(
  options: OfflineJSOptions<TCollections> = {}
): OfflineDB<TCollections> => {
  const { storage, ...rest } = options;

  return createCoreOfflineDB({
    ...rest,
    storage: resolveStorage(storage)
  });
};

// Core
export {
  ConflictError,
  OfflineError,
  StorageError,
  SyncError,
  ValidationError
} from "@offlinejs/core";
export type {
  CollectionMap,
  CollectionSubscriber,
  EntityRecord,
  NetworkMonitor,
  OfflineCollection,
  OfflineDB,
  OfflineDBOptions,
  OfflineEvents,
  OfflinePlugin,
  QueryOptions,
  RecordId,
  StorageAdapter,
  SyncTransport
} from "@offlinejs/core";

// Storage
export { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";
export { createMemoryStorage } from "@offlinejs/storage-memory";
export { createOPFSStorage } from "@offlinejs/storage-opfs";
export { createSQLiteStorage } from "@offlinejs/storage-sqlite";
export type { SQLiteDriver, SQLiteStorageOptions } from "@offlinejs/storage-sqlite";

// Network
export {
  BrowserNetworkMonitor,
  FetchTransport,
  createFetchTransport,
  createNetworkMonitor
} from "@offlinejs/network";

// React
export {
  createOfflineExternalStore,
  useOfflineCollection,
  useOfflineRecords
} from "@offlinejs/react";
export type { UseOfflineCollectionResult } from "@offlinejs/react";

// Auth / validation / encryption
export { authPlugin, createAuthTransport } from "@offlinejs/auth";
export type { AuthTokenProvider, AuthTransportOptions } from "@offlinejs/auth";
export {
  OfflineValidationError,
  assertValid,
  createRequiredFieldsValidator,
  createValidatedStorage,
  validationPlugin
} from "@offlinejs/validation";
export {
  createJsonEncryptionStorage,
  createWebCryptoAesGcmCodec
} from "@offlinejs/encryption";

// Plugins & advanced
export { backgroundSyncPlugin, createOfflineSyncWorkerHandler } from "@offlinejs/service-worker";
export {
  coordinationPlugin,
  createBroadcastCoordination
} from "@offlinejs/coordination";
export {
  createFieldMergeResolver,
  mergeGrowOnlyCounter,
  mergeLastWriteWinsRegister,
  mergeSetUnion
} from "@offlinejs/conflicts";
export { createWorkerSyncHandler, createWorkerSyncPlugin } from "@offlinejs/worker-sync";
export { devtools } from "@offlinejs/devtools";
export { createDevtoolsController } from "@offlinejs/devtools-ui";
export {
  createOfflineRouteClient,
  createServerActionSync,
  isServerRuntime,
  offlineCacheTag
} from "@offlinejs/next";
export {
  createPullRequest,
  createPushRequest,
  handlePull,
  handlePush
} from "@offlinejs/sync-protocol";
