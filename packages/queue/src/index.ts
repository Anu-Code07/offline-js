import type {
  EntityRecord,
  MutationOperation,
  PartialEntity,
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
  payload?: PartialEntity<TRecord>;
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

  async due(
    options: QueueProcessingOptions = defaultQueueProcessingOptions,
    collection?: string
  ): Promise<QueuedMutation[]> {
    if (this.paused) {
      return [];
    }

    // Prefer status-filtered reads so sync does not scan the entire outbox.
    const pending = await this.storage.find<QueuedMutation>(this.collectionName, {
      filters: collection ? { status: "pending", collection } : { status: "pending" },
      orderBy: "priority",
      sort: "desc",
      limit: Math.max(options.batchSize * 4, options.batchSize)
    });
    const failed = await this.storage.find<QueuedMutation>(this.collectionName, {
      filters: collection ? { status: "failed", collection } : { status: "failed" },
      orderBy: "priority",
      sort: "desc",
      limit: Math.max(options.batchSize * 4, options.batchSize)
    });

    const candidates = [...pending, ...failed].sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      return left.createdAt - right.createdAt;
    });

    return this.selectDue(candidates, options);
  }

  /** Filter an already-loaded queue snapshot without an extra storage read. */
  selectDue(
    mutations: QueuedMutation[],
    options: QueueProcessingOptions = defaultQueueProcessingOptions
  ): QueuedMutation[] {
    if (this.paused) {
      return [];
    }

    const timestamp = now();
    const due: QueuedMutation[] = [];

    for (const mutation of mutations) {
      if (mutation.status === "processing") {
        continue;
      }

      if (mutation.retries >= options.retry.maxAttempts) {
        continue;
      }

      if (mutation.lastAttemptAt) {
        const delay = backoffDelay(mutation.retries, options.retry);
        if (mutation.lastAttemptAt + delay > timestamp) {
          continue;
        }
      }

      due.push(mutation);
      if (due.length >= options.batchSize) {
        break;
      }
    }

    return due;
  }

  async remove(id: string): Promise<void> {
    await this.storage.delete(this.collectionName, id);
  }

  async markAttempt(
    id: string,
    status: QueuedMutation["status"] = "failed"
  ): Promise<QueuedMutation | null> {
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
