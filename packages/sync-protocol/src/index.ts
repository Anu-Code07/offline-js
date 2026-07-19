import type {
  EntityRecord,
  SyncProtocolMutation,
  SyncProtocolPullRequest,
  SyncProtocolPullResponse,
  SyncProtocolPushRequest,
  SyncProtocolPushResponse
} from "@offlinejs/types";

export interface SyncProtocolStore<TRecord extends EntityRecord = EntityRecord> {
  delete(collection: string, id: string): Promise<void>;
  get(collection: string, id: string): Promise<TRecord | null>;
  list(
    collection: string,
    options?: { limit?: number; since?: string | number }
  ): Promise<TRecord[]>;
  set(collection: string, record: TRecord): Promise<TRecord>;
}

export const createPushRequest = <TRecord extends EntityRecord>(
  clientId: string,
  mutations: Array<SyncProtocolMutation<TRecord>>,
  since?: string | number
): SyncProtocolPushRequest<TRecord> => ({
  clientId,
  mutations,
  ...(since === undefined ? {} : { since })
});

export const createPullRequest = (
  clientId: string,
  collection: string,
  options: Omit<SyncProtocolPullRequest, "clientId" | "collection"> = {}
): SyncProtocolPullRequest => ({
  clientId,
  collection,
  ...options
});

export const handlePush = async <TRecord extends EntityRecord>(
  store: SyncProtocolStore<TRecord>,
  request: SyncProtocolPushRequest<TRecord>
): Promise<SyncProtocolPushResponse<TRecord>> => {
  const accepted: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const mutation of request.mutations) {
    try {
      if (mutation.operation === "delete") {
        await store.delete(mutation.collection, mutation.recordId);
      } else if (mutation.payload) {
        await store.set(mutation.collection, {
          ...(mutation.payload as TRecord),
          id: mutation.recordId
        });
      }

      accepted.push(mutation.id);
    } catch (error) {
      rejected.push({
        id: mutation.id,
        reason: error instanceof Error ? error.message : "Unknown sync protocol failure"
      });
    }
  }

  return {
    accepted,
    conflicts: [],
    rejected
  };
};

export const handlePull = async <TRecord extends EntityRecord>(
  store: SyncProtocolStore<TRecord>,
  request: SyncProtocolPullRequest
): Promise<SyncProtocolPullResponse<TRecord>> => ({
  records: await store.list(request.collection, {
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.since === undefined ? {} : { since: request.since })
  })
});
