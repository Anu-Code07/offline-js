import { BrowserNetworkMonitor, FetchTransport } from "@offlinejs/network";
import { MutationQueue } from "@offlinejs/queue";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import { SyncEngine } from "@offlinejs/sync";
import type {
  CollectionMap,
  CollectionRecord,
  CollectionSubscriber,
  EntityRecord,
  EventBus,
  NetworkMonitor,
  OfflineCollection,
  OfflineDB,
  OfflineDBOptions,
  OfflineEvents,
  OfflinePlugin,
  PaginatedResult,
  PartialEntity,
  QueryOptions,
  RecordId,
  StorageAdapter,
  SyncTransport
} from "@offlinejs/types";
import {
  assertStorageAdapter,
  assertSyncTransport,
  countQuery,
  createId,
  normalizeError,
  now
} from "@offlinejs/utils";

export class OfflineError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OfflineError";
  }
}

export class ConflictError extends OfflineError {
  constructor(message = "A sync conflict occurred", options?: ErrorOptions) {
    super(message, options);
    this.name = "ConflictError";
  }
}

export class StorageError extends OfflineError {
  constructor(message = "Storage operation failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageError";
  }
}

export class SyncError extends OfflineError {
  constructor(message = "Synchronization failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "SyncError";
  }
}

export class ValidationError extends OfflineError {
  constructor(message = "Validation failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "ValidationError";
  }
}

class TypedEventBus<TEvents extends object> implements EventBus<TEvents> {
  private readonly listeners = new Map<
    keyof TEvents,
    Set<(payload: TEvents[keyof TEvents]) => void>
  >();

  emit<TName extends keyof TEvents>(name: TName, payload: TEvents[TName]): void {
    const listeners = this.listeners.get(name);

    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  }

  on<TName extends keyof TEvents>(
    name: TName,
    listener: (payload: TEvents[TName]) => void
  ): () => void {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener as (payload: TEvents[keyof TEvents]) => void);
    this.listeners.set(name, listeners);

    return () => this.off(name, listener);
  }

  off<TName extends keyof TEvents>(name: TName, listener: (payload: TEvents[TName]) => void): void {
    this.listeners.get(name)?.delete(listener as (payload: TEvents[keyof TEvents]) => void);
  }
}

class OfflineDatabase<
  TCollections extends CollectionMap = CollectionMap
> implements OfflineDB<TCollections> {
  private readonly collections = new Map<string, OfflineDataCollection<EntityRecord>>();
  private readonly disposers: Array<() => void> = [];
  private readonly events = new TypedEventBus<OfflineEvents>();
  private readonly network: NetworkMonitor;
  private readonly queue: MutationQueue;
  private readonly storage: StorageAdapter;
  private readonly syncEngine: SyncEngine;
  private readonly transport: SyncTransport | undefined;
  private destroyed = false;

  constructor(options: OfflineDBOptions<TCollections>) {
    this.storage = options.storage ?? createMemoryStorage();
    assertStorageAdapter(this.storage);
    this.network = options.network ?? new BrowserNetworkMonitor();
    this.transport = options.transport ?? this.createTransport(options);
    if (this.transport) {
      assertSyncTransport(this.transport);
    }
    this.queue = new MutationQueue({ storage: this.storage });
    this.syncEngine = new SyncEngine({
      events: this.events,
      queue: this.queue,
      storage: this.storage,
      ...(this.transport ? { transport: this.transport } : {}),
      ...(options.sync ? { sync: options.sync } : {})
    });

    this.disposers.push(
      this.network.subscribe((state) => {
        this.events.emit(state.online ? "online" : "offline", state);

        if (!this.destroyed && state.online && options.sync?.autoStart !== false) {
          void this.sync().catch((error) => this.events.emit("error", normalizeError(error)));
        }
      })
    );

    for (const plugin of options.plugins ?? []) {
      this.use(plugin);
    }
  }

  collection<TName extends Extract<keyof TCollections, string>>(
    name: TName
  ): OfflineCollection<CollectionRecord<TCollections, TName>>;
  collection<TRecord extends EntityRecord = EntityRecord>(name: string): OfflineCollection<TRecord>;
  collection<TRecord extends EntityRecord = EntityRecord>(
    name: string
  ): OfflineCollection<TRecord> {
    const existing = this.collections.get(name);

    if (existing) {
      return existing as unknown as OfflineCollection<TRecord>;
    }

    const collection = new OfflineDataCollection<TRecord>({
      db: this,
      events: this.events,
      name,
      network: this.network,
      queue: this.queue,
      storage: this.storage,
      syncEngine: this.syncEngine
    });
    this.collections.set(name, collection as unknown as OfflineDataCollection<EntityRecord>);
    return collection;
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }

  emit<TName extends keyof OfflineEvents>(name: TName, payload: OfflineEvents[TName]): void {
    this.events.emit(name, payload);
  }

  off<TName extends keyof OfflineEvents>(
    name: TName,
    listener: (payload: OfflineEvents[TName]) => void
  ): void {
    this.events.off(name, listener);
  }

  on<TName extends keyof OfflineEvents>(
    name: TName,
    listener: (payload: OfflineEvents[TName]) => void
  ): () => void {
    return this.events.on(name, listener);
  }

  async sync(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    await this.syncEngine.sync();
  }

  async transaction<TValue>(
    run: (db: OfflineDB<TCollections>) => Promise<TValue>
  ): Promise<TValue> {
    const scopes = [...this.collections.keys()];
    return this.storage.transaction(scopes, () => run(this));
  }

  use(plugin: OfflinePlugin<TCollections>): OfflineDB<TCollections> {
    void Promise.resolve(
      plugin.setup({
        db: this,
        events: this.events,
        network: this.network,
        storage: this.storage
      })
    )
      .then((dispose) => {
        if (typeof dispose === "function") {
          if (this.destroyed) {
            dispose();
            return;
          }

          this.disposers.push(dispose);
        }
      })
      .catch((error) => this.events.emit("error", normalizeError(error)));

    return this;
  }

  private createTransport(options: OfflineDBOptions<TCollections>): SyncTransport | undefined {
    if (!options.baseURL) {
      return undefined;
    }

    return new FetchTransport({
      baseURL: options.baseURL,
      ...(options.headers ? { headers: options.headers } : {})
    });
  }
}

interface OfflineDataCollectionOptions<TCollections extends CollectionMap> {
  db: OfflineDB<TCollections>;
  events: EventBus<OfflineEvents>;
  name: string;
  network: NetworkMonitor;
  queue: MutationQueue;
  storage: StorageAdapter;
  syncEngine: SyncEngine;
}

class OfflineDataCollection<TRecord extends EntityRecord> implements OfflineCollection<TRecord> {
  private readonly db: OfflineDB;
  private readonly events: EventBus<OfflineEvents>;
  private readonly name: string;
  private readonly network: NetworkMonitor;
  private readonly queue: MutationQueue;
  private readonly storage: StorageAdapter;
  private readonly subscribers = new Set<CollectionSubscriber<TRecord>>();
  private readonly syncEngine: SyncEngine;

  constructor(options: OfflineDataCollectionOptions<CollectionMap>) {
    this.db = options.db;
    this.events = options.events;
    this.name = options.name;
    this.network = options.network;
    this.queue = options.queue;
    this.storage = options.storage;
    this.syncEngine = options.syncEngine;
  }

  async create(data: PartialEntity<TRecord>): Promise<TRecord> {
    const record = this.withMetadata({
      ...data,
      id: data.id ?? createId()
    } as TRecord);

    await this.storage.set(this.name, record);
    await this.enqueue("create", record.id, record, null);
    await this.notify();
    await this.syncIfOnline();

    return record;
  }

  async update(id: RecordId, data: PartialEntity<TRecord>): Promise<TRecord> {
    const existing = await this.findOne(id);

    if (!existing) {
      throw new ValidationError(`Cannot update missing record "${id}" in "${this.name}"`);
    }

    const updated = this.withMetadata({ ...existing, ...data, id });
    await this.storage.set(this.name, updated);
    await this.enqueue("update", id, data, existing);
    await this.notify();
    await this.syncIfOnline();

    return updated;
  }

  async delete(id: RecordId): Promise<void> {
    const existing = await this.findOne(id);
    await this.storage.delete(this.name, id);
    await this.enqueue("delete", id, undefined, existing);
    await this.notify();
    await this.syncIfOnline();
  }

  async find(query?: QueryOptions<TRecord>): Promise<TRecord[]> {
    try {
      return await this.storage.find(this.name, query);
    } catch (error) {
      throw new StorageError(`Failed to read "${this.name}"`, { cause: error });
    }
  }

  async findOne(id: RecordId): Promise<TRecord | null> {
    try {
      return await this.storage.get(this.name, id);
    } catch (error) {
      throw new StorageError(`Failed to read "${this.name}/${id}"`, { cause: error });
    }
  }

  async paginate(query: QueryOptions<TRecord> = {}): Promise<PaginatedResult<TRecord>> {
    const [data, allRecords] = await Promise.all([
      this.find(query),
      this.storage.find<TRecord>(this.name)
    ]);

    return {
      data,
      limit: query.limit ?? data.length,
      offset: query.offset ?? 0,
      total: countQuery(allRecords, query)
    };
  }

  subscribe(callback: CollectionSubscriber<TRecord>): () => void {
    this.subscribers.add(callback);
    void this.find()
      .then(callback)
      .catch((error) => this.events.emit("error", normalizeError(error)));

    return () => {
      this.subscribers.delete(callback);
    };
  }

  async sync(): Promise<void> {
    await this.syncEngine.sync(this.name);
    await this.notify();
  }

  private async enqueue(
    operation: "create" | "update" | "delete",
    recordId: string,
    payload: PartialEntity<TRecord> | undefined,
    base: TRecord | null
  ): Promise<void> {
    const mutation = await this.queue.add<TRecord>({
      base,
      collection: this.name,
      operation,
      recordId,
      ...(payload === undefined ? {} : { payload })
    });
    this.events.emit("queue:add", mutation);
  }

  private async notify(): Promise<void> {
    if (this.subscribers.size === 0) {
      return;
    }

    const records = await this.find();

    for (const subscriber of this.subscribers) {
      subscriber(records);
    }
  }

  private async syncIfOnline(): Promise<void> {
    if (!this.network.isOnline()) {
      return;
    }

    try {
      await this.syncEngine.sync(this.name);
    } catch (error) {
      this.events.emit("error", normalizeError(error));
    }
  }

  private withMetadata(record: TRecord): TRecord {
    return {
      ...record,
      updatedAt: now(),
      createdAt: record.createdAt ?? now()
    };
  }
}

export const createOfflineDB = <TCollections extends CollectionMap = CollectionMap>(
  options: OfflineDBOptions<TCollections> = {}
): OfflineDB<TCollections> => new OfflineDatabase(options);

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
} from "@offlinejs/types";
