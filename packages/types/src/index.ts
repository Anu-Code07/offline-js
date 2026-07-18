export type RecordId = string;

export type EntityRecord = {
  id: RecordId;
  [key: string]: unknown;
};

export type PartialEntity<TRecord extends EntityRecord> = Partial<Omit<TRecord, "id">> & {
  id?: RecordId;
};

export type SortDirection = "asc" | "desc";

export type QueryFilterValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | {
      eq?: unknown;
      ne?: unknown;
      gt?: number | string;
      gte?: number | string;
      lt?: number | string;
      lte?: number | string;
      in?: unknown[];
      contains?: string;
    };

export type QueryFilters<TRecord extends EntityRecord = EntityRecord> = Partial<
  Record<keyof TRecord, QueryFilterValue>
>;

export interface QueryOptions<TRecord extends EntityRecord = EntityRecord> {
  filters?: QueryFilters<TRecord>;
  limit?: number;
  offset?: number;
  orderBy?: keyof TRecord | string;
  search?: string;
  searchFields?: Array<keyof TRecord | string>;
  sort?: SortDirection;
}

export interface PaginatedResult<TRecord extends EntityRecord> {
  data: TRecord[];
  limit: number;
  offset: number;
  total: number;
}

export interface TransactionStore {
  get<TRecord extends EntityRecord>(collection: string, id: RecordId): Promise<TRecord | null>;
  set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void>;
  delete(collection: string, id: RecordId): Promise<void>;
  find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]>;
  clear(collection?: string): Promise<void>;
}

export interface StorageMigration {
  name: string;
  up(storage: TransactionStore): Promise<void>;
}

export interface StorageAdapter {
  readonly name: string;
  get<TRecord extends EntityRecord>(collection: string, id: RecordId): Promise<TRecord | null>;
  set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void>;
  delete(collection: string, id: RecordId): Promise<void>;
  find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]>;
  clear(collection?: string): Promise<void>;
  transaction<TValue>(scope: string[], run: (store: TransactionStore) => Promise<TValue>): Promise<TValue>;
  migrate?(migrations: StorageMigration[]): Promise<void>;
}

export type MutationOperation = "create" | "update" | "delete";

export interface QueuedMutation<TRecord extends EntityRecord = EntityRecord> extends EntityRecord {
  collection: string;
  operation: MutationOperation;
  recordId: RecordId;
  payload?: PartialEntity<TRecord>;
  base?: TRecord | null;
  createdAt: number;
  lastAttemptAt?: number;
  priority: number;
  retries: number;
  status: "pending" | "processing" | "failed";
}

export interface RetryOptions {
  baseDelayMs: number;
  factor: number;
  jitter: boolean;
  maxAttempts: number;
  maxDelayMs: number;
}

export interface QueueProcessingOptions {
  batchSize: number;
  retry: RetryOptions;
}

export interface NetworkState {
  online: boolean;
  since: number;
}

export interface NetworkMonitor {
  getState(): NetworkState;
  isOnline(): boolean;
  subscribe(listener: (state: NetworkState) => void): () => void;
}

export interface TransportRequest<TBody = unknown> {
  body?: TBody;
  headers?: Record<string, string>;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export interface TransportResponse<TData = unknown> {
  data: TData;
  etag?: string;
  status: number;
}

export interface SyncTransport {
  request<TData = unknown, TBody = unknown>(
    request: TransportRequest<TBody>
  ): Promise<TransportResponse<TData>>;
}

export type ConflictStrategy<TRecord extends EntityRecord = EntityRecord> =
  | "clientWins"
  | "serverWins"
  | "lastWriteWins"
  | "merge"
  | ConflictResolver<TRecord>;

export interface ConflictContext<TRecord extends EntityRecord = EntityRecord> {
  client: TRecord | null;
  collection: string;
  mutation: QueuedMutation<TRecord>;
  server: TRecord | null;
}

export type ConflictResolver<TRecord extends EntityRecord = EntityRecord> = (
  context: ConflictContext<TRecord>
) => Promise<TRecord | null> | TRecord | null;

export interface SyncOptions<TRecord extends EntityRecord = EntityRecord> {
  autoStart?: boolean;
  batchSize?: number;
  conflictStrategy?: ConflictStrategy<TRecord>;
  deltaField?: string;
  enabled?: boolean;
  pull?: boolean;
  push?: boolean;
  retry?: Partial<RetryOptions>;
}

export interface OfflineEvents {
  "sync:start": { mode: "push" | "pull" | "full"; queued: number };
  "sync:end": { completed: number; failed: number };
  offline: NetworkState;
  online: NetworkState;
  "queue:add": QueuedMutation;
  "queue:complete": QueuedMutation;
  conflict: ConflictContext;
  error: Error;
}

export type OfflineEventName = keyof OfflineEvents;

export interface EventBus<TEvents extends Record<string, unknown> = OfflineEvents> {
  emit<TName extends keyof TEvents>(name: TName, payload: TEvents[TName]): void;
  off<TName extends keyof TEvents>(name: TName, listener: (payload: TEvents[TName]) => void): void;
  on<TName extends keyof TEvents>(
    name: TName,
    listener: (payload: TEvents[TName]) => void
  ): () => void;
}

export type CollectionSubscriber<TRecord extends EntityRecord> = (records: TRecord[]) => void;

export interface OfflineCollection<TRecord extends EntityRecord> {
  create(data: PartialEntity<TRecord>): Promise<TRecord>;
  delete(id: RecordId): Promise<void>;
  find(query?: QueryOptions<TRecord>): Promise<TRecord[]>;
  findOne(id: RecordId): Promise<TRecord | null>;
  paginate(query?: QueryOptions<TRecord>): Promise<PaginatedResult<TRecord>>;
  subscribe(callback: CollectionSubscriber<TRecord>): () => void;
  sync(): Promise<void>;
  update(id: RecordId, data: PartialEntity<TRecord>): Promise<TRecord>;
}

export type CollectionMap = object;

export type CollectionRecord<
  TCollections extends CollectionMap,
  TName extends keyof TCollections
> = TCollections[TName] extends EntityRecord ? TCollections[TName] : EntityRecord;

export interface OfflineDB<TCollections extends CollectionMap = CollectionMap>
  extends EventBus<OfflineEvents> {
  collection<TName extends Extract<keyof TCollections, string>>(
    name: TName
  ): OfflineCollection<CollectionRecord<TCollections, TName>>;
  collection<TRecord extends EntityRecord = EntityRecord>(name: string): OfflineCollection<TRecord>;
  destroy(): Promise<void>;
  sync(): Promise<void>;
  transaction<TValue>(run: (db: OfflineDB<TCollections>) => Promise<TValue>): Promise<TValue>;
  use(plugin: OfflinePlugin<TCollections>): OfflineDB<TCollections>;
}

export interface OfflinePluginContext<TCollections extends CollectionMap = CollectionMap> {
  db: OfflineDB<TCollections>;
  events: EventBus<OfflineEvents>;
  network: NetworkMonitor;
  storage: StorageAdapter;
}

export interface OfflinePlugin<TCollections extends CollectionMap = CollectionMap> {
  name: string;
  setup(context: OfflinePluginContext<TCollections>): void | (() => void) | Promise<void | (() => void)>;
}

export interface OfflineDBOptions<TCollections extends CollectionMap = CollectionMap> {
  baseURL?: string;
  headers?: Record<string, string> | (() => Promise<Record<string, string>> | Record<string, string>);
  network?: NetworkMonitor;
  plugins?: Array<OfflinePlugin<TCollections>>;
  storage?: StorageAdapter;
  sync?: SyncOptions;
  transport?: SyncTransport;
}
