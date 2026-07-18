import { createOfflineDB } from "@offlinejs/core";
import type { CollectionMap, OfflineDB, OfflineDBOptions } from "@offlinejs/core";

export const createOfflineRouteClient = <TCollections extends CollectionMap = CollectionMap>(
  options: OfflineDBOptions<TCollections>
): OfflineDB<TCollections> => createOfflineDB(options);

export const isServerRuntime = (): boolean => typeof globalThis.window === "undefined";
