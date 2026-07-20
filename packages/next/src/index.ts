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

type ServerActionSyncFn = <TRecord extends EntityRecord>(
  collection: string
) => Promise<ServerActionSyncResult<TRecord>>;

type BoundServerActionSyncFn = <TRecord extends EntityRecord>() => Promise<
  ServerActionSyncResult<TRecord>
>;

export function createServerActionSync<TCollections extends CollectionMap = CollectionMap>(
  db: OfflineDB<TCollections>
): ServerActionSyncFn;
export function createServerActionSync<TCollections extends CollectionMap = CollectionMap>(
  db: OfflineDB<TCollections>,
  collection: string
): BoundServerActionSyncFn;
export function createServerActionSync<TCollections extends CollectionMap = CollectionMap>(
  db: OfflineDB<TCollections>,
  collection?: string
): ServerActionSyncFn | BoundServerActionSyncFn {
  const syncCollection = async <TRecord extends EntityRecord>(
    name: string
  ): Promise<ServerActionSyncResult<TRecord>> => {
    try {
      const offlineCollection = db.collection<TRecord>(name);
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

  if (collection) {
    return (async () => syncCollection(collection)) as BoundServerActionSyncFn;
  }

  return syncCollection;
}

export interface CacheTagRevalidator {
  revalidateCollection(collection: string): void | Promise<void>;
  revalidateRecord(collection: string, id: string): void | Promise<void>;
  tagsFor(collection: string, id?: string): string[];
}

/** Build Next.js `revalidateTag` helpers around OfflineJS cache tags. */
export const createCacheTagRevalidator = (
  revalidateTag: (tag: string) => void | Promise<void>
): CacheTagRevalidator => ({
  revalidateCollection(collection) {
    return revalidateTag(offlineCacheTag(collection));
  },
  revalidateRecord(collection, id) {
    return revalidateTag(offlineCacheTag(collection, id));
  },
  tagsFor(collection, id) {
    return id
      ? [offlineCacheTag(collection), offlineCacheTag(collection, id)]
      : [offlineCacheTag(collection)];
  }
});

export const withOfflineCacheTags = async <TValue>(
  tags: string[],
  run: () => Promise<TValue>,
  revalidateTag?: (tag: string) => void | Promise<void>
): Promise<TValue> => {
  const value = await run();

  if (revalidateTag) {
    await Promise.all(tags.map((tag) => revalidateTag(tag)));
  }

  return value;
};
