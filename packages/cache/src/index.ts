import { now } from "@offlinejs/utils";

/** Stored HTTP/JSON cache entry. */
export interface CacheEntry<TBody = unknown> {
  body: TBody;
  cachedAt: number;
  /** Soft expiry — may still be served while revalidating. */
  expiresAt: number;
  headers: Record<string, string>;
  key: string;
  status: number;
  /** Hard expiry — never serve after this (defaults to expiresAt). */
  staleAt: number;
}

export interface HttpCacheStore {
  clear(): Promise<void>;
  delete(key: string): Promise<void>;
  get<TBody = unknown>(key: string): Promise<CacheEntry<TBody> | null>;
  set<TBody = unknown>(entry: CacheEntry<TBody>): Promise<void>;
}

export type CachePolicy = {
  /** Fresh window (ms). Default 60_000. */
  ttlMs?: number;
  /** Extra time to serve stale while revalidating (ms). Default 0. */
  staleWhileRevalidateMs?: number;
};

export type CachedFetchOptions = CachePolicy & {
  /** Override cache key (default: METHOD + URL). */
  key?: string;
  /** Only cache these methods. Default: GET, HEAD. */
  methods?: string[];
  /** Cache store. Default: memory. */
  store?: HttpCacheStore;
  /** Custom fetch implementation. */
  fetch?: typeof globalThis.fetch;
  /** Parse JSON instead of returning Response. */
  json?: boolean;
};

export type CachedResult<TBody> = {
  data: TBody;
  fromCache: boolean;
  headers: Record<string, string>;
  key: string;
  stale: boolean;
  status: number;
};

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_METHODS = new Set(["GET", "HEAD"]);

const normalizeHeaders = (headers?: HeadersInit): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      out[key.toLowerCase()] = value;
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = String(value);
  }
  return out;
};

export const buildCacheKey = (input: RequestInfo | URL, init?: RequestInit): string => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return `${method} ${url}`;
};

const resolvePolicy = (policy: CachePolicy = {}) => {
  const ttlMs = policy.ttlMs ?? DEFAULT_TTL_MS;
  const staleWhileRevalidateMs = policy.staleWhileRevalidateMs ?? 0;
  return { ttlMs, staleWhileRevalidateMs };
};

const isFresh = (entry: CacheEntry, at = now()): boolean => at < entry.expiresAt;
const isUsable = (entry: CacheEntry, at = now()): boolean => at < entry.staleAt;

/** In-memory HTTP cache (fast, tab-local). */
export const createMemoryHttpCache = (): HttpCacheStore => {
  const map = new Map<string, CacheEntry>();

  return {
    async get<TBody = unknown>(key: string) {
      const entry = map.get(key);
      return entry ? (structuredClone(entry) as CacheEntry<TBody>) : null;
    },
    async set(entry) {
      map.set(entry.key, structuredClone(entry));
    },
    async delete(key) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    }
  };
};

const openCacheDb = (databaseName: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entries")) {
        db.createObjectStore("entries", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });

const idbRequest = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

export type IndexedDBHttpCacheOptions = {
  databaseName?: string;
};

/** Durable browser HTTP cache backed by IndexedDB. */
export const createIndexedDBHttpCache = (
  options: IndexedDBHttpCacheOptions = {}
): HttpCacheStore => {
  const databaseName = options.databaseName ?? "offlinejs-http-cache";
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = () => {
    if (!globalThis.indexedDB) {
      throw new Error("@offlinejs/http-cache IndexedDB store requires indexedDB");
    }
    dbPromise ??= openCacheDb(databaseName);
    return dbPromise;
  };

  return {
    async get<TBody = unknown>(key: string) {
      const database = await db();
      const entry = await idbRequest(
        database.transaction("entries", "readonly").objectStore("entries").get(key)
      );
      return (entry as CacheEntry<TBody> | undefined) ?? null;
    },
    async set(entry) {
      const database = await db();
      await idbRequest(database.transaction("entries", "readwrite").objectStore("entries").put(entry));
    },
    async delete(key) {
      const database = await db();
      await idbRequest(database.transaction("entries", "readwrite").objectStore("entries").delete(key));
    },
    async clear() {
      const database = await db();
      await idbRequest(database.transaction("entries", "readwrite").objectStore("entries").clear());
    }
  };
};

export type CacheApiStoreOptions = {
  cacheName?: string;
};

/**
 * Browser Cache API store for opaque Response bodies (assets / raw HTTP).
 * Keys are request URLs (GET).
 */
export const createCacheApiStore = (options: CacheApiStoreOptions = {}) => {
  const cacheName = options.cacheName ?? "offlinejs-cache-api";

  const open = async () => {
    if (!globalThis.caches) {
      throw new Error("@offlinejs/http-cache Cache API store requires caches");
    }
    return globalThis.caches.open(cacheName);
  };

  return {
    async match(request: RequestInfo | URL): Promise<Response | undefined> {
      const cache = await open();
      return (await cache.match(request)) ?? undefined;
    },
    async put(request: RequestInfo | URL, response: Response): Promise<void> {
      const cache = await open();
      await cache.put(request, response.clone());
    },
    async delete(request: RequestInfo | URL): Promise<boolean> {
      const cache = await open();
      return cache.delete(request);
    },
    async clear(): Promise<void> {
      await globalThis.caches.delete(cacheName);
    }
  };
};

type RevalidateMap = Map<string, Promise<void>>;

const defaultStore = createMemoryHttpCache();
const inflightRevalidate: RevalidateMap = new Map();

const writeEntry = async <TBody>(
  store: HttpCacheStore,
  key: string,
  status: number,
  headers: Record<string, string>,
  body: TBody,
  policy: CachePolicy
): Promise<CacheEntry<TBody>> => {
  const { ttlMs, staleWhileRevalidateMs } = resolvePolicy(policy);
  const cachedAt = now();
  const entry: CacheEntry<TBody> = {
    key,
    status,
    headers,
    body,
    cachedAt,
    expiresAt: cachedAt + ttlMs,
    staleAt: cachedAt + ttlMs + staleWhileRevalidateMs
  };
  await store.set(entry);
  return entry;
};

const revalidateInBackground = (
  key: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  store: HttpCacheStore,
  policy: CachePolicy,
  fetchImpl: typeof globalThis.fetch
): void => {
  if (inflightRevalidate.has(key)) {
    return;
  }

  const task = (async () => {
    const response = await fetchImpl(input, init);
    if (!response.ok) {
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.clone().json()
      : await response.clone().text();
    await writeEntry(store, key, response.status, normalizeHeaders(response.headers), body, policy);
  })()
    .catch(() => {
      // Swallow revalidation errors — stale cache remains usable until staleAt.
    })
    .finally(() => {
      inflightRevalidate.delete(key);
    });

  inflightRevalidate.set(key, task);
};

/**
 * Cached JSON/text fetch with TTL + optional stale-while-revalidate.
 * Use this for read-through API caching — not for offline mutation queues
 * (that’s `@offlinejs/client` / createOfflineDB).
 */
export const cachedFetch = async <TBody = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: CachedFetchOptions = {}
): Promise<CachedResult<TBody>> => {
  const store = options.store ?? defaultStore;
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const methods = new Set((options.methods ?? [...DEFAULT_METHODS]).map((m) => m.toUpperCase()));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const key = options.key ?? buildCacheKey(input, init);
  const policy: CachePolicy = {
    ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
    ...(options.staleWhileRevalidateMs !== undefined
      ? { staleWhileRevalidateMs: options.staleWhileRevalidateMs }
      : {})
  };

  if (!methods.has(method)) {
    const response = await fetchImpl(input, init);
    const contentType = response.headers.get("content-type") ?? "";
    const data = (
      options.json || contentType.includes("application/json")
        ? await response.json()
        : await response.text()
    ) as TBody;
    return {
      data,
      fromCache: false,
      stale: false,
      status: response.status,
      headers: normalizeHeaders(response.headers),
      key
    };
  }

  const cached = await store.get<TBody>(key);
  const at = now();

  if (cached && isFresh(cached, at)) {
    return {
      data: cached.body,
      fromCache: true,
      stale: false,
      status: cached.status,
      headers: cached.headers,
      key
    };
  }

  if (cached && isUsable(cached, at)) {
    revalidateInBackground(key, input, init, store, policy, fetchImpl);
    return {
      data: cached.body,
      fromCache: true,
      stale: true,
      status: cached.status,
      headers: cached.headers,
      key
    };
  }

  const response = await fetchImpl(input, init);
  const contentType = response.headers.get("content-type") ?? "";
  const shouldJson = options.json ?? contentType.includes("application/json");
  const data = (shouldJson ? await response.json() : await response.text()) as TBody;

  if (response.ok) {
    await writeEntry(store, key, response.status, normalizeHeaders(response.headers), data, policy);
  }

  return {
    data,
    fromCache: false,
    stale: false,
    status: response.status,
    headers: normalizeHeaders(response.headers),
    key
  };
};

/** Convenience helper — always parses JSON. */
export const cachedJson = async <TBody = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options: Omit<CachedFetchOptions, "json"> = {}
): Promise<CachedResult<TBody>> => cachedFetch<TBody>(input, init, { ...options, json: true });

export const invalidateCacheKey = async (
  key: string,
  store: HttpCacheStore = defaultStore
): Promise<void> => {
  await store.delete(key);
};

export const clearHttpCache = async (store: HttpCacheStore = defaultStore): Promise<void> => {
  await store.clear();
};
