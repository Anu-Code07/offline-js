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
  const needsFilter = Boolean(query.filters) || Boolean(query.search);
  const filtered = needsFilter ? records.filter((record) => matchesQuery(record, query)) : records;
  const sorted = sortRecords(filtered, query);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit ?? Math.max(0, sorted.length - offset);
  if (offset === 0 && limit >= sorted.length) {
    return sorted === records ? records.slice() : sorted;
  }
  return sorted.slice(offset, offset + limit);
};
var countQuery = (records, query = {}) => records.filter((record) => matchesQuery(record, query)).length;
var serializeCompoundIndexValue = (values) => JSON.stringify(values.map((value) => value ?? null));
var readIndexFields = (record, fields) => fields.map((field) => record[String(field)]);
var getEqualityFilterLookups = (filters) => {
  if (!filters) {
    return [];
  }
  const lookups = [];
  for (const [field, expected] of Object.entries(filters)) {
    if (expected === void 0) {
      continue;
    }
    if (Array.isArray(expected) || expected === null || typeof expected !== "object") {
      lookups.push({ field, value: expected });
      continue;
    }
    if ("eq" in expected && expected.eq !== void 0) {
      lookups.push({ field, value: expected.eq });
    }
  }
  return lookups;
};
var findMatchingIndex = (indexes, lookups) => {
  if (indexes.length === 0 || lookups.length === 0) {
    return null;
  }
  const lookupByField = new Map(lookups.map((lookup) => [lookup.field, lookup.value]));
  let best = null;
  for (const index of indexes) {
    const fields = index.fields.map(String);
    if (!fields.every((field) => lookupByField.has(field))) {
      continue;
    }
    if (!best || fields.length > best.index.fields.length) {
      best = {
        index,
        values: fields.map((field) => lookupByField.get(field))
      };
    }
  }
  return best;
};
var indexSatisfiesQuery = (match, query) => {
  if (!query || query.search || query.orderBy) {
    return false;
  }
  const filterKeys = query.filters ? Object.keys(query.filters) : [];
  if (filterKeys.length === 0) {
    return true;
  }
  const indexedFields = new Set(match.index.fields.map(String));
  return filterKeys.every((field) => indexedFields.has(field));
};
var queryPageWindow = (query) => ({
  offset: Math.max(0, query?.offset ?? 0),
  ...query?.limit === void 0 ? {} : { limit: query.limit }
});
var sortRecords = (records, query) => {
  if (!query.orderBy) {
    return records;
  }
  const direction = query.sort === "desc" ? -1 : 1;
  const key = String(query.orderBy);
  return records.slice().sort((left, right) => {
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
      if (expected.length > 8) {
        if (!new Set(expected).has(actual)) {
          return false;
        }
      } else if (!expected.includes(actual)) {
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
  async due(options = defaultQueueProcessingOptions, collection) {
    if (this.paused) {
      return [];
    }
    const pending = await this.storage.find(this.collectionName, {
      filters: collection ? { status: "pending", collection } : { status: "pending" },
      orderBy: "priority",
      sort: "desc",
      limit: Math.max(options.batchSize * 4, options.batchSize)
    });
    const failed = await this.storage.find(this.collectionName, {
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
  selectDue(mutations, options = defaultQueueProcessingOptions) {
    if (this.paused) {
      return [];
    }
    const timestamp = now();
    const due = [];
    for (const mutation of mutations) {
      if (mutation.status === "processing") {
        continue;
      }
      if (mutation.retries >= options.retry.maxAttempts) {
        continue;
      }
      if (mutation.lastAttemptAt) {
        const delay2 = backoffDelay(mutation.retries, options.retry);
        if (mutation.lastAttemptAt + delay2 > timestamp) {
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
    bulkWrites: true,
    migrations: true,
    persistence: "ephemeral",
    transactions: "atomic"
  };
  records = /* @__PURE__ */ new Map();
  indexes = /* @__PURE__ */ new Map();
  /** collection → indexName → serializedValue → record ids */
  secondary = /* @__PURE__ */ new Map();
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
    await this.setMany(collection, [value]);
  }
  async setMany(collection, values) {
    if (values.length === 0) {
      return;
    }
    const byId = /* @__PURE__ */ new Map();
    for (const value of values) {
      byId.set(value.id, value);
    }
    const records = [...byId.values()];
    for (const value of records) {
      const previous = this.records.get(collection)?.get(value.id);
      this.assertUniqueIndexes(collection, value, previous?.id);
    }
    for (const value of records) {
      const previous = this.records.get(collection)?.get(value.id);
      if (previous) {
        this.unindexRecord(collection, previous);
      }
      this.ensureCollection(collection).set(value.id, clone(value));
      this.indexRecord(collection, value);
    }
  }
  async delete(collection, id) {
    const previous = this.records.get(collection)?.get(id);
    if (previous) {
      this.unindexRecord(collection, previous);
    }
    this.records.get(collection)?.delete(id);
  }
  async find(collection, query) {
    const indexed = this.findViaIndex(collection, query);
    if (indexed?.complete) {
      return indexed.records.map((record) => clone(record));
    }
    const records = indexed?.records ?? [...this.records.get(collection)?.values() ?? []];
    return applyQuery(records, query).map((record) => clone(record));
  }
  async clear(collection) {
    if (collection) {
      this.records.delete(collection);
      this.indexes.delete(collection);
      this.secondary.delete(collection);
      return;
    }
    this.records.clear();
    this.indexes.clear();
    this.secondary.clear();
  }
  async createIndex(definition) {
    const normalized = clone(definition);
    const collectionIndexes = this.indexes.get(definition.collection) ?? /* @__PURE__ */ new Map();
    collectionIndexes.set(definition.name, normalized);
    this.indexes.set(definition.collection, collectionIndexes);
    const bucket = /* @__PURE__ */ new Map();
    const collectionSecondary = this.secondary.get(definition.collection) ?? /* @__PURE__ */ new Map();
    collectionSecondary.set(definition.name, bucket);
    this.secondary.set(definition.collection, collectionSecondary);
    for (const record of this.records.get(definition.collection)?.values() ?? []) {
      this.assertUniqueIndexes(definition.collection, record);
      this.addToSecondary(definition.collection, normalized, record);
    }
  }
  async dropIndex(collection, name) {
    this.indexes.get(collection)?.delete(name);
    this.secondary.get(collection)?.delete(name);
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
    const indexSnapshot = /* @__PURE__ */ new Map();
    const secondarySnapshot = /* @__PURE__ */ new Map();
    for (const collection of scope) {
      snapshot.set(collection, new Map(this.records.get(collection) ?? []));
      indexSnapshot.set(
        collection,
        new Map(
          [...this.indexes.get(collection)?.entries() ?? []].map(([name, definition]) => [
            name,
            clone(definition)
          ])
        )
      );
      secondarySnapshot.set(collection, cloneSecondary(this.secondary.get(collection)));
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
        const indexes = indexSnapshot.get(collection);
        if (indexes && indexes.size > 0) {
          this.indexes.set(collection, indexes);
        } else {
          this.indexes.delete(collection);
        }
        const secondary = secondarySnapshot.get(collection);
        if (secondary && secondary.size > 0) {
          this.secondary.set(collection, secondary);
        } else {
          this.secondary.delete(collection);
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
  findViaIndex(collection, query) {
    const definitions = [...this.indexes.get(collection)?.values() ?? []];
    const match = findMatchingIndex(definitions, getEqualityFilterLookups(query?.filters));
    if (!match) {
      return null;
    }
    const valueKey = serializeCompoundIndexValue(match.values);
    const ids = this.secondary.get(collection)?.get(match.index.name)?.get(valueKey);
    if (!ids) {
      return { complete: indexSatisfiesQuery(match, query), records: [] };
    }
    let idList = [...ids];
    const complete = indexSatisfiesQuery(match, query);
    if (complete) {
      const { offset, limit } = queryPageWindow(query);
      idList = limit === void 0 ? idList.slice(offset) : idList.slice(offset, offset + limit);
    }
    const records = [];
    for (const id of idList) {
      const record = this.records.get(collection)?.get(id);
      if (record) {
        records.push(record);
      }
    }
    return { complete, records };
  }
  assertUniqueIndexes(collection, record, ignoreId) {
    for (const definition of this.indexes.get(collection)?.values() ?? []) {
      if (!definition.unique) {
        continue;
      }
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const ids = this.secondary.get(collection)?.get(definition.name)?.get(valueKey);
      if (!ids) {
        continue;
      }
      for (const id of ids) {
        if (id !== record.id && id !== ignoreId) {
          throw new Error(
            `Unique index "${definition.name}" violated for ${collection}.${String(definition.fields[0])}`
          );
        }
      }
    }
  }
  indexRecord(collection, record) {
    for (const definition of this.indexes.get(collection)?.values() ?? []) {
      this.addToSecondary(collection, definition, record);
    }
  }
  unindexRecord(collection, record) {
    for (const definition of this.indexes.get(collection)?.values() ?? []) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const bucket = this.secondary.get(collection)?.get(definition.name)?.get(valueKey);
      bucket?.delete(record.id);
      if (bucket && bucket.size === 0) {
        this.secondary.get(collection)?.get(definition.name)?.delete(valueKey);
      }
    }
  }
  addToSecondary(collection, definition, record) {
    const collectionSecondary = this.secondary.get(collection) ?? /* @__PURE__ */ new Map();
    const indexBucket = collectionSecondary.get(definition.name) ?? /* @__PURE__ */ new Map();
    const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
    const ids = indexBucket.get(valueKey) ?? /* @__PURE__ */ new Set();
    ids.add(record.id);
    indexBucket.set(valueKey, ids);
    collectionSecondary.set(definition.name, indexBucket);
    this.secondary.set(collection, collectionSecondary);
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
var cloneSecondary = (source) => {
  const cloned = /* @__PURE__ */ new Map();
  for (const [indexName, values] of source ?? []) {
    const valueMap = /* @__PURE__ */ new Map();
    for (const [valueKey, ids] of values) {
      valueMap.set(valueKey, new Set(ids));
    }
    cloned.set(indexName, valueMap);
  }
  return cloned;
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
    const options = this.processingOptions();
    const due = await this.queue.due(options, collection);
    this.events.emit("sync:start", { mode: "full", queued: due.length });
    try {
      const pushResult = this.syncOptions.push === false ? { completed: 0, failed: 0 } : await this.pushDue(due, options);
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
  async pushDue(due, options) {
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
            return "completed";
          } catch (error) {
            await this.queue.markAttempt(mutation.id);
            this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
            return "failed";
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
    const allRecords = await this.storage.find(this.name);
    const data = applyQuery(allRecords, query);
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
var INDEX_ENTRIES_STORE = "index_entries";
var COLLECTION_INDEX = "collection";
var LOOKUP_INDEX = "lookup";
var IndexedDBStorageAdapter = class {
  name = "indexeddb";
  contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  capabilities = {
    indexes: true,
    bulkWrites: true,
    migrations: true,
    persistence: "durable",
    transactions: "atomic"
  };
  databaseName;
  version;
  databasePromise;
  constructor(options = {}) {
    this.databaseName = options.databaseName ?? "offlinejs";
    this.version = options.version ?? 2;
  }
  async get(collection, id) {
    const row = await this.request(
      this.store("readonly").get(this.key(collection, id))
    );
    return row ? clone(row.value) : null;
  }
  async set(collection, value) {
    await this.setMany(collection, [value]);
  }
  async setMany(collection, values) {
    if (values.length === 0) {
      return;
    }
    const byId = /* @__PURE__ */ new Map();
    for (const value of values) {
      byId.set(value.id, value);
    }
    const records = [...byId.values()];
    await this.runInTransaction(
      [STORE_NAME, INDEX_STORE_NAME, INDEX_ENTRIES_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(STORE_NAME);
        const indexStore = transaction.objectStore(INDEX_STORE_NAME);
        const entryStore = transaction.objectStore(INDEX_ENTRIES_STORE);
        const definitions = await this.listIndexesFromStore(indexStore, collection);
        const batchIds = new Set(records.map((record) => record.id));
        const previousRows = await Promise.all(
          records.map(
            (record) => this.request(recordStore.get(this.key(collection, record.id)))
          )
        );
        for (const record of records) {
          await this.assertUniqueIndexesInStore(entryStore, definitions, collection, record, batchIds);
        }
        for (const previous of previousRows) {
          if (previous) {
            await this.removeIndexEntriesInStore(entryStore, definitions, collection, previous.value);
          }
        }
        for (const record of records) {
          const row = {
            collection,
            id: record.id,
            key: this.key(collection, record.id),
            value: clone(record)
          };
          await this.request(recordStore.put(row));
          await this.writeIndexEntriesInStore(entryStore, definitions, collection, record);
        }
      }
    );
  }
  async delete(collection, id) {
    await this.runInTransaction(
      [STORE_NAME, INDEX_STORE_NAME, INDEX_ENTRIES_STORE],
      "readwrite",
      async (transaction) => {
        const recordStore = transaction.objectStore(STORE_NAME);
        const indexStore = transaction.objectStore(INDEX_STORE_NAME);
        const entryStore = transaction.objectStore(INDEX_ENTRIES_STORE);
        const previous = await this.request(
          recordStore.get(this.key(collection, id))
        );
        if (previous) {
          const definitions = await this.listIndexesFromStore(indexStore, collection);
          await this.removeIndexEntriesInStore(entryStore, definitions, collection, previous.value);
        }
        await this.request(recordStore.delete(this.key(collection, id)));
      }
    );
  }
  async find(collection, query) {
    const indexed = await this.findViaIndex(collection, query);
    if (indexed?.complete) {
      return indexed.records;
    }
    const records = indexed?.records ?? (await this.getCollectionRows(collection)).map((row) => clone(row.value));
    return applyQuery(records, query);
  }
  async clear(collection) {
    if (!collection) {
      await this.request(this.store("readwrite").clear());
      await this.request(this.indexStore("readwrite").clear());
      await this.request(this.entryStore("readwrite").clear());
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
    const entries = await this.getEntriesForCollection(collection);
    await Promise.all(
      entries.map((entry) => this.request(this.entryStore("readwrite").delete(entry.id)))
    );
  }
  async createIndex(definition) {
    const normalized = clone(definition);
    await this.request(
      this.indexStore("readwrite").put({
        ...normalized,
        id: this.indexKey(definition.collection, definition.name)
      })
    );
    const rows = await this.getCollectionRows(definition.collection);
    for (const row of rows) {
      await this.assertUniqueIndexes(definition.collection, row.value);
      await this.writeIndexEntries(definition.collection, row.value, [normalized]);
    }
  }
  async dropIndex(collection, name) {
    await this.request(this.indexStore("readwrite").delete(this.indexKey(collection, name)));
    const entries = await this.getEntriesForCollection(collection);
    await Promise.all(
      entries.filter((entry) => entry.indexName === name).map((entry) => this.request(this.entryStore("readwrite").delete(entry.id)))
    );
  }
  async listIndexes(collection) {
    const rows = await this.request(
      this.indexStore("readonly").getAll()
    );
    return rows.filter((row) => !collection || row.collection === collection || row.id.startsWith(`${collection}:`)).map((row) => {
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
  async findViaIndex(collection, query) {
    const match = findMatchingIndex(
      await this.listIndexes(collection),
      getEqualityFilterLookups(query?.filters)
    );
    if (!match) {
      return null;
    }
    const lookup = this.lookupKey(
      collection,
      match.index.name,
      serializeCompoundIndexValue(match.values)
    );
    let entries = await this.request(this.entryLookup("readonly").getAll(lookup));
    const complete = indexSatisfiesQuery(match, query);
    if (complete) {
      const { offset, limit } = queryPageWindow(query);
      entries = limit === void 0 ? entries.slice(offset) : entries.slice(offset, offset + limit);
    }
    if (entries.length === 0) {
      return { complete, records: [] };
    }
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const rows = await Promise.all(
      entries.map(
        (entry) => this.request(store.get(this.key(collection, entry.recordId)))
      )
    );
    return {
      complete,
      records: rows.filter((row) => Boolean(row)).map((row) => clone(row.value))
    };
  }
  async assertUniqueIndexes(collection, record, ignoreId) {
    const definitions = await this.listIndexes(collection);
    await this.runInTransaction(INDEX_ENTRIES_STORE, "readonly", async (transaction) => {
      await this.assertUniqueIndexesInStore(
        transaction.objectStore(INDEX_ENTRIES_STORE),
        definitions,
        collection,
        record,
        ignoreId ? /* @__PURE__ */ new Set([ignoreId, record.id]) : /* @__PURE__ */ new Set([record.id])
      );
    });
  }
  async writeIndexEntries(collection, record, definitions) {
    const indexes = definitions ?? await this.listIndexes(collection);
    await this.runInTransaction(INDEX_ENTRIES_STORE, "readwrite", async (transaction) => {
      await this.writeIndexEntriesInStore(
        transaction.objectStore(INDEX_ENTRIES_STORE),
        indexes,
        collection,
        record
      );
    });
  }
  async removeIndexEntries(collection, record) {
    const definitions = await this.listIndexes(collection);
    await this.runInTransaction(INDEX_ENTRIES_STORE, "readwrite", async (transaction) => {
      await this.removeIndexEntriesInStore(
        transaction.objectStore(INDEX_ENTRIES_STORE),
        definitions,
        collection,
        record
      );
    });
  }
  async listIndexesFromStore(store, collection) {
    const rows = await this.request(store.getAll());
    return rows.filter((row) => !collection || row.collection === collection || row.id.startsWith(`${collection}:`)).map((row) => {
      const definition = { ...row };
      delete definition.id;
      return clone(definition);
    });
  }
  async assertUniqueIndexesInStore(entryStore, definitions, collection, record, allowedIds) {
    const lookupIndex = entryStore.index(LOOKUP_INDEX);
    for (const definition of definitions) {
      if (!definition.unique) {
        continue;
      }
      const lookup = this.lookupKey(
        collection,
        definition.name,
        serializeCompoundIndexValue(readIndexFields(record, definition.fields))
      );
      const entries = await this.request(lookupIndex.getAll(lookup));
      if (entries.some((entry) => !allowedIds.has(entry.recordId))) {
        throw new Error(`Unique index "${definition.name}" violated for ${collection}`);
      }
    }
  }
  async writeIndexEntriesInStore(entryStore, definitions, collection, record) {
    for (const definition of definitions) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const entry = {
        collection,
        id: this.entryId(collection, definition.name, valueKey, record.id),
        indexName: definition.name,
        lookup: this.lookupKey(collection, definition.name, valueKey),
        recordId: record.id,
        valueKey
      };
      await this.request(entryStore.put(entry));
    }
  }
  async removeIndexEntriesInStore(entryStore, definitions, collection, record) {
    for (const definition of definitions) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      await this.request(
        entryStore.delete(this.entryId(collection, definition.name, valueKey, record.id))
      );
    }
  }
  async runInTransaction(storeNames, mode, run) {
    const database = await this.database();
    const transaction = database.transaction(storeNames, mode);
    const done = new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });
    try {
      const result = await run(transaction);
      await done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
      }
      await done.catch(() => void 0);
      throw error;
    }
  }
  async getCollectionRows(collection) {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index(COLLECTION_INDEX);
    return this.request(index.getAll(collection));
  }
  async getEntriesForCollection(collection) {
    const database = await this.database();
    const transaction = database.transaction(INDEX_ENTRIES_STORE, "readonly");
    const index = transaction.objectStore(INDEX_ENTRIES_STORE).index(COLLECTION_INDEX);
    return this.request(index.getAll(collection));
  }
  store(mode) {
    return this.objectStoreProxy(STORE_NAME, mode);
  }
  indexStore(mode) {
    return this.objectStoreProxy(INDEX_STORE_NAME, mode);
  }
  entryStore(mode) {
    return this.objectStoreProxy(INDEX_ENTRIES_STORE, mode);
  }
  entryLookup(mode) {
    const databasePromise = this.database();
    return {
      getAll: (lookup) => databasePromise.then(
        (database) => database.transaction(INDEX_ENTRIES_STORE, mode).objectStore(INDEX_ENTRIES_STORE).index(LOOKUP_INDEX).getAll(lookup)
      )
    };
  }
  objectStoreProxy(storeName, mode) {
    const databasePromise = this.database();
    return {
      get: (key) => databasePromise.then(
        (database) => database.transaction(storeName, mode).objectStore(storeName).get(key)
      ),
      put: (value) => databasePromise.then(
        (database) => database.transaction(storeName, mode).objectStore(storeName).put(value)
      ),
      delete: (key) => databasePromise.then(
        (database) => database.transaction(storeName, mode).objectStore(storeName).delete(key)
      ),
      clear: () => databasePromise.then(
        (database) => database.transaction(storeName, mode).objectStore(storeName).clear()
      ),
      getAll: () => databasePromise.then(
        (database) => database.transaction(storeName, mode).objectStore(storeName).getAll()
      )
    };
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
        if (!database.objectStoreNames.contains(INDEX_ENTRIES_STORE)) {
          const entries = database.createObjectStore(INDEX_ENTRIES_STORE, { keyPath: "id" });
          entries.createIndex(LOOKUP_INDEX, LOOKUP_INDEX, { unique: false });
          entries.createIndex(COLLECTION_INDEX, COLLECTION_INDEX, { unique: false });
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
  lookupKey(collection, indexName, valueKey) {
    return `${collection}:${indexName}:${valueKey}`;
  }
  entryId(collection, indexName, valueKey, recordId) {
    return `${collection}:${indexName}:${valueKey}:${recordId}`;
  }
};
var createIndexedDBStorage = (options) => new IndexedDBStorageAdapter(options);

// packages/storage-opfs/src/index.ts
var OPFSStorageAdapter = class {
  name = "opfs";
  contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  capabilities = {
    indexes: true,
    bulkWrites: true,
    migrations: true,
    persistence: "durable",
    transactions: "best-effort"
  };
  directory;
  rootName;
  constructor(options = {}) {
    this.directory = options.directory;
    this.rootName = options.rootName ?? options.rootDirectoryName ?? "offlinejs";
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
    await this.setMany(collection, [value]);
  }
  async setMany(collection, values) {
    if (values.length === 0) {
      return;
    }
    const byId = /* @__PURE__ */ new Map();
    for (const value of values) {
      byId.set(value.id, value);
    }
    const records = [...byId.values()];
    const previousById = /* @__PURE__ */ new Map();
    for (const record of records) {
      const previous = await this.get(collection, record.id);
      if (previous) {
        previousById.set(record.id, previous);
      }
      await this.assertUniqueIndexes(collection, record, previous?.id);
    }
    const indexes = await this.listIndexes(collection);
    let indexData = await this.readIndexData(collection);
    const manifest = await this.readManifest(collection);
    const ids = new Set(manifest.ids);
    for (const record of records) {
      const previous = previousById.get(record.id);
      if (previous) {
        indexData = this.removeIndexEntriesInMemory(indexData, indexes, previous);
      }
      const file = await this.file(collection, `${record.id}.json`, true);
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(record));
      await writable.close();
      ids.add(record.id);
      indexData = this.addIndexEntriesInMemory(indexData, indexes, record);
    }
    await this.writeManifest(collection, { ids: [...ids] });
    await this.trackCollection(collection);
    await this.writeIndexData(collection, indexData);
  }
  async delete(collection, id) {
    const previous = await this.get(collection, id);
    if (previous) {
      await this.removeIndexEntries(collection, previous);
    }
    await (await this.collectionDirectory(collection)).removeEntry(`${id}.json`);
    await this.updateManifest(collection, (ids) => ids.filter((value) => value !== id));
  }
  async find(collection, query) {
    const indexed = await this.findViaIndex(collection, query);
    const records = indexed ?? await this.loadAllRecords(collection);
    return applyQuery(records, query);
  }
  async clear(collection) {
    const root = await this.rootDirectory();
    if (collection) {
      await root.removeEntry(collection, { recursive: true });
      await this.updateCollections((names) => names.filter((name) => name !== collection));
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
    await this.trackCollection(definition.collection);
    const data = await this.readIndexData(definition.collection);
    data[definition.name] = {};
    await this.writeIndexData(definition.collection, data);
    for (const record of await this.loadAllRecords(definition.collection)) {
      await this.assertUniqueIndexes(definition.collection, record);
      await this.writeIndexEntries(definition.collection, record, [definition]);
    }
  }
  async dropIndex(collection, name) {
    const indexes = (await this.listIndexes(collection)).filter((index) => index.name !== name);
    await this.writeIndexes(collection, indexes);
    const data = await this.readIndexData(collection);
    delete data[name];
    await this.writeIndexData(collection, data);
  }
  async listIndexes(collection) {
    if (collection) {
      return this.readIndexes(collection);
    }
    const collections = await this.readCollections();
    const indexes = [];
    for (const name of collections) {
      indexes.push(...await this.readIndexes(name));
    }
    return indexes;
  }
  async findViaIndex(collection, query) {
    const match = findMatchingIndex(
      await this.listIndexes(collection),
      getEqualityFilterLookups(query?.filters)
    );
    if (!match) {
      return null;
    }
    const data = await this.readIndexData(collection);
    const ids = data[match.index.name]?.[serializeCompoundIndexValue(match.values)] ?? [];
    const records = [];
    for (const id of ids) {
      const record = await this.get(collection, id);
      if (record) {
        records.push(record);
      }
    }
    return records;
  }
  async loadAllRecords(collection) {
    const manifest = await this.readManifest(collection);
    const records = [];
    for (const id of manifest.ids) {
      const record = await this.get(collection, id);
      if (record) {
        records.push(record);
      }
    }
    return records;
  }
  async assertUniqueIndexes(collection, record, ignoreId) {
    const data = await this.readIndexData(collection);
    for (const definition of await this.listIndexes(collection)) {
      if (!definition.unique) {
        continue;
      }
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const ids = data[definition.name]?.[valueKey] ?? [];
      if (ids.some((id) => id !== record.id && id !== ignoreId)) {
        throw new Error(`Unique index "${definition.name}" violated for ${collection}`);
      }
    }
  }
  async writeIndexEntries(collection, record, definitions) {
    const indexes = definitions ?? await this.listIndexes(collection);
    if (indexes.length === 0) {
      return;
    }
    const data = this.addIndexEntriesInMemory(await this.readIndexData(collection), indexes, record);
    await this.writeIndexData(collection, data);
  }
  async removeIndexEntries(collection, record) {
    const indexes = await this.listIndexes(collection);
    if (indexes.length === 0) {
      return;
    }
    const data = this.removeIndexEntriesInMemory(
      await this.readIndexData(collection),
      indexes,
      record
    );
    await this.writeIndexData(collection, data);
  }
  addIndexEntriesInMemory(data, indexes, record) {
    const next = { ...data };
    for (const definition of indexes) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const bucket = { ...next[definition.name] ?? {} };
      const ids = new Set(bucket[valueKey] ?? []);
      ids.add(record.id);
      bucket[valueKey] = [...ids];
      next[definition.name] = bucket;
    }
    return next;
  }
  removeIndexEntriesInMemory(data, indexes, record) {
    const next = { ...data };
    for (const definition of indexes) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const bucket = { ...next[definition.name] ?? {} };
      if (!bucket[valueKey]) {
        continue;
      }
      bucket[valueKey] = bucket[valueKey].filter((id) => id !== record.id);
      if (bucket[valueKey].length === 0) {
        delete bucket[valueKey];
      }
      next[definition.name] = bucket;
    }
    return next;
  }
  async writeManifest(collection, manifest) {
    const file = await this.file(collection, "__manifest.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(manifest));
    await writable.close();
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
    const storage2 = globalThis.navigator?.storage;
    const root = await storage2?.getDirectory?.();
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
  async readIndexes(collection) {
    try {
      const file = await this.file(collection, "__indexes.json");
      return JSON.parse(await (await file.getFile()).text());
    } catch {
      return [];
    }
  }
  async writeIndexes(collection, indexes) {
    const file = await this.file(collection, "__indexes.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(indexes));
    await writable.close();
  }
  async readIndexData(collection) {
    try {
      const file = await this.file(collection, "__index_data.json");
      return JSON.parse(await (await file.getFile()).text());
    } catch {
      return {};
    }
  }
  async writeIndexData(collection, data) {
    const file = await this.file(collection, "__index_data.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
  }
  async readCollections() {
    try {
      const root = await this.rootDirectory();
      const file = await root.getFileHandle("__collections.json");
      return JSON.parse(await (await file.getFile()).text());
    } catch {
      return [];
    }
  }
  async trackCollection(collection) {
    await this.updateCollections((names) => [.../* @__PURE__ */ new Set([...names, collection])]);
  }
  async updateCollections(update) {
    const names = update(await this.readCollections());
    const root = await this.rootDirectory();
    const file = await root.getFileHandle("__collections.json", { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(names));
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

// packages/devtools-ui/src/index.ts
var EVENT_NAMES = [
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
var STYLE_ID = "offlinejs-devtools-styles";
var createDevtoolsController = (db2, options = {}) => {
  const maxEvents = options.maxEvents ?? 200;
  const queueCollection = options.queueCollection ?? "__offline_queue";
  const position = options.position ?? "bottom";
  const storage2 = options.storage;
  const entries = [];
  const enabledTypes = new Set(EVENT_NAMES);
  let seq = 0;
  let paused = Boolean(options.paused);
  let filterText = options.filter ?? "";
  let selectedId = null;
  let inspectorTab = "action";
  let queueSnapshot = [];
  let mode = null;
  let host = null;
  let root = null;
  let keyHandler = null;
  ensureStyles();
  const record = (event, payload) => {
    if (paused || !enabledTypes.has(event)) {
      return;
    }
    seq += 1;
    const entry = {
      id: `ojd-${seq}`,
      seq,
      event,
      payload: sanitizePayload(payload),
      timestamp: Date.now()
    };
    entries.unshift(entry);
    if (entries.length > maxEvents) {
      entries.length = maxEvents;
    }
    if (!selectedId) {
      selectedId = entry.id;
    }
    paint();
    void refreshQueue().then(paint);
  };
  const disposers = EVENT_NAMES.map(
    (event) => db2.on(event, (payload) => {
      record(event, payload);
    })
  );
  const filtered = () => {
    const query = filterText.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!enabledTypes.has(entry.event)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return entry.event.toLowerCase().includes(query) || JSON.stringify(entry.payload).toLowerCase().includes(query);
    });
  };
  const refreshQueue = async () => {
    if (!storage2) {
      queueSnapshot = [];
      return;
    }
    try {
      queueSnapshot = await storage2.find(queueCollection);
    } catch {
      queueSnapshot = [];
    }
  };
  const ensureRoot = () => {
    if (root) {
      return root;
    }
    root = document.createElement("div");
    root.className = "ojd-root";
    root.dataset.offlinejsDevtools = "true";
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("keydown", onKeydown);
    return root;
  };
  const paint = () => {
    if (!root) {
      return;
    }
    const selected = entries.find((entry) => entry.id === selectedId) ?? filtered()[0] ?? null;
    if (selected && selected.id !== selectedId) {
      selectedId = selected.id;
    }
    root.innerHTML = createMarkup({
      entries: filtered(),
      selected,
      paused,
      filterText,
      enabledTypes,
      inspectorTab,
      queueSnapshot,
      mode: mode ?? "inline",
      position,
      total: entries.length
    });
  };
  const mountInline = (target) => {
    closeDock();
    mode = "inline";
    host = target;
    const node = ensureRoot();
    node.classList.remove("ojd-dock");
    node.classList.add("ojd-inline");
    node.dataset.position = "inline";
    target.replaceChildren(node);
    paint();
    void refreshQueue().then(paint);
  };
  const openDock = () => {
    mode = "dock";
    const node = ensureRoot();
    node.classList.remove("ojd-inline");
    node.classList.add("ojd-dock");
    node.dataset.position = position;
    if (!node.isConnected) {
      document.body.appendChild(node);
    }
    if (!keyHandler) {
      keyHandler = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
          event.preventDefault();
          toggle();
        }
      };
      window.addEventListener("keydown", keyHandler);
    }
    paint();
    void refreshQueue().then(paint);
  };
  const closeDock = () => {
    if (mode === "dock" && root?.isConnected) {
      root.remove();
    }
    if (mode === "dock") {
      mode = null;
    }
  };
  const toggle = () => {
    if (mode === "dock" && root?.isConnected) {
      close();
      return;
    }
    open();
  };
  const open = () => {
    openDock();
  };
  const close = () => {
    closeDock();
    if (mode === "inline" && host && root) {
      root.dataset.collapsed = "true";
      paint();
      return;
    }
    mode = null;
  };
  function onClick(event) {
    const target = event.target;
    const action = target?.closest("[data-ojd-action]")?.dataset.ojdAction;
    if (!action) {
      const row = target?.closest("[data-ojd-id]");
      if (row?.dataset.ojdId) {
        selectedId = row.dataset.ojdId;
        inspectorTab = "action";
        paint();
      }
      return;
    }
    switch (action) {
      case "pause":
        paused = !paused;
        paint();
        break;
      case "clear":
        entries.length = 0;
        selectedId = null;
        paint();
        break;
      case "close":
        close();
        break;
      case "open":
        open();
        break;
      case "tab-action":
        inspectorTab = "action";
        paint();
        break;
      case "tab-state":
        inspectorTab = "state";
        void refreshQueue().then(paint);
        break;
      case "toggle-type": {
        const type = target?.closest("[data-ojd-type]")?.dataset.ojdType;
        if (!type) {
          break;
        }
        if (enabledTypes.has(type)) {
          enabledTypes.delete(type);
        } else {
          enabledTypes.add(type);
        }
        paint();
        break;
      }
      default:
        break;
    }
  }
  function onInput(event) {
    const target = event.target;
    if (target?.dataset.ojdInput === "filter") {
      filterText = target.value;
      paint();
    }
  }
  function onChange(event) {
    onInput(event);
  }
  function onKeydown(event) {
    if (event.key === "Escape" && mode === "dock") {
      close();
    }
  }
  return {
    clear() {
      entries.length = 0;
      selectedId = null;
      paint();
    },
    close,
    destroy() {
      for (const dispose of disposers) {
        dispose();
      }
      if (keyHandler) {
        window.removeEventListener("keydown", keyHandler);
        keyHandler = null;
      }
      closeDock();
      if (mode === "inline" && root?.parentElement) {
        root.remove();
      }
      root = null;
      host = null;
      mode = null;
    },
    events: () => [...entries],
    mount: mountInline,
    open,
    pause() {
      paused = true;
      paint();
    },
    render: mountInline,
    resume() {
      paused = false;
      paint();
    },
    select(id) {
      selectedId = id;
      paint();
    },
    toggle
  };
};
var sanitizePayload = (payload) => {
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: payload.message,
      stack: payload.stack
    };
  }
  return payload;
};
var ensureStyles = () => {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DEVTOOLS_CSS;
  document.head.appendChild(style);
};
var createMarkup = (state) => {
  const collapsed = state.mode === "inline" ? "" : "";
  return `
    <div class="ojd-shell ${collapsed}" data-position="${escapeHtml(state.position)}">
      <header class="ojd-toolbar">
        <div class="ojd-brand">
          <span class="ojd-dot" aria-hidden="true"></span>
          <strong>OfflineJS DevTools</strong>
          <span class="ojd-meta">${state.total} event${state.total === 1 ? "" : "s"}</span>
        </div>
        <div class="ojd-tools">
          <input
            class="ojd-filter"
            data-ojd-input="filter"
            type="search"
            placeholder="Filter events\u2026"
            value="${escapeHtml(state.filterText)}"
          />
          <button type="button" class="ojd-btn" data-ojd-action="pause">${state.paused ? "Resume" : "Pause"}</button>
          <button type="button" class="ojd-btn" data-ojd-action="clear">Clear</button>
          ${state.mode === "dock" ? `<button type="button" class="ojd-btn" data-ojd-action="close" aria-label="Close">\u2715</button>` : ""}
        </div>
      </header>

      <div class="ojd-filters">
        ${EVENT_NAMES.map((name) => {
    const on = state.enabledTypes.has(name);
    return `<button type="button" class="ojd-chip ${on ? "is-on" : ""}" data-ojd-action="toggle-type" data-ojd-type="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
  }).join("")}
      </div>

      <div class="ojd-body">
        <aside class="ojd-list" aria-label="Event log">
          ${state.entries.length === 0 ? `<p class="ojd-empty">Waiting for sync, queue, network, and conflict events\u2026</p>` : state.entries.map((entry) => {
    const active = state.selected?.id === entry.id ? "is-selected" : "";
    return `
                      <button type="button" class="ojd-row ${active} tone-${toneFor(entry.event)}" data-ojd-id="${escapeHtml(entry.id)}">
                        <span class="ojd-row-seq">#${entry.seq}</span>
                        <span class="ojd-row-name">${escapeHtml(entry.event)}</span>
                        <span class="ojd-row-summary">${escapeHtml(summarize(entry))}</span>
                        <time class="ojd-row-time">${escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}</time>
                      </button>`;
  }).join("")}
        </aside>

        <section class="ojd-inspector" aria-label="Inspector">
          <div class="ojd-tabs">
            <button type="button" class="ojd-tab ${state.inspectorTab === "action" ? "is-on" : ""}" data-ojd-action="tab-action">Action</button>
            <button type="button" class="ojd-tab ${state.inspectorTab === "state" ? "is-on" : ""}" data-ojd-action="tab-state">State / Outbox</button>
          </div>
          <div class="ojd-inspect-body">
            ${state.inspectorTab === "state" ? renderStateTab(state.queueSnapshot) : renderActionTab(state.selected)}
          </div>
        </section>
      </div>
      <footer class="ojd-footer">Tip: Ctrl/\u2318 + Shift + O toggles the floating dock</footer>
    </div>
  `;
};
var renderActionTab = (selected) => {
  if (!selected) {
    return `<p class="ojd-empty">Select an event from the log.</p>`;
  }
  return `
    <div class="ojd-action-head">
      <h3>${escapeHtml(selected.event)}</h3>
      <p>#${selected.seq} \xB7 ${escapeHtml(new Date(selected.timestamp).toLocaleString())}</p>
    </div>
    <pre class="ojd-json">${escapeHtml(stringify(selected.payload))}</pre>
  `;
};
var renderStateTab = (queue) => `
  <div class="ojd-action-head">
    <h3>Outbox snapshot</h3>
    <p>${queue.length} queued mutation${queue.length === 1 ? "" : "s"}</p>
  </div>
  <pre class="ojd-json">${escapeHtml(stringify(queue))}</pre>
`;
var summarize = (entry) => {
  const payload = entry.payload;
  if (!payload || typeof payload !== "object") {
    return "";
  }
  if (entry.event === "queue:add" || entry.event === "queue:complete") {
    return `${String(payload.operation ?? "")} ${String(payload.collection ?? "")}/${String(payload.recordId ?? "")}`.trim();
  }
  if (entry.event === "sync:start") {
    return `queued ${String(payload.queued ?? 0)}`;
  }
  if (entry.event === "sync:end") {
    return `ok ${String(payload.completed ?? 0)} / fail ${String(payload.failed ?? 0)}`;
  }
  if (entry.event === "conflict") {
    return String(payload.collection ?? "conflict");
  }
  if (entry.event === "error") {
    return String(payload.message ?? "error");
  }
  if (entry.event === "online" || entry.event === "offline") {
    return payload.online ? "online" : "offline";
  }
  return "";
};
var toneFor = (event) => {
  if (event === "error" || event === "conflict") {
    return "danger";
  }
  if (event === "queue:add" || event === "queue:complete") {
    return "queue";
  }
  if (event === "sync:start" || event === "sync:end") {
    return "sync";
  }
  if (event === "online" || event === "offline") {
    return "net";
  }
  return "default";
};
var stringify = (value) => {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
};
var escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
var DEVTOOLS_CSS = `
.ojd-root {
  --ojd-bg: #0f1719;
  --ojd-panel: #152226;
  --ojd-panel-2: #1b2b30;
  --ojd-ink: #e7f7f3;
  --ojd-muted: #9bb5b0;
  --ojd-line: rgba(231, 247, 243, 0.12);
  --ojd-accent: #2dd4bf;
  --ojd-warn: #f4a261;
  --ojd-danger: #fb7185;
  --ojd-queue: #7dd3fc;
  --ojd-sync: #a3e635;
  --ojd-net: #c4b5fd;
  --ojd-font: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  --ojd-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ojd-ink);
  font-family: var(--ojd-font);
  box-sizing: border-box;
}
.ojd-root *, .ojd-root *::before, .ojd-root *::after { box-sizing: border-box; }
.ojd-inline { width: 100%; min-height: 22rem; }
.ojd-dock {
  position: fixed;
  z-index: 2147483000;
  box-shadow: 0 -12px 40px rgba(0,0,0,.35);
}
.ojd-dock[data-position="bottom"] {
  left: 0; right: 0; bottom: 0; height: min(42vh, 420px);
}
.ojd-dock[data-position="right"] {
  top: 0; right: 0; bottom: 0; width: min(42vw, 480px);
}
.ojd-shell {
  display: flex; flex-direction: column; height: 100%;
  background: linear-gradient(180deg, var(--ojd-panel), var(--ojd-bg));
  border: 1px solid var(--ojd-line);
  border-radius: 12px;
  overflow: hidden;
}
.ojd-dock .ojd-shell { border-radius: 12px 12px 0 0; height: 100%; }
.ojd-dock[data-position="right"] .ojd-shell { border-radius: 12px 0 0 12px; }
.ojd-toolbar, .ojd-footer, .ojd-filters, .ojd-tabs, .ojd-action-head {
  padding: 0.65rem 0.8rem;
}
.ojd-toolbar {
  display: flex; gap: 0.75rem; align-items: center; justify-content: space-between;
  border-bottom: 1px solid var(--ojd-line); background: rgba(0,0,0,.18);
}
.ojd-brand { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.ojd-brand strong { font-size: 0.92rem; letter-spacing: -0.02em; }
.ojd-dot {
  width: 0.55rem; height: 0.55rem; border-radius: 999px; background: var(--ojd-accent);
  box-shadow: 0 0 0 3px rgba(45,212,191,.18);
}
.ojd-meta, .ojd-row-time, .ojd-empty, .ojd-footer, .ojd-action-head p { color: var(--ojd-muted); font-size: 0.78rem; }
.ojd-tools { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.ojd-filter {
  width: min(14rem, 42vw); border: 1px solid var(--ojd-line); border-radius: 8px;
  background: var(--ojd-panel-2); color: var(--ojd-ink); padding: 0.35rem 0.55rem; font: inherit;
}
.ojd-btn, .ojd-chip, .ojd-tab, .ojd-row {
  border: 1px solid var(--ojd-line); background: var(--ojd-panel-2); color: var(--ojd-ink);
  border-radius: 8px; cursor: pointer; font: inherit;
}
.ojd-btn { padding: 0.3rem 0.55rem; font-size: 0.78rem; }
.ojd-btn:hover, .ojd-chip:hover, .ojd-tab:hover, .ojd-row:hover { border-color: rgba(45,212,191,.45); }
.ojd-filters {
  display: flex; flex-wrap: wrap; gap: 0.35rem; border-bottom: 1px solid var(--ojd-line);
}
.ojd-chip { padding: 0.2rem 0.45rem; font-size: 0.7rem; opacity: 0.55; }
.ojd-chip.is-on { opacity: 1; background: rgba(45,212,191,.12); border-color: rgba(45,212,191,.35); }
.ojd-body { display: grid; grid-template-columns: minmax(12rem, 38%) 1fr; min-height: 0; flex: 1; }
@media (max-width: 720px) {
  .ojd-body { grid-template-columns: 1fr; grid-template-rows: 40% 1fr; }
}
.ojd-list { overflow: auto; border-right: 1px solid var(--ojd-line); min-height: 0; }
.ojd-row {
  width: 100%; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto;
  gap: 0.1rem 0.55rem; text-align: left; padding: 0.55rem 0.7rem; border-radius: 0; border: 0;
  border-bottom: 1px solid var(--ojd-line); background: transparent;
}
.ojd-row.is-selected { background: rgba(45,212,191,.1); }
.ojd-row-seq { grid-row: 1 / span 2; align-self: center; color: var(--ojd-muted); font-family: var(--ojd-mono); font-size: 0.72rem; }
.ojd-row-name { font-weight: 700; font-size: 0.82rem; }
.ojd-row-summary { grid-column: 2; color: var(--ojd-muted); font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ojd-row-time { grid-column: 2; justify-self: end; }
.ojd-row.tone-danger .ojd-row-name { color: var(--ojd-danger); }
.ojd-row.tone-queue .ojd-row-name { color: var(--ojd-queue); }
.ojd-row.tone-sync .ojd-row-name { color: var(--ojd-sync); }
.ojd-row.tone-net .ojd-row-name { color: var(--ojd-net); }
.ojd-inspector { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.ojd-tabs { display: flex; gap: 0.35rem; border-bottom: 1px solid var(--ojd-line); }
.ojd-tab { padding: 0.35rem 0.65rem; font-size: 0.78rem; background: transparent; }
.ojd-tab.is-on { background: rgba(45,212,191,.12); border-color: rgba(45,212,191,.35); }
.ojd-inspect-body { overflow: auto; padding: 0.75rem; min-height: 0; flex: 1; }
.ojd-action-head h3 { margin: 0 0 0.2rem; font-size: 1rem; }
.ojd-action-head { padding: 0 0 0.75rem; }
.ojd-json {
  margin: 0; padding: 0.75rem; border-radius: 10px; overflow: auto;
  background: rgba(0,0,0,.28); border: 1px solid var(--ojd-line);
  font-family: var(--ojd-mono); font-size: 0.75rem; line-height: 1.45; white-space: pre-wrap;
}
.ojd-empty { margin: 1rem; }
.ojd-footer { border-top: 1px solid var(--ojd-line); }
`;

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
  setup({ db: db2, events, storage: storage2 }) {
    const logger = options.logger ?? console;
    const disposers = eventNames.map(
      (eventName) => events.on(eventName, (payload) => {
        if (eventName === "error") {
          logger.error("[offlinejs]", eventName, payload);
          return;
        }
        logger.debug("[offlinejs]", eventName, payload);
      })
    );
    let panel2;
    if (options.ui && typeof document !== "undefined") {
      const uiOptions = options.ui === true ? {} : options.ui;
      panel2 = createDevtoolsController(db2, {
        ...uiOptions,
        storage: uiOptions.storage ?? storage2
      });
      panel2.open();
    }
    return () => {
      panel2?.destroy();
      for (const dispose of disposers) {
        dispose();
      }
    };
  }
});

// packages/offlinejs/src/index.ts
var isBrowserRuntime = () => typeof globalThis.window !== "undefined" && typeof globalThis.indexedDB !== "undefined";
var isStorageAdapter = (value) => typeof value === "object" && value !== null && "get" in value && "set" in value;
var resolveStorage = (storage2) => {
  if (isStorageAdapter(storage2)) {
    return storage2;
  }
  const preset = storage2 ?? (isBrowserRuntime() ? "indexeddb" /* IndexedDB */ : "memory" /* Memory */);
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
  const { storage: storage2, ...rest } = options;
  return createOfflineDB({
    ...rest,
    storage: resolveStorage(storage2)
  });
};

// docs-site/demo/fake-api.ts
var NAMES = [
  "Espresso beans",
  "Oat milk",
  "Paper cups",
  "Cold brew concentrate",
  "Sugar sticks",
  "Croissant dough",
  "Matcha powder",
  "Ceramic mugs",
  "Cleaning tablets",
  "Vanilla syrup"
];
var AISLES = ["A1", "A2", "B1", "B2", "C1", "Cold"];
var randomItem = (items) => items[Math.floor(Math.random() * items.length)];
var createId2 = () => globalThis.crypto?.randomUUID?.() ?? `stock_${Date.now()}_${Math.random().toString(16).slice(2)}`;
var createSku = () => `SKU-${Math.floor(1e3 + Math.random() * 9e3)}`;
var FakeStockApi = class {
  records = /* @__PURE__ */ new Map();
  conflictOnce = /* @__PURE__ */ new Set();
  constructor() {
    this.seedRandom(4);
  }
  list() {
    return [...this.records.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  get(id) {
    return this.records.get(id) ?? null;
  }
  seedRandom(count = 5) {
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const now2 = Date.now() - Math.floor(Math.random() * 5e4);
      const item = {
        id: createId2(),
        sku: createSku(),
        name: randomItem(NAMES),
        qty: 4 + Math.floor(Math.random() * 24),
        aisle: randomItem(AISLES),
        createdAt: now2,
        updatedAt: now2
      };
      this.records.set(item.id, item);
      created.push(item);
    }
    return created;
  }
  /** Change the server copy and force the next client write to 409. */
  prepareConflict(id) {
    const current = this.records.get(id);
    if (!current) {
      return null;
    }
    const serverEdit = {
      ...current,
      qty: current.qty + 3 + Math.floor(Math.random() * 5),
      aisle: randomItem(AISLES),
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
          const error = new Error("Remote warehouse API is offline");
          Object.assign(error, { status: 0 });
          throw error;
        }
        await delay(140 + Math.floor(Math.random() * 200));
        return this.handle(request);
      }
    };
  }
  async handle(request) {
    const [collection, id] = request.path.replace(/^\//, "").split("/");
    if (collection !== "stock") {
      return { data: null, status: 404 };
    }
    if (request.method === "GET" && !id) {
      return { data: this.list(), status: 200 };
    }
    if (request.method === "POST" && !id) {
      const body = request.body ?? {};
      const now2 = Date.now();
      const item = {
        id: typeof body.id === "string" ? body.id : createId2(),
        sku: String(body.sku ?? createSku()),
        name: String(body.name ?? "Untitled item"),
        qty: Number(body.qty ?? 0),
        aisle: String(body.aisle ?? "A1"),
        createdAt: Number(body.createdAt ?? now2),
        updatedAt: Number(body.updatedAt ?? now2)
      };
      this.records.set(item.id, item);
      return { data: item, status: 201 };
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
        sku: String(body.sku ?? existing?.sku ?? createSku()),
        name: String(body.name ?? existing?.name ?? "Untitled item"),
        qty: Number(body.qty ?? existing?.qty ?? 0),
        aisle: String(body.aisle ?? existing?.aisle ?? "A1"),
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
var DB_NAME = "offlinejs-stock-demo";
var QUEUE_COLLECTION = "__offline_queue";
var api = new FakeStockApi();
var network = new BrowserNetworkMonitor({ initialOnline: true });
var storage = createIndexedDBStorage({ databaseName: DB_NAME });
var conflictStrategy = "lastWriteWins" /* LastWriteWins */;
var db = createDemoDb();
var panel = createDevtoolsController(db, { storage });
var unsubscribe;
var eventDisposers = [];
var els;
var requireEl = (selector) => {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Demo UI missing required element: ${selector}`);
  }
  return element;
};
var bindElements = () => ({
  onlineToggle: requireEl("#online-toggle"),
  onlineLabel: requireEl("#online-label"),
  linkState: requireEl("#link-state"),
  strategy: requireEl("#conflict-strategy"),
  seedBtn: requireEl("#seed-random"),
  syncBtn: requireEl("#sync-now"),
  conflictBtn: requireEl("#simulate-conflict"),
  resetBtn: requireEl("#reset-demo"),
  nameInput: requireEl("#item-name"),
  qtyInput: requireEl("#item-qty"),
  addBtn: requireEl("#add-item"),
  deviceList: requireEl("#device-list"),
  outboxList: requireEl("#outbox-list"),
  serverList: requireEl("#server-list"),
  deviceMeta: requireEl("#device-meta"),
  outboxMeta: requireEl("#outbox-meta"),
  serverMeta: requireEl("#server-meta"),
  status: requireEl("#demo-status"),
  flow: requireEl("#sync-flow"),
  devtools: requireEl("#offlinejs-devtools")
});
function createDemoDb() {
  return createOfflineDB2({
    storage,
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
  if (document.readyState === "loading") {
    await new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
  }
  els = bindElements();
  panel.mount(els.devtools);
  wireControls();
  wireEvents();
  await bindCollection();
  await pullIfOnline();
  await refreshAll();
  setStatus("Go offline, change a quantity, watch the outbox fill, then sync.");
}
function wireControls() {
  els.onlineToggle.checked = network.isOnline();
  updateLinkUi(network.isOnline());
  els.onlineToggle.addEventListener("change", () => {
    network.setOnline(els.onlineToggle.checked);
    updateLinkUi(els.onlineToggle.checked);
    setStatus(
      els.onlineToggle.checked ? "Link restored \u2014 outbox can flush to the remote API." : "Link cut \u2014 edits stay on this device and pile up in the outbox."
    );
    void refreshAll();
  });
  els.strategy.value = String(conflictStrategy);
  els.strategy.addEventListener("change", async () => {
    conflictStrategy = els.strategy.value;
    await recreateDb(`Conflict strategy \u2192 ${conflictStrategy}`);
  });
  els.seedBtn.addEventListener("click", async () => {
    const created = api.seedRandom(4);
    if (network.isOnline()) {
      await db.collection("stock").sync();
      await db.sync();
      await refreshLocalFromServer();
    }
    await refreshAll();
    setStatus(`Remote API seeded ${created.length} stock lines.`);
  });
  els.syncBtn.addEventListener("click", async () => {
    if (!network.isOnline()) {
      setStatus("Can't sync while the link is offline.");
      return;
    }
    setStatus("Flushing outbox \u2192 remote API\u2026");
    els.flow?.classList.add("is-syncing");
    try {
      await db.collection("stock").sync();
      await db.sync();
      await refreshAll();
      setStatus("Sync finished. Device and remote should match (unless a conflict remains).");
    } finally {
      els.flow?.classList.remove("is-syncing");
    }
  });
  els.conflictBtn.addEventListener("click", async () => {
    const local = await db.collection("stock").find({ limit: 1 });
    const target = local[0];
    if (!target) {
      setStatus("Add or seed stock first, then sync it once.");
      return;
    }
    if (network.isOnline()) {
      await db.collection("stock").sync();
    }
    const serverEdit = api.prepareConflict(target.id);
    await db.collection("stock").update(target.id, {
      qty: Math.max(0, target.qty - 2),
      name: target.name
    });
    await refreshAll();
    setStatus(
      serverEdit ? `Conflict staged on ${target.name}: remote qty ${serverEdit.qty}, device qty ${Math.max(0, target.qty - 2)}. Sync to resolve.` : "Could not stage a conflict."
    );
  });
  els.resetBtn.addEventListener("click", async () => {
    api.clear();
    api.seedRandom(4);
    await recreateDb("Demo reset \u2014 fresh remote stock, empty device.", true);
  });
  els.addBtn.addEventListener("click", async () => {
    const name = els.nameInput.value.trim();
    const qty = Number(els.qtyInput.value || 0);
    if (!name) {
      return;
    }
    await db.collection("stock").create({
      name,
      qty: Number.isFinite(qty) ? qty : 0,
      sku: `SKU-${Math.floor(1e3 + Math.random() * 9e3)}`,
      aisle: "A1"
    });
    els.nameInput.value = "";
    els.qtyInput.value = "1";
    await refreshAll();
    setStatus(
      network.isOnline() ? "Created on device \u2014 sync will push it to the remote API." : "Created offline \u2014 sitting in the outbox until you go online."
    );
  });
  els.nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      els.addBtn.click();
    }
  });
  network.subscribe((state) => {
    els.onlineToggle.checked = state.online;
    updateLinkUi(state.online);
    void refreshAll();
  });
}
function wireEvents() {
  for (const dispose of eventDisposers) {
    dispose();
  }
  eventDisposers = [
    db.on("queue:add", () => {
      void refreshAll();
    }),
    db.on("queue:complete", () => {
      void refreshAll();
    }),
    db.on("sync:start", () => {
      els.flow?.classList.add("is-syncing");
    }),
    db.on("sync:end", () => {
      els.flow?.classList.remove("is-syncing");
      void refreshAll();
    }),
    db.on("conflict", (context) => {
      setStatus(
        `Conflict on ${context.collection}: device and remote disagreed \u2014 strategy ${String(conflictStrategy)} applied.`
      );
      void refreshAll();
    })
  ];
}
async function bindCollection() {
  unsubscribe?.();
  const stock = db.collection("stock");
  unsubscribe = stock.subscribe(async () => {
    await refreshAll();
  });
  await refreshAll();
}
async function recreateDb(message, clearLocal = false) {
  unsubscribe?.();
  for (const dispose of eventDisposers) {
    dispose();
  }
  eventDisposers = [];
  panel.destroy();
  await db.destroy();
  if (clearLocal && "indexedDB" in globalThis) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to delete demo DB"));
      request.onblocked = () => resolve();
    });
  }
  storage = createIndexedDBStorage({ databaseName: DB_NAME });
  db = createDemoDb();
  panel = createDevtoolsController(db, { storage });
  panel.mount(els.devtools);
  wireEvents();
  await bindCollection();
  await pullIfOnline();
  await refreshAll();
  setStatus(message);
}
async function pullIfOnline() {
  if (!network.isOnline()) {
    return;
  }
  await refreshLocalFromServer();
}
async function refreshLocalFromServer() {
  await db.collection("stock").sync();
}
async function refreshAll() {
  const [local, queue] = await Promise.all([
    db.collection("stock").find({ orderBy: "name", sort: "asc" }),
    storage.find(QUEUE_COLLECTION)
  ]);
  const remote = api.list();
  const pending = queue.filter((item) => item.status === "pending" || item.status === "processing" || item.status === "failed").sort((a, b) => a.createdAt - b.createdAt);
  renderDevice(local, remote, pending);
  renderOutbox(pending);
  renderServer(remote, local);
  updateLinkUi(network.isOnline());
}
function renderDevice(local, remote, pending) {
  const pendingIds = new Set(pending.map((item) => item.recordId));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  els.deviceMeta.textContent = `${local.length} item${local.length === 1 ? "" : "s"} in IndexedDB on this device`;
  els.deviceList.innerHTML = local.length ? local.map((item) => {
    const server = remoteById.get(item.id);
    const diverged = server ? server.qty !== item.qty || server.aisle !== item.aisle : false;
    const state = pendingIds.has(item.id) ? "queued" : !server ? "local-only" : diverged ? "diverged" : "synced";
    return `
          <article class="stock-card state-${state}" data-id="${escapeHtml2(item.id)}">
            <header>
              <div>
                <strong>${escapeHtml2(item.name)}</strong>
                <span class="stock-sku">${escapeHtml2(item.sku)} \xB7 aisle ${escapeHtml2(item.aisle)}</span>
              </div>
              <span class="stock-badge">${labelForState(state)}</span>
            </header>
            <div class="stock-qty-row">
              <button type="button" data-action="dec" aria-label="Decrease quantity">\u2212</button>
              <span class="stock-qty">${item.qty}</span>
              <button type="button" data-action="inc" aria-label="Increase quantity">+</button>
            </div>
            ${diverged && server ? `<p class="stock-diff">Remote still shows <strong>${server.qty}</strong> in ${escapeHtml2(server.aisle)}</p>` : ""}
            <div class="stock-actions">
              <button type="button" data-action="rename">Rename</button>
              <button type="button" data-action="delete" class="danger">Remove</button>
            </div>
          </article>`;
  }).join("") : `<p class="demo-empty">Nothing on this device yet. Seed the remote API, or add a line below.</p>`;
  els.deviceList.querySelectorAll(".stock-card").forEach((card) => {
    const id = card.dataset.id;
    const item = local.find((row) => row.id === id);
    if (!item) {
      return;
    }
    card.querySelector('[data-action="inc"]')?.addEventListener("click", async () => {
      await db.collection("stock").update(id, { qty: item.qty + 1 });
      await refreshAll();
      setStatus(`Device qty for ${item.name} \u2192 ${item.qty + 1}`);
    });
    card.querySelector('[data-action="dec"]')?.addEventListener("click", async () => {
      await db.collection("stock").update(id, { qty: Math.max(0, item.qty - 1) });
      await refreshAll();
      setStatus(`Device qty for ${item.name} \u2192 ${Math.max(0, item.qty - 1)}`);
    });
    card.querySelector('[data-action="rename"]')?.addEventListener("click", async () => {
      const next = globalThis.prompt("Rename stock item", item.name);
      if (!next) {
        return;
      }
      await db.collection("stock").update(id, { name: next });
      await refreshAll();
    });
    card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      await db.collection("stock").delete(id);
      await refreshAll();
    });
  });
}
function renderOutbox(pending) {
  els.outboxMeta.textContent = pending.length === 0 ? "Outbox empty \u2014 device and remote are caught up" : `${pending.length} mutation${pending.length === 1 ? "" : "s"} waiting to sync`;
  els.outboxList.innerHTML = pending.length ? pending.map(
    (mutation) => `
        <article class="outbox-card status-${escapeHtml2(mutation.status)}">
          <div class="outbox-op">${escapeHtml2(mutation.operation)}</div>
          <div>
            <strong>${escapeHtml2(String(mutation.payload?.name ?? mutation.recordId))}</strong>
            <span class="stock-sku">${escapeHtml2(mutation.collection)} \xB7 ${escapeHtml2(mutation.status)}</span>
            ${mutation.payload?.qty !== void 0 ? `<span class="outbox-qty">qty \u2192 ${Number(mutation.payload.qty)}</span>` : ""}
          </div>
        </article>`
  ).join("") : `<p class="demo-empty">No pending writes. Change a quantity while offline to see the queue.</p>`;
  els.outboxList.classList.toggle("has-items", pending.length > 0);
}
function renderServer(remote, local) {
  const localById = new Map(local.map((item) => [item.id, item]));
  els.serverMeta.textContent = `${remote.length} item${remote.length === 1 ? "" : "s"} on the fake warehouse API`;
  els.serverList.innerHTML = remote.length ? remote.map((item) => {
    const device = localById.get(item.id);
    const diverged = device ? device.qty !== item.qty : false;
    return `
          <article class="stock-card server-card ${diverged ? "state-diverged" : "state-synced"}">
            <header>
              <div>
                <strong>${escapeHtml2(item.name)}</strong>
                <span class="stock-sku">${escapeHtml2(item.sku)} \xB7 aisle ${escapeHtml2(item.aisle)}</span>
              </div>
              <span class="stock-badge">${device ? diverged ? "ahead of device" : "mirrored" : "remote only"}</span>
            </header>
            <div class="stock-qty-row readonly">
              <span class="stock-qty">${item.qty}</span>
            </div>
            ${diverged && device ? `<p class="stock-diff">Device still shows <strong>${device.qty}</strong></p>` : ""}
          </article>`;
  }).join("") : `<p class="demo-empty">Remote warehouse is empty. Seed random stock to begin.</p>`;
}
function updateLinkUi(online) {
  els.onlineLabel.textContent = online ? "Online" : "Offline";
  els.linkState.textContent = online ? "link open" : "link cut";
  els.linkState.dataset.state = online ? "online" : "offline";
  document.body.dataset.demoLink = online ? "online" : "offline";
}
function labelForState(state) {
  switch (state) {
    case "queued":
      return "in outbox";
    case "local-only":
      return "device only";
    case "diverged":
      return "out of sync";
    default:
      return "synced";
  }
}
function setStatus(message) {
  const status = els?.status ?? document.querySelector("#demo-status");
  if (status) {
    status.textContent = message;
  }
}
function escapeHtml2(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
void boot().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : "Demo failed to start";
  try {
    setStatus(message);
  } catch {
    const fallback = document.querySelector("#demo-status");
    if (fallback) {
      fallback.textContent = message;
    }
  }
});
