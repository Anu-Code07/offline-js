// packages/types/src/index.ts
var STORAGE_ADAPTER_CONTRACT_VERSION = 1;
var SYNC_TRANSPORT_CONTRACT_VERSION = 1;

// packages/utils/src/index.ts
var now = () => Date.now();
var createId = () => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }
  return `offline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};
var clone = (value) => {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};
var normalizeError = (error) => {
  if (error instanceof Error) {
    return error;
  }
  return new Error(typeof error === "string" ? error : "Unknown OfflineJS error");
};
var assertStorageAdapter = (adapter) => {
  const requiredMethods = [
    "get",
    "set",
    "delete",
    "find",
    "clear",
    "transaction"
  ];
  if (!adapter.name) {
    throw new Error("OfflineJS storage adapter requires a stable name");
  }
  for (const method of requiredMethods) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`OfflineJS storage adapter "${adapter.name}" is missing ${String(method)}()`);
    }
  }
  if (adapter.contractVersion !== void 0 && adapter.contractVersion !== STORAGE_ADAPTER_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported storage adapter contract ${adapter.contractVersion}; expected ${STORAGE_ADAPTER_CONTRACT_VERSION}`
    );
  }
};
var assertSyncTransport = (transport) => {
  if (typeof transport.request !== "function") {
    throw new Error("OfflineJS sync transport requires request()");
  }
  if (transport.contractVersion !== void 0 && transport.contractVersion !== SYNC_TRANSPORT_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported sync transport contract ${transport.contractVersion}; expected ${SYNC_TRANSPORT_CONTRACT_VERSION}`
    );
  }
};
var toQueryString = (query) => {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== void 0) {
      params.set(key, String(value));
    }
  }
  const result = params.toString();
  return result.length > 0 ? `?${result}` : "";
};
var backoffDelay = (attempt, options) => {
  const exponentialDelay = Math.min(
    options.baseDelayMs * options.factor ** Math.max(0, attempt - 1),
    options.maxDelayMs
  );
  if (!options.jitter) {
    return exponentialDelay;
  }
  return Math.round(exponentialDelay * (0.5 + Math.random() * 0.5));
};
var matchesQuery = (record, query = {}) => {
  if (query.filters && !matchesFilters(record, query.filters)) {
    return false;
  }
  if (!query.search) {
    return true;
  }
  const search = query.search.toLowerCase();
  const fields = query.searchFields?.map((field) => String(field)) ?? Object.keys(record);
  return fields.some(
    (field) => String(record[field] ?? "").toLowerCase().includes(search)
  );
};
var applyQuery = (records, query = {}) => {
  const filtered = records.filter((record) => matchesQuery(record, query));
  const sorted = sortRecords(filtered, query);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit ?? sorted.length;
  return sorted.slice(offset, offset + limit);
};
var countQuery = (records, query = {}) => records.filter((record) => matchesQuery(record, query)).length;
var sortRecords = (records, query) => {
  if (!query.orderBy) {
    return [...records];
  }
  const direction = query.sort === "desc" ? -1 : 1;
  const key = String(query.orderBy);
  return [...records].sort((left, right) => {
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue === rightValue) {
      return 0;
    }
    if (leftValue === void 0 || leftValue === null) {
      return -1 * direction;
    }
    if (rightValue === void 0 || rightValue === null) {
      return direction;
    }
    return leftValue > rightValue ? direction : -direction;
  });
};
var matchesFilters = (record, filters) => {
  for (const [field, expected] of Object.entries(filters)) {
    const actual = record[field];
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) {
        return false;
      }
      continue;
    }
    if (expected && typeof expected === "object") {
      if (!matchesOperator(actual, expected)) {
        return false;
      }
      continue;
    }
    if (actual !== expected) {
      return false;
    }
  }
  return true;
};
var matchesOperator = (actual, expected) => {
  if ("eq" in expected && actual !== expected.eq) {
    return false;
  }
  if ("ne" in expected && actual === expected.ne) {
    return false;
  }
  if ("gt" in expected && !isGreaterThan(actual, expected.gt)) {
    return false;
  }
  if ("gte" in expected && !isGreaterThanOrEqual(actual, expected.gte)) {
    return false;
  }
  if ("lt" in expected && !isLessThan(actual, expected.lt)) {
    return false;
  }
  if ("lte" in expected && !isLessThanOrEqual(actual, expected.lte)) {
    return false;
  }
  if ("in" in expected && !expected.in?.includes(actual)) {
    return false;
  }
  if ("contains" in expected) {
    return String(actual ?? "").toLowerCase().includes(String(expected.contains).toLowerCase());
  }
  return true;
};
var isComparable = (value) => typeof value === "number" || typeof value === "string";
var isGreaterThan = (actual, expected) => isComparable(actual) && expected !== void 0 && actual > expected;
var isGreaterThanOrEqual = (actual, expected) => isComparable(actual) && expected !== void 0 && actual >= expected;
var isLessThan = (actual, expected) => isComparable(actual) && expected !== void 0 && actual < expected;
var isLessThanOrEqual = (actual, expected) => isComparable(actual) && expected !== void 0 && actual <= expected;

// packages/network/src/index.ts
var BrowserNetworkMonitor = class {
  listeners = /* @__PURE__ */ new Set();
  state;
  constructor(options = {}) {
    const navigatorOnline = typeof globalThis.navigator !== "undefined" ? globalThis.navigator.onLine : true;
    this.state = {
      online: options.initialOnline ?? navigatorOnline,
      since: Date.now()
    };
    globalThis.addEventListener?.("online", this.handleOnline);
    globalThis.addEventListener?.("offline", this.handleOffline);
  }
  getState() {
    return { ...this.state };
  }
  isOnline() {
    return this.state.online;
  }
  setOnline(online) {
    this.update(online);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }
  destroy() {
    globalThis.removeEventListener?.("online", this.handleOnline);
    globalThis.removeEventListener?.("offline", this.handleOffline);
    this.listeners.clear();
  }
  handleOnline = () => {
    this.update(true);
  };
  handleOffline = () => {
    this.update(false);
  };
  update(online) {
    if (this.state.online === online) {
      return;
    }
    this.state = { online, since: Date.now() };
    for (const listener of this.listeners) {
      listener(this.getState());
    }
  }
};
var FetchTransport = class {
  contractVersion = SYNC_TRANSPORT_CONTRACT_VERSION;
  baseURL;
  fetchImplementation;
  headers;
  middlewares;
  timeoutMs;
  constructor(options) {
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.headers = options.headers;
    this.middlewares = options.middlewares ?? [];
    this.timeoutMs = options.timeoutMs;
    if (!this.fetchImplementation) {
      throw new Error("A fetch implementation is required for this runtime");
    }
  }
  async request(request) {
    const preparedRequest = await this.applyMiddlewares(request);
    const headers = {
      "content-type": "application/json",
      ...await this.resolveHeaders(),
      ...preparedRequest.headers
    };
    const timeoutMs = preparedRequest.timeoutMs ?? this.timeoutMs;
    const controller = timeoutMs ? new AbortController() : void 0;
    const timeoutId = timeoutMs ? globalThis.setTimeout(() => controller?.abort(), timeoutMs) : void 0;
    try {
      const response = await this.fetchImplementation(
        `${this.baseURL}${preparedRequest.path}${toQueryString(preparedRequest.query)}`,
        {
          headers,
          method: preparedRequest.method,
          ...controller ? { signal: controller.signal } : {},
          ...preparedRequest.body === void 0 ? {} : { body: JSON.stringify(preparedRequest.body) }
        }
      );
      const text = await response.text();
      const data = text.length > 0 ? JSON.parse(text) : void 0;
      if (!response.ok) {
        const error = new Error(`Request failed with status ${response.status}`);
        Object.assign(error, { data, status: response.status });
        throw error;
      }
      return {
        data,
        status: response.status,
        ...response.headers.get("etag") ? { etag: response.headers.get("etag") } : {}
      };
    } finally {
      if (timeoutId) {
        globalThis.clearTimeout(timeoutId);
      }
    }
  }
  async resolveHeaders() {
    if (!this.headers) {
      return {};
    }
    return typeof this.headers === "function" ? this.headers() : this.headers;
  }
  async applyMiddlewares(request) {
    let nextRequest = request;
    for (const middleware of this.middlewares) {
      nextRequest = await middleware({ request: nextRequest });
    }
    return nextRequest;
  }
};

// packages/queue/src/index.ts
var defaultRetryOptions = {
  baseDelayMs: 500,
  factor: 2,
  jitter: true,
  maxAttempts: 5,
  maxDelayMs: 3e4
};
var defaultQueueProcessingOptions = {
  batchSize: 25,
  retry: defaultRetryOptions
};
var MutationQueue = class {
  collectionName;
  storage;
  paused = false;
  constructor(options) {
    this.collectionName = options.collectionName ?? "__offline_queue";
    this.storage = options.storage;
  }
  async add(input) {
    const mutation = {
      id: createId(),
      collection: input.collection,
      operation: input.operation,
      recordId: input.recordId,
      createdAt: now(),
      priority: input.priority ?? 0,
      retries: 0,
      status: "pending"
    };
    if (input.payload !== void 0) {
      mutation.payload = input.payload;
    }
    if (input.base !== void 0) {
      mutation.base = input.base;
    }
    await this.storage.set(this.collectionName, mutation);
    return mutation;
  }
  async all() {
    const mutations = await this.storage.find(this.collectionName);
    return mutations.sort((left, right) => {
      if (left.priority !== right.priority) {
        return right.priority - left.priority;
      }
      return left.createdAt - right.createdAt;
    });
  }
  async due(options = defaultQueueProcessingOptions) {
    if (this.paused) {
      return [];
    }
    const timestamp = now();
    const mutations = await this.all();
    return mutations.filter((mutation) => mutation.status !== "processing").filter((mutation) => mutation.retries < options.retry.maxAttempts).filter((mutation) => {
      if (!mutation.lastAttemptAt) {
        return true;
      }
      const delay2 = backoffDelay(mutation.retries, options.retry);
      return mutation.lastAttemptAt + delay2 <= timestamp;
    }).slice(0, options.batchSize);
  }
  async remove(id) {
    await this.storage.delete(this.collectionName, id);
  }
  async markAttempt(id, status = "failed") {
    const mutation = await this.storage.get(this.collectionName, id);
    if (!mutation) {
      return null;
    }
    const updated = {
      ...mutation,
      lastAttemptAt: now(),
      retries: mutation.retries + 1,
      status
    };
    await this.storage.set(this.collectionName, updated);
    return updated;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  isPaused() {
    return this.paused;
  }
  async clear() {
    await this.storage.clear(this.collectionName);
  }
};

// packages/storage-memory/src/index.ts
var MemoryStorageAdapter = class {
  name;
  contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  capabilities = {
    indexes: true,
    migrations: true,
    persistence: "ephemeral",
    transactions: "atomic"
  };
  records = /* @__PURE__ */ new Map();
  indexes = /* @__PURE__ */ new Map();
  appliedMigrations = /* @__PURE__ */ new Set();
  constructor(options = {}) {
    this.name = options.name ?? "memory";
    for (const [collection, records] of Object.entries(options.seed ?? {})) {
      this.records.set(collection, new Map(records.map((record) => [record.id, clone(record)])));
    }
  }
  async get(collection, id) {
    const record = this.records.get(collection)?.get(id);
    return record ? clone(record) : null;
  }
  async set(collection, value) {
    this.ensureCollection(collection).set(value.id, clone(value));
  }
  async delete(collection, id) {
    this.records.get(collection)?.delete(id);
  }
  async find(collection, query) {
    const records = [...this.records.get(collection)?.values() ?? []].map(
      (record) => clone(record)
    );
    return applyQuery(records, query);
  }
  async clear(collection) {
    if (collection) {
      this.records.delete(collection);
      this.indexes.delete(collection);
      return;
    }
    this.records.clear();
    this.indexes.clear();
  }
  async createIndex(definition) {
    const collectionIndexes = this.indexes.get(definition.collection) ?? /* @__PURE__ */ new Map();
    collectionIndexes.set(definition.name, clone(definition));
    this.indexes.set(definition.collection, collectionIndexes);
  }
  async dropIndex(collection, name) {
    this.indexes.get(collection)?.delete(name);
  }
  async listIndexes(collection) {
    if (collection) {
      return [...this.indexes.get(collection)?.values() ?? []].map((index) => clone(index));
    }
    return [...this.indexes.values()].flatMap(
      (indexes) => [...indexes.values()].map((index) => clone(index))
    );
  }
  async transaction(scope, run) {
    const snapshot = /* @__PURE__ */ new Map();
    for (const collection of scope) {
      snapshot.set(collection, new Map(this.records.get(collection) ?? []));
    }
    try {
      return await run(this);
    } catch (error) {
      for (const collection of scope) {
        const records = snapshot.get(collection);
        if (records) {
          this.records.set(collection, records);
        } else {
          this.records.delete(collection);
        }
      }
      throw error;
    }
  }
  async migrate(migrations) {
    for (const migration of migrations) {
      if (this.appliedMigrations.has(migration.name)) {
        continue;
      }
      await this.transaction(["__migrations"], async (store) => {
        await migration.up(store);
        this.appliedMigrations.add(migration.name);
      });
    }
  }
  ensureCollection(collection) {
    const existing = this.records.get(collection);
    if (existing) {
      return existing;
    }
    const records = /* @__PURE__ */ new Map();
    this.records.set(collection, records);
    return records;
  }
};
var createMemoryStorage = (options) => new MemoryStorageAdapter(options);

// packages/sync/src/index.ts
var SyncEngine = class {
  events;
  queue;
  storage;
  syncOptions;
  transport;
  running = false;
  constructor(options) {
    this.events = options.events;
    this.queue = options.queue;
    this.storage = options.storage;
    this.syncOptions = options.sync ?? {};
    this.transport = options.transport;
  }
  async sync(collection) {
    if (this.running || this.syncOptions.enabled === false || !this.transport) {
      return { completed: 0, failed: 0 };
    }
    this.running = true;
    const queued = await this.queue.all();
    this.events.emit("sync:start", { mode: "full", queued: queued.length });
    try {
      const pushResult = this.syncOptions.push === false ? { completed: 0, failed: 0 } : await this.push(collection);
      if (this.syncOptions.pull !== false && collection) {
        await this.pull(collection);
      }
      this.events.emit("sync:end", pushResult);
      return pushResult;
    } finally {
      this.running = false;
    }
  }
  async pull(collection, since) {
    if (!this.transport) {
      return [];
    }
    const response = await this.transport.request({
      method: "GET",
      path: `/${collection}`,
      ...since === void 0 ? {} : { query: { since } }
    });
    const records = Array.isArray(response.data) ? response.data : [];
    await this.storage.transaction([collection], async (store) => {
      for (const record of records) {
        await store.set(collection, record);
      }
    });
    return records;
  }
  async push(collection) {
    const options = this.processingOptions();
    const due = (await this.queue.due(options)).filter(
      (mutation) => !collection || mutation.collection === collection
    );
    let completed = 0;
    let failed = 0;
    for (const mutation of due) {
      try {
        await this.pushMutation(mutation);
        await this.queue.remove(mutation.id);
        this.events.emit("queue:complete", mutation);
        completed += 1;
      } catch (error) {
        await this.queue.markAttempt(mutation.id);
        this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
        failed += 1;
      }
    }
    return { completed, failed };
  }
  async pushMutation(mutation) {
    if (!this.transport) {
      return;
    }
    const request = this.requestForMutation(mutation);
    try {
      const response = await this.transport.request(request);
      if (response.data && mutation.operation !== "delete") {
        await this.storage.set(mutation.collection, response.data);
      }
    } catch (error) {
      if (!isConflictError(error)) {
        throw error;
      }
      await this.resolveConflict(mutation, error.data);
    }
  }
  async resolveConflict(mutation, server) {
    const client = await this.storage.get(mutation.collection, mutation.recordId);
    const context = {
      client,
      collection: mutation.collection,
      mutation,
      server
    };
    const resolved = await resolveConflictStrategy(
      this.syncOptions.conflictStrategy ?? "lastWriteWins" /* LastWriteWins */,
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
  requestForMutation(mutation) {
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
  processingOptions() {
    return {
      batchSize: this.syncOptions.batchSize ?? defaultQueueProcessingOptions.batchSize,
      retry: {
        ...defaultQueueProcessingOptions.retry,
        ...this.syncOptions.retry
      }
    };
  }
};
var resolveConflictStrategy = async (strategy, context) => {
  if (typeof strategy === "function") {
    return strategy(context);
  }
  if (strategy === "clientWins" /* ClientWins */) {
    return context.client;
  }
  if (strategy === "serverWins" /* ServerWins */) {
    return context.server;
  }
  if (strategy === "merge" /* Merge */) {
    return context.server || context.client ? {
      ...context.server ?? {},
      ...context.client ?? {},
      id: context.client?.id ?? context.server?.id ?? context.mutation.recordId
    } : null;
  }
  const clientUpdatedAt = Number(context.client?.updatedAt ?? context.client?.createdAt ?? 0);
  const serverUpdatedAt = Number(context.server?.updatedAt ?? context.server?.createdAt ?? 0);
  return clientUpdatedAt >= serverUpdatedAt ? context.client : context.server;
};
var isConflictError = (error) => typeof error === "object" && error !== null && "status" in error && error.status === 409;

// packages/core/src/index.ts
var OfflineError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "OfflineError";
  }
};
var StorageError = class extends OfflineError {
  constructor(message = "Storage operation failed", options) {
    super(message, options);
    this.name = "StorageError";
  }
};
var ValidationError = class extends OfflineError {
  constructor(message = "Validation failed", options) {
    super(message, options);
    this.name = "ValidationError";
  }
};
var TypedEventBus = class {
  listeners = /* @__PURE__ */ new Map();
  emit(name, payload) {
    const listeners = this.listeners.get(name);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(payload);
    }
  }
  on(name, listener) {
    const listeners = this.listeners.get(name) ?? /* @__PURE__ */ new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return () => this.off(name, listener);
  }
  off(name, listener) {
    this.listeners.get(name)?.delete(listener);
  }
};
var OfflineDatabase = class {
  collections = /* @__PURE__ */ new Map();
  disposers = [];
  events = new TypedEventBus();
  network;
  queue;
  storage;
  syncEngine;
  transport;
  destroyed = false;
  constructor(options) {
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
      ...this.transport ? { transport: this.transport } : {},
      ...options.sync ? { sync: options.sync } : {}
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
  collection(name) {
    const existing = this.collections.get(name);
    if (existing) {
      return existing;
    }
    const collection = new OfflineDataCollection({
      db: this,
      events: this.events,
      name,
      network: this.network,
      queue: this.queue,
      storage: this.storage,
      syncEngine: this.syncEngine
    });
    this.collections.set(name, collection);
    return collection;
  }
  async destroy() {
    this.destroyed = true;
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }
  emit(name, payload) {
    this.events.emit(name, payload);
  }
  off(name, listener) {
    this.events.off(name, listener);
  }
  on(name, listener) {
    return this.events.on(name, listener);
  }
  async sync() {
    if (this.destroyed) {
      return;
    }
    await this.syncEngine.sync();
  }
  async transaction(run) {
    const scopes = [...this.collections.keys()];
    return this.storage.transaction(scopes, () => run(this));
  }
  use(plugin) {
    void Promise.resolve(
      plugin.setup({
        db: this,
        events: this.events,
        network: this.network,
        storage: this.storage
      })
    ).then((dispose) => {
      if (typeof dispose === "function") {
        if (this.destroyed) {
          dispose();
          return;
        }
        this.disposers.push(dispose);
      }
    }).catch((error) => this.events.emit("error", normalizeError(error)));
    return this;
  }
  createTransport(options) {
    if (!options.baseURL) {
      return void 0;
    }
    return new FetchTransport({
      baseURL: options.baseURL,
      ...options.headers ? { headers: options.headers } : {}
    });
  }
};
var OfflineDataCollection = class {
  db;
  events;
  name;
  network;
  queue;
  storage;
  subscribers = /* @__PURE__ */ new Set();
  syncEngine;
  constructor(options) {
    this.db = options.db;
    this.events = options.events;
    this.name = options.name;
    this.network = options.network;
    this.queue = options.queue;
    this.storage = options.storage;
    this.syncEngine = options.syncEngine;
  }
  async create(data) {
    const record = this.withMetadata({
      ...data,
      id: data.id ?? createId()
    });
    await this.storage.set(this.name, record);
    await this.enqueue("create", record.id, record, null);
    await this.notify();
    await this.syncIfOnline();
    return record;
  }
  async update(id, data) {
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
  async delete(id) {
    const existing = await this.findOne(id);
    await this.storage.delete(this.name, id);
    await this.enqueue("delete", id, void 0, existing);
    await this.notify();
    await this.syncIfOnline();
  }
  async find(query) {
    try {
      return await this.storage.find(this.name, query);
    } catch (error) {
      throw new StorageError(`Failed to read "${this.name}"`, { cause: error });
    }
  }
  async findOne(id) {
    try {
      return await this.storage.get(this.name, id);
    } catch (error) {
      throw new StorageError(`Failed to read "${this.name}/${id}"`, { cause: error });
    }
  }
  async paginate(query = {}) {
    const [data, allRecords] = await Promise.all([
      this.find(query),
      this.storage.find(this.name)
    ]);
    return {
      data,
      limit: query.limit ?? data.length,
      offset: query.offset ?? 0,
      total: countQuery(allRecords, query)
    };
  }
  subscribe(callback) {
    this.subscribers.add(callback);
    void this.find().then(callback).catch((error) => this.events.emit("error", normalizeError(error)));
    return () => {
      this.subscribers.delete(callback);
    };
  }
  async sync() {
    await this.syncEngine.sync(this.name);
    await this.notify();
  }
  async enqueue(operation, recordId, payload, base) {
    const mutation = await this.queue.add({
      base,
      collection: this.name,
      operation,
      recordId,
      ...payload === void 0 ? {} : { payload }
    });
    this.events.emit("queue:add", mutation);
  }
  async notify() {
    if (this.subscribers.size === 0) {
      return;
    }
    const records = await this.find();
    for (const subscriber of this.subscribers) {
      subscriber(records);
    }
  }
  async syncIfOnline() {
    if (!this.network.isOnline()) {
      return;
    }
    try {
      await this.syncEngine.sync(this.name);
    } catch (error) {
      this.events.emit("error", normalizeError(error));
    }
  }
  withMetadata(record) {
    return {
      ...record,
      updatedAt: now(),
      createdAt: record.createdAt ?? now()
    };
  }
};
var createOfflineDB = (options = {}) => new OfflineDatabase(options);

// packages/storage-indexeddb/src/index.ts
var STORE_NAME = "records";
var INDEX_STORE_NAME = "indexes";
var COLLECTION_INDEX = "collection";
var IndexedDBStorageAdapter = class {
  name = "indexeddb";
  contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  capabilities = {
    indexes: true,
    migrations: true,
    persistence: "durable",
    transactions: "best-effort"
  };
  databaseName;
  version;
  databasePromise;
  constructor(options = {}) {
    this.databaseName = options.databaseName ?? "offlinejs";
    this.version = options.version ?? 1;
  }
  async get(collection, id) {
    const row = await this.request(
      this.store("readonly").get(this.key(collection, id))
    );
    return row ? clone(row.value) : null;
  }
  async set(collection, value) {
    const row = {
      collection,
      id: value.id,
      key: this.key(collection, value.id),
      value: clone(value)
    };
    await this.request(this.store("readwrite").put(row));
  }
  async delete(collection, id) {
    await this.request(this.store("readwrite").delete(this.key(collection, id)));
  }
  async find(collection, query) {
    const rows = await this.getCollectionRows(collection);
    return applyQuery(
      rows.map((row) => clone(row.value)),
      query
    );
  }
  async clear(collection) {
    if (!collection) {
      await this.request(this.store("readwrite").clear());
      await this.request(this.indexStore("readwrite").clear());
      return;
    }
    const rows = await this.getCollectionRows(collection);
    const store = this.store("readwrite");
    await Promise.all(rows.map((row) => this.request(store.delete(row.key))));
    await Promise.all(
      (await this.listIndexes(collection)).map(
        (index) => this.request(this.indexStore("readwrite").delete(this.indexKey(collection, index.name)))
      )
    );
  }
  async createIndex(definition) {
    await this.request(
      this.indexStore("readwrite").put({
        ...clone(definition),
        id: this.indexKey(definition.collection, definition.name)
      })
    );
  }
  async dropIndex(collection, name) {
    await this.request(this.indexStore("readwrite").delete(this.indexKey(collection, name)));
  }
  async listIndexes(collection) {
    const rows = await this.request(
      this.indexStore("readonly").getAll()
    );
    return rows.filter((row) => !collection || row.collection === collection).map((row) => {
      const definition = { ...row };
      delete definition.id;
      return clone(definition);
    });
  }
  async transaction(_scope, run) {
    return run(this);
  }
  async migrate(migrations) {
    const applied = new Set(
      (await this.find("__migrations")).map((record) => record.id)
    );
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue;
      }
      await migration.up(this);
      await this.set("__migrations", { id: migration.name, appliedAt: Date.now() });
    }
  }
  async getCollectionRows(collection) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index(COLLECTION_INDEX);
    return this.request(index.getAll(collection));
  }
  store(mode) {
    const databasePromise = this.database();
    const requestProxy = {
      get: (key) => databasePromise.then(
        (database) => database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).get(key)
      ),
      put: (value) => databasePromise.then(
        (database) => database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).put(value)
      ),
      delete: (key) => databasePromise.then(
        (database) => database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).delete(key)
      ),
      clear: () => databasePromise.then(
        (database) => database.transaction(STORE_NAME, mode).objectStore(STORE_NAME).clear()
      )
    };
    return requestProxy;
  }
  indexStore(mode) {
    const databasePromise = this.database();
    const requestProxy = {
      put: (value) => databasePromise.then(
        (database) => database.transaction(INDEX_STORE_NAME, mode).objectStore(INDEX_STORE_NAME).put(value)
      ),
      delete: (key) => databasePromise.then(
        (database) => database.transaction(INDEX_STORE_NAME, mode).objectStore(INDEX_STORE_NAME).delete(key)
      ),
      clear: () => databasePromise.then(
        (database) => database.transaction(INDEX_STORE_NAME, mode).objectStore(INDEX_STORE_NAME).clear()
      ),
      getAll: () => databasePromise.then(
        (database) => database.transaction(INDEX_STORE_NAME, mode).objectStore(INDEX_STORE_NAME).getAll()
      )
    };
    return requestProxy;
  }
  async database() {
    if (this.databasePromise) {
      return this.databasePromise;
    }
    this.databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB is not available in this runtime"));
        return;
      }
      const request = globalThis.indexedDB.open(this.databaseName, this.version);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex(COLLECTION_INDEX, COLLECTION_INDEX, { unique: false });
        }
        if (!database.objectStoreNames.contains(INDEX_STORE_NAME)) {
          database.createObjectStore(INDEX_STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    });
    return this.databasePromise;
  }
  async request(requestOrPromise) {
    const request = await requestOrPromise;
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
  key(collection, id) {
    return `${collection}:${id}`;
  }
  indexKey(collection, name) {
    return `${collection}:${name}`;
  }
};
var createIndexedDBStorage = (options) => new IndexedDBStorageAdapter(options);

// packages/storage-opfs/src/index.ts
var OPFSStorageAdapter = class {
  name = "opfs";
  contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  capabilities = {
    indexes: true,
    migrations: true,
    persistence: "durable",
    transactions: "best-effort"
  };
  directory;
  rootName;
  constructor(options = {}) {
    this.directory = options.directory;
    this.rootName = options.rootName ?? "offlinejs";
  }
  async get(collection, id) {
    try {
      const file = await this.file(collection, `${id}.json`);
      return JSON.parse(await (await file.getFile()).text());
    } catch {
      return null;
    }
  }
  async set(collection, value) {
    const file = await this.file(collection, `${value.id}.json`, true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(value));
    await writable.close();
    await this.updateManifest(collection, (ids) => [.../* @__PURE__ */ new Set([...ids, value.id])]);
  }
  async delete(collection, id) {
    await (await this.collectionDirectory(collection)).removeEntry(`${id}.json`);
    await this.updateManifest(collection, (ids) => ids.filter((value) => value !== id));
  }
  async find(collection, query) {
    const manifest = await this.readManifest(collection);
    const records = [];
    for (const id of manifest.ids) {
      const record = await this.get(collection, id);
      if (record) {
        records.push(record);
      }
    }
    return applyQuery(records, query);
  }
  async clear(collection) {
    const root = await this.rootDirectory();
    if (collection) {
      await root.removeEntry(collection, { recursive: true });
      return;
    }
    await root.removeEntry(this.rootName, { recursive: true });
  }
  async transaction(_scope, run) {
    return run(this);
  }
  async migrate(migrations) {
    const applied = new Set(
      (await this.find("__migrations")).map((record) => record.id)
    );
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue;
      }
      await migration.up(this);
      await this.set("__migrations", { id: migration.name, appliedAt: Date.now() });
    }
  }
  async createIndex(definition) {
    const indexes = await this.listIndexes(definition.collection);
    const nextIndexes = indexes.filter((index) => index.name !== definition.name);
    nextIndexes.push(definition);
    await this.writeIndexes(definition.collection, nextIndexes);
  }
  async dropIndex(collection, name) {
    const indexes = (await this.listIndexes(collection)).filter((index) => index.name !== name);
    await this.writeIndexes(collection, indexes);
  }
  async listIndexes(collection) {
    if (!collection) {
      return [];
    }
    try {
      const file = await this.file(collection, "__indexes.json");
      return JSON.parse(await (await file.getFile()).text());
    } catch {
      return [];
    }
  }
  async file(collection, name, create = false) {
    return (await this.collectionDirectory(collection)).getFileHandle(name, { create });
  }
  async collectionDirectory(collection) {
    return (await this.rootDirectory()).getDirectoryHandle(collection, { create: true });
  }
  async rootDirectory() {
    if (this.directory) {
      return this.directory.getDirectoryHandle(this.rootName, { create: true });
    }
    const storage = globalThis.navigator?.storage;
    const root = await storage?.getDirectory?.();
    if (!root) {
      throw new Error("OPFS is not available in this runtime");
    }
    return root.getDirectoryHandle(this.rootName, { create: true });
  }
  async readManifest(collection) {
    try {
      const file = await this.file(collection, "__manifest.json");
      return JSON.parse(await (await file.getFile()).text());
    } catch {
      return { ids: [] };
    }
  }
  async writeIndexes(collection, indexes) {
    const file = await this.file(collection, "__indexes.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(indexes));
    await writable.close();
  }
  async updateManifest(collection, update) {
    const manifest = await this.readManifest(collection);
    const file = await this.file(collection, "__manifest.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify({ ids: update(manifest.ids) }));
    await writable.close();
  }
};
var createOPFSStorage = (options) => new OPFSStorageAdapter(options);

// packages/devtools/src/index.ts
var eventNames = [
  "sync:start",
  "sync:end",
  "offline",
  "online",
  "queue:add",
  "queue:complete",
  "conflict",
  "error",
  "worker:message",
  "coordination:message"
];
var devtools = (options = {}) => ({
  name: "devtools",
  setup({ events: events2 }) {
    const logger = options.logger ?? console;
    const disposers = eventNames.map(
      (eventName) => events2.on(eventName, (payload) => {
        if (eventName === "error") {
          logger.error("[offlinejs]", eventName, payload);
          return;
        }
        logger.debug("[offlinejs]", eventName, payload);
      })
    );
    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }
});

// packages/devtools-ui/src/index.ts
var events = [
  "sync:start",
  "sync:end",
  "offline",
  "online",
  "queue:add",
  "queue:complete",
  "conflict",
  "error",
  "worker:message",
  "coordination:message"
];
var createDevtoolsController = (db2) => {
  const entries = [];
  let target = null;
  const refresh = () => {
    if (target) {
      target.innerHTML = createMarkup(entries);
    }
  };
  const disposers = events.map(
    (event) => db2.on(event, (payload) => {
      entries.unshift({
        event,
        payload,
        timestamp: Date.now()
      });
      entries.splice(100);
      refresh();
    })
  );
  const render = (nextTarget) => {
    target = nextTarget;
    refresh();
  };
  return {
    destroy() {
      for (const dispose of disposers) {
        dispose();
      }
      target = null;
    },
    events: () => [...entries],
    mount: render,
    render
  };
};
var createMarkup = (entries) => `
  <section class="offlinejs-devtools" style="font-family: ui-sans-serif, system-ui, sans-serif; padding: 12px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px">
      <h2 style="margin:0;font-size:1.05rem">OfflineJS Devtools</h2>
      <span style="opacity:.7;font-size:.85rem">${entries.length} event${entries.length === 1 ? "" : "s"}</span>
    </div>
    ${entries.length === 0 ? `<p style="margin:0;opacity:.7">Waiting for sync, queue, network, and conflict events\u2026</p>` : `<ol style="padding-left:20px;margin:0;display:grid;gap:10px">
            ${entries.map(
  (entry) => `
                  <li>
                    <strong>${escapeHtml(entry.event)}</strong>
                    <time style="margin-left:8px;opacity:.7;font-size:.85rem">${new Date(entry.timestamp).toLocaleTimeString()}</time>
                    <pre style="margin:6px 0 0;padding:8px;overflow:auto;border-radius:8px;background:rgba(0,0,0,.06);font-size:12px">${escapeHtml(JSON.stringify(entry.payload, null, 2))}</pre>
                  </li>
                `
).join("")}
          </ol>`}
  </section>
`;
var escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

// packages/offlinejs/src/index.ts
var isBrowserRuntime = () => typeof globalThis.window !== "undefined" && typeof globalThis.indexedDB !== "undefined";
var isStorageAdapter = (value) => typeof value === "object" && value !== null && "get" in value && "set" in value;
var resolveStorage = (storage) => {
  if (isStorageAdapter(storage)) {
    return storage;
  }
  const preset = storage ?? (isBrowserRuntime() ? "indexeddb" /* IndexedDB */ : "memory" /* Memory */);
  switch (preset) {
    case "memory" /* Memory */:
      return createMemoryStorage();
    case "indexeddb" /* IndexedDB */:
      return createIndexedDBStorage();
    case "opfs" /* OPFS */:
      return createOPFSStorage();
    default: {
      throw new Error(`Unknown OfflineJS storage preset: ${String(preset)}`);
    }
  }
};
var createOfflineDB2 = (options = {}) => {
  const { storage, ...rest } = options;
  return createOfflineDB({
    ...rest,
    storage: resolveStorage(storage)
  });
};

// docs-site/demo/fake-api.ts
var TITLES = [
  "Ship offline sync",
  "Draft release notes",
  "Fix flaky queue retry",
  "Review conflict strategy",
  "Polish demo UI",
  "Add IndexedDB indexes",
  "Write FAQ answer",
  "Benchmark OPFS writes",
  "Wire service worker sync",
  "Tighten auth refresh"
];
var ASSIGNEES = ["Ada", "Grace", "Linus", "Margaret", "Alan", "Katherine"];
var randomItem = (items) => items[Math.floor(Math.random() * items.length)];
var createId2 = () => globalThis.crypto?.randomUUID?.() ?? `todo_${Date.now()}_${Math.random().toString(16).slice(2)}`;
var FakeTodoApi = class {
  records = /* @__PURE__ */ new Map();
  conflictOnce = /* @__PURE__ */ new Set();
  constructor() {
    this.seedRandom(4);
  }
  list() {
    return [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  seedRandom(count = 5) {
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const now2 = Date.now() - Math.floor(Math.random() * 5e4);
      const todo = {
        id: createId2(),
        title: randomItem(TITLES),
        completed: Math.random() > 0.65,
        assignee: randomItem(ASSIGNEES),
        createdAt: now2,
        updatedAt: now2
      };
      this.records.set(todo.id, todo);
      created.push(todo);
    }
    return created;
  }
  /** Mutate server copy and force the next client write to 409. */
  prepareConflict(id) {
    const current = this.records.get(id);
    if (!current) {
      return null;
    }
    const serverEdit = {
      ...current,
      title: `SERVER: ${randomItem(TITLES)}`,
      assignee: randomItem(ASSIGNEES),
      updatedAt: Date.now() + 1
    };
    this.records.set(id, serverEdit);
    this.conflictOnce.add(id);
    return serverEdit;
  }
  clear() {
    this.records.clear();
    this.conflictOnce.clear();
  }
  createTransport(isOnline) {
    return {
      contractVersion: SYNC_TRANSPORT_CONTRACT_VERSION,
      request: async (request) => {
        if (!isOnline()) {
          const error = new Error("Fake API is offline");
          Object.assign(error, { status: 0 });
          throw error;
        }
        await delay(120 + Math.floor(Math.random() * 180));
        return this.handle(request);
      }
    };
  }
  async handle(request) {
    const [collection, id] = request.path.replace(/^\//, "").split("/");
    if (collection !== "todos") {
      return { data: null, status: 404 };
    }
    if (request.method === "GET" && !id) {
      return { data: this.list(), status: 200 };
    }
    if (request.method === "POST" && !id) {
      const body = request.body ?? {};
      const now2 = Date.now();
      const todo = {
        id: typeof body.id === "string" ? body.id : createId2(),
        title: String(body.title ?? "Untitled"),
        completed: Boolean(body.completed),
        ...body.assignee ? { assignee: String(body.assignee) } : {},
        createdAt: Number(body.createdAt ?? now2),
        updatedAt: Number(body.updatedAt ?? now2)
      };
      this.records.set(todo.id, todo);
      return { data: todo, status: 201 };
    }
    if (!id) {
      return { data: null, status: 400 };
    }
    if (request.method === "DELETE") {
      this.records.delete(id);
      return { data: null, status: 204 };
    }
    if (request.method === "PATCH" || request.method === "PUT") {
      const existing = this.records.get(id);
      if (this.conflictOnce.has(id) && existing) {
        this.conflictOnce.delete(id);
        const error = new Error("Conflict");
        Object.assign(error, { status: 409, data: existing });
        throw error;
      }
      const body = request.body ?? {};
      const now2 = Date.now();
      const next = {
        id,
        title: String(body.title ?? existing?.title ?? "Untitled"),
        completed: body.completed ?? existing?.completed ?? false,
        ...body.assignee || existing?.assignee ? { assignee: String(body.assignee ?? existing?.assignee) } : {},
        createdAt: Number(body.createdAt ?? existing?.createdAt ?? now2),
        updatedAt: Number(body.updatedAt ?? now2)
      };
      this.records.set(id, next);
      return { data: next, status: 200 };
    }
    return { data: null, status: 405 };
  }
};
var delay = (ms) => new Promise((resolve) => {
  globalThis.setTimeout(resolve, ms);
});

// docs-site/demo/app.ts
var api = new FakeTodoApi();
var network = new BrowserNetworkMonitor({ initialOnline: true });
var conflictStrategy = "lastWriteWins" /* LastWriteWins */;
var db = createDemoDb();
var panel = createDevtoolsController(db);
var unsubscribe;
var els = {
  onlineToggle: document.querySelector("#online-toggle"),
  onlineLabel: document.querySelector("#online-label"),
  strategy: document.querySelector("#conflict-strategy"),
  seedBtn: document.querySelector("#seed-random"),
  syncBtn: document.querySelector("#sync-now"),
  conflictBtn: document.querySelector("#simulate-conflict"),
  resetBtn: document.querySelector("#reset-demo"),
  titleInput: document.querySelector("#todo-title"),
  addBtn: document.querySelector("#add-todo"),
  list: document.querySelector("#todo-list"),
  queueMeta: document.querySelector("#queue-meta"),
  serverMeta: document.querySelector("#server-meta"),
  status: document.querySelector("#demo-status"),
  devtools: document.querySelector("#offlinejs-devtools")
};
function createDemoDb() {
  return createOfflineDB2({
    storage: createIndexedDBStorage({ databaseName: "offlinejs-demo" }),
    network,
    transport: api.createTransport(() => network.isOnline()),
    sync: {
      autoStart: true,
      conflictStrategy,
      pull: true
    },
    plugins: [devtools()]
  });
}
async function boot() {
  panel.mount(els.devtools);
  wireControls();
  await bindCollection();
  await pullIfOnline();
  renderServerMeta();
  setStatus("Demo ready \u2014 try going offline, editing, then syncing.");
}
function wireControls() {
  els.onlineToggle.checked = network.isOnline();
  els.onlineLabel.textContent = network.isOnline() ? "Online" : "Offline";
  els.onlineToggle.addEventListener("change", () => {
    network.setOnline(els.onlineToggle.checked);
    els.onlineLabel.textContent = els.onlineToggle.checked ? "Online" : "Offline";
    setStatus(els.onlineToggle.checked ? "Back online \u2014 sync can resume." : "Offline \u2014 writes stay queued.");
  });
  els.strategy.value = String(conflictStrategy);
  els.strategy.addEventListener("change", async () => {
    conflictStrategy = els.strategy.value;
    await recreateDb(`Conflict strategy set to ${conflictStrategy}`);
  });
  els.seedBtn.addEventListener("click", async () => {
    const created = api.seedRandom(5);
    if (network.isOnline()) {
      await db.collection("todos").sync();
      await db.sync();
    } else {
    }
    renderServerMeta();
    if (network.isOnline()) {
      await refreshLocalFromServer();
    }
    setStatus(`Fake API generated ${created.length} random todos.`);
  });
  els.syncBtn.addEventListener("click", async () => {
    if (!network.isOnline()) {
      setStatus("Can't sync while offline.");
      return;
    }
    setStatus("Syncing\u2026");
    await db.collection("todos").sync();
    await db.sync();
    await refreshView();
    renderServerMeta();
    setStatus("Sync finished.");
  });
  els.conflictBtn.addEventListener("click", async () => {
    const local = await db.collection("todos").find({ limit: 1 });
    const target = local[0];
    if (!target) {
      setStatus("Add or seed a todo first, then sync it.");
      return;
    }
    if (network.isOnline()) {
      await db.collection("todos").sync();
    }
    const serverEdit = api.prepareConflict(target.id);
    await db.collection("todos").update(target.id, {
      title: `CLIENT: ${target.title}`,
      completed: !target.completed
    });
    renderServerMeta();
    setStatus(
      serverEdit ? "Conflict prepared. Stay online and hit Sync to resolve with the dropdown strategy." : "Could not prepare conflict."
    );
    await refreshView();
  });
  els.resetBtn.addEventListener("click", async () => {
    api.clear();
    api.seedRandom(3);
    await db.collection("todos").find().then(async (rows) => {
      for (const row of rows) {
        await db.collection("todos").delete(row.id);
      }
    });
    await recreateDb("Demo reset with fresh random server data.", true);
  });
  els.addBtn.addEventListener("click", async () => {
    const title = els.titleInput.value.trim();
    if (!title) {
      return;
    }
    await db.collection("todos").create({ title, completed: false, assignee: "You" });
    els.titleInput.value = "";
    await refreshView();
    setStatus(network.isOnline() ? "Created locally (will sync soon)." : "Created offline \u2014 queued.");
  });
  els.titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      els.addBtn.click();
    }
  });
  network.subscribe((state) => {
    els.onlineToggle.checked = state.online;
    els.onlineLabel.textContent = state.online ? "Online" : "Offline";
  });
}
async function bindCollection() {
  unsubscribe?.();
  const todos = db.collection("todos");
  unsubscribe = todos.subscribe(async () => {
    await refreshView();
  });
  await refreshView();
}
async function recreateDb(message, clearLocal = false) {
  unsubscribe?.();
  panel.destroy();
  if (clearLocal && "indexedDB" in globalThis) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase("offlinejs-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to delete demo DB"));
      request.onblocked = () => resolve();
    });
  }
  db = createDemoDb();
  panel = createDevtoolsController(db);
  panel.mount(els.devtools);
  await bindCollection();
  await pullIfOnline();
  renderServerMeta();
  setStatus(message);
}
async function pullIfOnline() {
  if (!network.isOnline()) {
    return;
  }
  await refreshLocalFromServer();
}
async function refreshLocalFromServer() {
  await db.collection("todos").sync();
  await refreshView();
}
async function refreshView() {
  const todos = await db.collection("todos").find({ orderBy: "updatedAt", sort: "desc" });
  els.list.innerHTML = todos.length ? todos.map(
    (todo) => `
          <li class="demo-item" data-id="${escapeHtml2(todo.id)}">
            <label class="demo-item-main">
              <input type="checkbox" data-action="toggle" ${todo.completed ? "checked" : ""} />
              <span class="${todo.completed ? "is-done" : ""}">${escapeHtml2(todo.title)}</span>
            </label>
            <div class="demo-item-meta">
              <span>${escapeHtml2(todo.assignee ?? "Unassigned")}</span>
              <button type="button" data-action="edit">Edit</button>
              <button type="button" data-action="delete" class="danger">Delete</button>
            </div>
          </li>`
  ).join("") : `<li class="demo-empty">No local todos yet. Seed random data or add one.</li>`;
  els.list.querySelectorAll(".demo-item").forEach((item) => {
    const id = item.dataset.id;
    item.querySelector('[data-action="toggle"]')?.addEventListener("change", async (event) => {
      const checked = event.target.checked;
      await db.collection("todos").update(id, { completed: checked });
      await refreshView();
    });
    item.querySelector('[data-action="edit"]')?.addEventListener("click", async () => {
      const current = todos.find((todo) => todo.id === id);
      const next = globalThis.prompt("Edit title", current?.title ?? "");
      if (!next) {
        return;
      }
      await db.collection("todos").update(id, { title: next });
      await refreshView();
    });
    item.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      await db.collection("todos").delete(id);
      await refreshView();
    });
  });
  const queued = await db.collection("todos").find().then(async () => {
    return api.list().length;
  });
  void queued;
  const localCount = todos.length;
  els.queueMeta.textContent = `${localCount} local todo${localCount === 1 ? "" : "s"} \xB7 network ${network.isOnline() ? "online" : "offline"} \xB7 strategy ${String(conflictStrategy)}`;
}
function renderServerMeta() {
  const server = api.list();
  els.serverMeta.textContent = `Fake API has ${server.length} todo${server.length === 1 ? "" : "s"} (random seed + synced writes).`;
}
function setStatus(message) {
  els.status.textContent = message;
}
function escapeHtml2(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
void boot().catch((error) => {
  console.error(error);
  setStatus(error instanceof Error ? error.message : "Demo failed to start");
});
