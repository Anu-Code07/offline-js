import {
  createOfflineDB as createCoreOfflineDB,
  type OfflineDB,
  type OfflineDBOptions
} from "@offlinejs/core";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import { createOPFSStorage } from "@offlinejs/storage-opfs";
import type { CollectionMap, StorageAdapter } from "@offlinejs/types";
import { ConflictStrategyName } from "@offlinejs/types";

export { ConflictStrategyName };

/** Built-in storage backends for the one-import SDK. */
export enum OfflineStorage {
  Memory = "memory",
  IndexedDB = "indexeddb",
  OPFS = "opfs"
}

/** @deprecated Prefer `OfflineStorage` enum values. */
export type StoragePreset = `${OfflineStorage}`;

export type OfflineJSOptions<TCollections extends CollectionMap = CollectionMap> = Omit<
  OfflineDBOptions<TCollections>,
  "storage"
> & {
  /**
   * Pass an adapter instance, an `OfflineStorage` enum value, or a preset string.
   * Defaults to `OfflineStorage.IndexedDB` in browsers and `OfflineStorage.Memory` elsewhere.
   */
  storage?: StorageAdapter | OfflineStorage | StoragePreset;
};

const isBrowserRuntime = (): boolean =>
  typeof globalThis.window !== "undefined" && typeof globalThis.indexedDB !== "undefined";

const isStorageAdapter = (value: unknown): value is StorageAdapter =>
  typeof value === "object" && value !== null && "get" in value && "set" in value;

export const resolveStorage = (
  storage?: StorageAdapter | OfflineStorage | StoragePreset
): StorageAdapter => {
  if (isStorageAdapter(storage)) {
    return storage;
  }

  const preset = storage ?? (isBrowserRuntime() ? OfflineStorage.IndexedDB : OfflineStorage.Memory);

  switch (preset) {
    case OfflineStorage.Memory:
      return createMemoryStorage();
    case OfflineStorage.IndexedDB:
      return createIndexedDBStorage();
    case OfflineStorage.OPFS:
      return createOPFSStorage();
    default: {
      throw new Error(`Unknown OfflineJS storage preset: ${String(preset)}`);
    }
  }
};

/**
 * One-import entry point for OfflineJS.
 *
 * @example
 * ```ts
 * import { ConflictStrategyName, createOfflineDB, OfflineStorage } from "@offlinejs/client";
 *
 * const db = createOfflineDB({
 *   baseURL: "https://api.example.com",
 *   storage: OfflineStorage.IndexedDB,
 *   sync: { conflictStrategy: ConflictStrategyName.LastWriteWins }
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
export type {
  DevtoolsController,
  DevtoolsEventEntry,
  DevtoolsUiOptions
} from "@offlinejs/devtools-ui";
export type { ConflictStrategy } from "@offlinejs/types";

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
  OfflineProvider,
  createOfflineExternalStore,
  useOfflineCollection,
  useOfflineDB,
  useOfflineRecords,
  useOfflineStatus
} from "@offlinejs/react";
export type { OfflineStatus, UseOfflineCollectionResult } from "@offlinejs/react";

// Auth / validation / encryption
export { authPlugin, createAuthTransport } from "@offlinejs/auth";
export type { AuthTokenProvider, AuthTransportOptions } from "@offlinejs/auth";
export {
  OfflineValidationError,
  assertValid,
  composeValidators,
  createRequiredFieldsValidator,
  createTypeValidator,
  createValidatedStorage,
  validationPlugin
} from "@offlinejs/validation";
export {
  createJsonEncryptionStorage,
  createWebCryptoAesGcmCodec,
  generateAesGcmKey
} from "@offlinejs/encryption";

// Plugins & advanced
export {
  backgroundSyncPlugin,
  createOfflineSyncWorkerHandler,
  registerOfflineServiceWorker
} from "@offlinejs/sw";
export {
  coordinationPlugin,
  createBroadcastCoordination
} from "@offlinejs/broadcast";
export {
  createFieldMergeResolver,
  mergeGrowOnlyCounter,
  mergeLastWriteWinsRegister,
  mergeOrMap,
  mergeSetUnion,
  mergeWithTombstones
} from "@offlinejs/conflicts";
export {
  attachWorkerSyncRuntime,
  createWorkerSyncHandler,
  createWorkerSyncPlugin,
  createWorkerSyncRuntime
} from "@offlinejs/worker-sync";
export { devtools } from "@offlinejs/devtools";
export type { DevtoolsPluginOptions } from "@offlinejs/devtools";
export { createDevtoolsController, openOfflineDevtools } from "@offlinejs/devtools-ui";
export {
  createCacheTagRevalidator,
  createOfflineRouteClient,
  createServerActionSync,
  isServerRuntime,
  offlineCacheTag,
  withOfflineCacheTags
} from "@offlinejs/next";
export {
  createPullRequest,
  createPushRequest,
  handlePull,
  handlePush
} from "@offlinejs/sync-protocol";
export {
  benchmarkAdapterBatchWrites,
  benchmarkAdapterFind,
  benchmarkAdapterWrites,
  benchmarkIndexedFind,
  createBenchmarkRecord,
  formatBenchmarkResult,
  formatPerformanceReportMarkdown,
  runAdapterBenchmarkSuite,
  runPerformanceReport
} from "@offlinejs/benchmarks";
export type {
  AdapterBenchmarkOptions,
  BenchmarkResult,
  BenchmarkSuiteResult,
  PerformanceReport,
  PerformanceReportAdapter,
  PerformanceScore
} from "@offlinejs/benchmarks";
