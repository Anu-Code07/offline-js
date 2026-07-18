import type {
  EntityRecord,
  MutationOperation,
  QueueProcessingOptions,
  QueuedMutation,
  RetryOptions,
  StorageAdapter
} from "@offlinejs/types";
import { backoffDelay, createId, now } from "@offlinejs/utils";

export interface MutationQueueOptions {
  collectionName?: string;
  storage: StorageAdapter;
}

export interface AddMutationInput<TRecord extends EntityRecord = EntityRecord> {
  base?: TRecord | null;
  collection: string;
  operation: MutationOperation;
  payload?: Partial<TRecord>;
  priority?: number;
  recordId: string;
}

export const defaultRetryOptions: RetryOptions = {
  baseDelayMs: 500,
  factor: 2,
  jitter: true,
  maxAttempts: 5,
  maxDelayMs: 30_000
};

export const defaultQueueProcessingOptions: QueueProcessingOptions = {
  batchSize: 25,
  retry: defaultRetryOptions
};

export class MutationQueue {
  private readonly collectionName: string;
  private readonly storage: StorageAdapter;
  private paused = false;

  constructor(options: MutationQueueOptions) {
    this.collectionName = options.collectionName ?? "__offline_queue";
    this.storage = options.storage;
  }

  async add<TRecord extends EntityRecord>(
    input: AddMutationInput<TRecord>
  ): Promise<QueuedMutation<TRecord>> {
    const mutation: QueuedMutation<TRecord> = {
      id: createId(),
      collection: input.collection,
      operation: input.operation,
      recordId: input.recordId,
      createdAt: now(),
      priority: input.priority ?? 0,
      retries: 0,
      status: "pending"
    };

    if (input.payload !== undefined) {
      mutation.payload = input.payload;
    }

    if (input.base !== undefined) {
      mutation.base = input.base;
    }

    await this.storage.set(this.collectionName, mutation);
    return mutation;
  }

  async all(): Promise<QueuedMutation[]> {
    const mutations = await this.storage.find<QueuedMutation>(this.collectionName);

    return mutations.sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }

      return left.createdAt - right.createdAt;
    });
  }

  async due(options: QueueProcessingOptions = defaultQueueProcessingOptions): Promise<QueuedMutation[]> {
    if (this.paused) {
      return [];
    }

    const timestamp = now();
    const mutations = await this.all();

    return mutations
      .filter((mutation) => mutation.status !== "processing")
      .filter((mutation) => mutation.retries < options.retry.maxAttempts)
      .filter((mutation) => {
        if (!mutation.lastAttemptAt) {
          return true;
        }

        const delay = backoffDelay(mutation.retries, options.retry);
        return mutation.lastAttemptAt + delay <= timestamp;
      })
      .slice(0, options.batchSize);
  }

  async remove(id: string): Promise<void> {
    await this.storage.delete(this.collectionName, id);
  }

  async markAttempt(id: string, status: QueuedMutation["status"] = "failed"): Promise<QueuedMutation | null> {
    const mutation = await this.storage.get<QueuedMutation>(this.collectionName, id);

    if (!mutation) {
      return null;
    }

    const updated: QueuedMutation = {
      ...mutation,
      lastAttemptAt: now(),
      retries: mutation.retries + 1,
      status
    };

    await this.storage.set(this.collectionName, updated);
    return updated;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  async clear(): Promise<void> {
    await this.storage.clear(this.collectionName);
  }
}

export const createMutationQueue = (options: MutationQueueOptions): MutationQueue =>
  new MutationQueue(options);
