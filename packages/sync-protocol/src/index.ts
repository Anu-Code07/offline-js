import type {
  EntityRecord,
  QueuedMutation,
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
  const conflicts: SyncProtocolPushResponse<TRecord>["conflicts"] = [];

  for (const mutation of request.mutations) {
    try {
      if (mutation.operation === "delete") {
        await store.delete(mutation.collection, mutation.recordId);
        accepted.push(mutation.id);
        continue;
      }

      if (!mutation.payload) {
        rejected.push({ id: mutation.id, reason: "Missing mutation payload" });
        continue;
      }

      const existing = await store.get(mutation.collection, mutation.recordId);
      const nextRecord = {
        ...(mutation.payload as TRecord),
        id: mutation.recordId
      };

      if (mutation.operation === "create" && existing) {
        conflicts.push(toConflict(mutation, nextRecord, existing));
        continue;
      }

      if (
        mutation.operation === "update" &&
        existing &&
        isVersionConflict(existing, mutation.payload as EntityRecord)
      ) {
        conflicts.push(toConflict(mutation, nextRecord, existing));
        continue;
      }

      await store.set(mutation.collection, nextRecord);
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
    conflicts,
    rejected
  };
};

export const handlePull = async <TRecord extends EntityRecord>(
  store: SyncProtocolStore<TRecord>,
  request: SyncProtocolPullRequest
): Promise<SyncProtocolPullResponse<TRecord>> => {
  const records = await store.list(request.collection, {
    ...(request.limit === undefined ? {} : { limit: request.limit }),
    ...(request.since === undefined ? {} : { since: request.since })
  });
  const last = records[records.length - 1];
  const cursor =
    last && (last.updatedAt !== undefined || last.version !== undefined || last.id)
      ? String(last.updatedAt ?? last.version ?? last.id)
      : undefined;

  return {
    records,
    ...(cursor === undefined ? {} : { cursor })
  };
};

const toConflict = <TRecord extends EntityRecord>(
  mutation: SyncProtocolMutation<TRecord>,
  client: TRecord,
  server: TRecord
): SyncProtocolPushResponse<TRecord>["conflicts"][number] => ({
  client,
  collection: mutation.collection,
  mutation: toQueuedMutation(mutation, client),
  server
});

const toQueuedMutation = <TRecord extends EntityRecord>(
  mutation: SyncProtocolMutation<TRecord>,
  client: TRecord
): QueuedMutation<TRecord> => ({
  id: mutation.id,
  collection: mutation.collection,
  createdAt: Date.now(),
  operation: mutation.operation,
  payload: mutation.payload ?? client,
  priority: 0,
  recordId: mutation.recordId,
  retries: 0,
  status: "processing"
});

const isVersionConflict = (server: EntityRecord, client: EntityRecord): boolean => {
  const serverVersion = Number(server.updatedAt ?? server.version ?? Number.NaN);
  const clientVersion = Number(client.updatedAt ?? client.version ?? Number.NaN);

  if (Number.isNaN(serverVersion) || Number.isNaN(clientVersion)) {
    return false;
  }

  return serverVersion > clientVersion;
};
