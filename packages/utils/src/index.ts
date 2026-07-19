import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  SYNC_TRANSPORT_CONTRACT_VERSION,
  type EntityRecord,
  type QueryFilterValue,
  type QueryOptions,
  type StorageAdapter,
  type SyncTransport
} from "@offlinejs/types";

type OperatorFilter = Extract<QueryFilterValue, { eq?: unknown }>;

export const now = (): number => Date.now();

export const isBrowser = (): boolean =>
  typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined";

export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

export const createId = (): string => {
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  return `offline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const clone = <TValue>(value: TValue): TValue => {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
};

export const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(typeof error === "string" ? error : "Unknown OfflineJS error");
};

export const assertStorageAdapter = (adapter: StorageAdapter): void => {
  const requiredMethods: Array<keyof StorageAdapter> = [
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

  if (
    adapter.contractVersion !== undefined &&
    adapter.contractVersion !== STORAGE_ADAPTER_CONTRACT_VERSION
  ) {
    throw new Error(
      `Unsupported storage adapter contract ${adapter.contractVersion}; expected ${STORAGE_ADAPTER_CONTRACT_VERSION}`
    );
  }
};

export const assertSyncTransport = (transport: SyncTransport): void => {
  if (typeof transport.request !== "function") {
    throw new Error("OfflineJS sync transport requires request()");
  }

  if (
    transport.contractVersion !== undefined &&
    transport.contractVersion !== SYNC_TRANSPORT_CONTRACT_VERSION
  ) {
    throw new Error(
      `Unsupported sync transport contract ${transport.contractVersion}; expected ${SYNC_TRANSPORT_CONTRACT_VERSION}`
    );
  }
};

export const toQueryString = (
  query?: Record<string, string | number | boolean | undefined>
): string => {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const result = params.toString();
  return result.length > 0 ? `?${result}` : "";
};

export const backoffDelay = (
  attempt: number,
  options: { baseDelayMs: number; factor: number; jitter: boolean; maxDelayMs: number }
): number => {
  const exponentialDelay = Math.min(
    options.baseDelayMs * options.factor ** Math.max(0, attempt - 1),
    options.maxDelayMs
  );

  if (!options.jitter) {
    return exponentialDelay;
  }

  return Math.round(exponentialDelay * (0.5 + Math.random() * 0.5));
};

export const matchesQuery = <TRecord extends EntityRecord>(
  record: TRecord,
  query: QueryOptions<TRecord> = {}
): boolean => {
  if (query.filters && !matchesFilters(record, query.filters as Record<string, QueryFilterValue>)) {
    return false;
  }

  if (!query.search) {
    return true;
  }

  const search = query.search.toLowerCase();
  const fields = query.searchFields?.map((field) => String(field)) ?? Object.keys(record);

  return fields.some((field) =>
    String(record[field] ?? "")
      .toLowerCase()
      .includes(search)
  );
};

export const applyQuery = <TRecord extends EntityRecord>(
  records: TRecord[],
  query: QueryOptions<TRecord> = {}
): TRecord[] => {
  const filtered = records.filter((record) => matchesQuery(record, query));
  const sorted = sortRecords(filtered, query);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = query.limit ?? sorted.length;

  return sorted.slice(offset, offset + limit);
};

export const countQuery = <TRecord extends EntityRecord>(
  records: TRecord[],
  query: QueryOptions<TRecord> = {}
): number => records.filter((record) => matchesQuery(record, query)).length;

const sortRecords = <TRecord extends EntityRecord>(
  records: TRecord[],
  query: QueryOptions<TRecord>
): TRecord[] => {
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

    if (leftValue === undefined || leftValue === null) {
      return -1 * direction;
    }

    if (rightValue === undefined || rightValue === null) {
      return direction;
    }

    return leftValue > rightValue ? direction : -direction;
  });
};

const matchesFilters = (
  record: EntityRecord,
  filters: Record<string, QueryFilterValue>
): boolean => {
  for (const [field, expected] of Object.entries(filters)) {
    const actual = record[field];

    if (Array.isArray(expected)) {
      if (!expected.includes(actual as never)) {
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

const matchesOperator = (actual: unknown, expected: OperatorFilter): boolean => {
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
    return String(actual ?? "")
      .toLowerCase()
      .includes(String(expected.contains).toLowerCase());
  }

  return true;
};

const isComparable = (value: unknown): value is number | string =>
  typeof value === "number" || typeof value === "string";

const isGreaterThan = (actual: unknown, expected: number | string | undefined): boolean =>
  isComparable(actual) && expected !== undefined && actual > expected;

const isGreaterThanOrEqual = (actual: unknown, expected: number | string | undefined): boolean =>
  isComparable(actual) && expected !== undefined && actual >= expected;

const isLessThan = (actual: unknown, expected: number | string | undefined): boolean =>
  isComparable(actual) && expected !== undefined && actual < expected;

const isLessThanOrEqual = (actual: unknown, expected: number | string | undefined): boolean =>
  isComparable(actual) && expected !== undefined && actual <= expected;
