import { defaultQueueProcessingOptions, type MutationQueue } from "@offlinejs/queue";
import {
  ConflictStrategyName,
  type ConflictContext,
  type ConflictStrategy,
  type EntityRecord,
  type EventBus,
  type OfflineEvents,
  type QueuedMutation,
  type QueueProcessingOptions,
  type StorageAdapter,
  type SyncOptions,
  type SyncTransport,
  type TransportRequest
} from "@offlinejs/types";

export interface SyncEngineOptions {
  events: EventBus<OfflineEvents>;
  queue: MutationQueue;
  storage: StorageAdapter;
  sync?: SyncOptions;
  transport?: SyncTransport;
}

export interface SyncResult {
  completed: number;
  failed: number;
}

export class SyncEngine {
  private readonly events: EventBus<OfflineEvents>;
  private readonly queue: MutationQueue;
  private readonly storage: StorageAdapter;
  private readonly syncOptions: SyncOptions;
  private readonly transport: SyncTransport | undefined;
  private running = false;

  constructor(options: SyncEngineOptions) {
    this.events = options.events;
    this.queue = options.queue;
    this.storage = options.storage;
    this.syncOptions = options.sync ?? {};
    this.transport = options.transport;
  }

  async sync(collection?: string): Promise<SyncResult> {
    if (this.running || this.syncOptions.enabled === false || !this.transport) {
      return { completed: 0, failed: 0 };
    }

    this.running = true;
    const options = this.processingOptions();
    const due = await this.queue.due(options, collection);
    this.events.emit("sync:start", { mode: "full", queued: due.length });

    try {
      const pushResult =
        this.syncOptions.push === false
          ? { completed: 0, failed: 0 }
          : await this.pushDue(due, options);

      if (this.syncOptions.pull !== false && collection) {
        await this.pull(collection);
      }

      this.events.emit("sync:end", pushResult);
      return pushResult;
    } finally {
      this.running = false;
    }
  }

  async pull<TRecord extends EntityRecord>(
    collection: string,
    since?: string | number
  ): Promise<TRecord[]> {
    if (!this.transport) {
      return [];
    }

    const response = await this.transport.request<TRecord[]>({
      method: "GET",
      path: `/${collection}`,
      ...(since === undefined ? {} : { query: { since } })
    });
    const records = Array.isArray(response.data) ? response.data : [];

    if (records.length === 0) {
      return records;
    }

    if (typeof this.storage.setMany === "function") {
      await this.storage.setMany(collection, records);
      return records;
    }

    await this.storage.transaction([collection], async (store) => {
      if (typeof store.setMany === "function") {
        await store.setMany(collection, records);
        return;
      }
      for (const record of records) {
        await store.set(collection, record);
      }
    });

    return records;
  }

  private async pushDue(
    due: QueuedMutation[],
    options: QueueProcessingOptions
  ): Promise<SyncResult> {
    let completed = 0;
    let failed = 0;
    const concurrency = Math.min(4, Math.max(1, options.batchSize));

    for (let index = 0; index < due.length; index += concurrency) {
      const slice = due.slice(index, index + concurrency);
      const results = await Promise.all(
        slice.map(async (mutation) => {
          try {
            await this.pushMutation(mutation);
            await this.queue.remove(mutation.id);
            this.events.emit("queue:complete", mutation);
            return "completed" as const;
          } catch (error) {
            await this.queue.markAttempt(mutation.id);
            this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
            return "failed" as const;
          }
        })
      );

      for (const result of results) {
        if (result === "completed") {
          completed += 1;
        } else {
          failed += 1;
        }
      }
    }

    return { completed, failed };
  }

  private async pushMutation(mutation: QueuedMutation): Promise<void> {
    if (!this.transport) {
      return;
    }

    const request = this.requestForMutation(mutation);

    try {
      const response = await this.transport.request<EntityRecord | null>(request);

      if (response.data && mutation.operation !== "delete") {
        await this.storage.set(mutation.collection, response.data);
      }
    } catch (error) {
      if (!isConflictError(error)) {
        throw error;
      }

      await this.resolveConflict(mutation, error.data as EntityRecord | null);
    }
  }

  private async resolveConflict(
    mutation: QueuedMutation,
    server: EntityRecord | null
  ): Promise<void> {
    const client = await this.storage.get<EntityRecord>(mutation.collection, mutation.recordId);
    const context: ConflictContext = {
      client,
      collection: mutation.collection,
      mutation,
      server
    };
    const resolved = await resolveConflictStrategy(
      this.syncOptions.conflictStrategy ?? ConflictStrategyName.LastWriteWins,
      context
    );

    this.events.emit("conflict", context);

    if (resolved) {
      await this.storage.set(mutation.collection, resolved);
      await this.transport?.request({
        body: resolved,
        method: "PUT",
        path: `/${mutation.collection}/${mutation.recordId}`
      });
      return;
    }

    await this.storage.delete(mutation.collection, mutation.recordId);
  }

  private requestForMutation(mutation: QueuedMutation): TransportRequest {
    if (mutation.operation === "create") {
      return {
        body: mutation.payload,
        method: "POST",
        path: `/${mutation.collection}`
      };
    }

    if (mutation.operation === "update") {
      return {
        body: mutation.payload,
        method: "PATCH",
        path: `/${mutation.collection}/${mutation.recordId}`
      };
    }

    return {
      method: "DELETE",
      path: `/${mutation.collection}/${mutation.recordId}`
    };
  }

  private processingOptions(): QueueProcessingOptions {
    return {
      batchSize: this.syncOptions.batchSize ?? defaultQueueProcessingOptions.batchSize,
      retry: {
        ...defaultQueueProcessingOptions.retry,
        ...this.syncOptions.retry
      }
    };
  }
}

export const resolveConflictStrategy = async (
  strategy: ConflictStrategy,
  context: ConflictContext
): Promise<EntityRecord | null> => {
  if (typeof strategy === "function") {
    return strategy(context);
  }

  if (strategy === ConflictStrategyName.ClientWins) {
    return context.client;
  }

  if (strategy === ConflictStrategyName.ServerWins) {
    return context.server;
  }

  if (strategy === ConflictStrategyName.Merge) {
    return context.server || context.client
      ? {
          ...(context.server ?? {}),
          ...(context.client ?? {}),
          id: context.client?.id ?? context.server?.id ?? context.mutation.recordId
        }
      : null;
  }

  const clientUpdatedAt = Number(context.client?.updatedAt ?? context.client?.createdAt ?? 0);
  const serverUpdatedAt = Number(context.server?.updatedAt ?? context.server?.createdAt ?? 0);

  return clientUpdatedAt >= serverUpdatedAt ? context.client : context.server;
};

const isConflictError = (error: unknown): error is Error & { data?: unknown; status: number } =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  (error as { status: number }).status === 409;

export const createSyncEngine = (options: SyncEngineOptions): SyncEngine => new SyncEngine(options);
