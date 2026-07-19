import { createOfflineDB } from "@offlinejs/core";
import type { CollectionMap, OfflineDB, OfflineDBOptions, EntityRecord } from "@offlinejs/core";

export const createOfflineRouteClient = <TCollections extends CollectionMap = CollectionMap>(
  options: OfflineDBOptions<TCollections>
): OfflineDB<TCollections> => createOfflineDB(options);

export const isServerRuntime = (): boolean => typeof globalThis.window === "undefined";

export const offlineCacheTag = (collection: string, id?: string): string =>
  id ? `offlinejs:${collection}:${id}` : `offlinejs:${collection}`;

export interface ServerActionSyncResult<TRecord extends EntityRecord = EntityRecord> {
  errors: string[];
  records: TRecord[];
  success: boolean;
}

export const createServerActionSync = <TCollections extends CollectionMap = CollectionMap>(
  db: OfflineDB<TCollections>
) => {
  return async <TRecord extends EntityRecord>(
    collection: string
  ): Promise<ServerActionSyncResult<TRecord>> => {
    try {
      const offlineCollection = db.collection<TRecord>(collection);
      await offlineCollection.sync();

      return {
        errors: [],
        records: await offlineCollection.find(),
        success: true
      };
    } catch (error) {
      return {
        errors: [error instanceof Error ? error.message : "Unknown sync error"],
        records: [],
        success: false
      };
    }
  };
};
