import { createId, now } from "@offlinejs/utils";

export type MediaJobStatus = "pending" | "uploading" | "paused" | "complete" | "failed";

export type MediaJob = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** Bytes already acknowledged by the server (resume offset). */
  bytesUploaded: number;
  status: MediaJobStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  /** Remote URL or upload id returned on complete. */
  remoteUrl?: string;
  remoteUploadId?: string;
  error?: string;
  /** Object URL for local preview (not persisted). */
  previewUrl?: string;
};

export type MediaQueueEventMap = {
  enqueue: MediaJob;
  progress: { id: string; pct: number; bytesUploaded: number; size: number };
  complete: { id: string; url: string; job: MediaJob };
  error: { id: string; error: Error; job: MediaJob };
  change: MediaJob[];
};

export type ImageCompressOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0..1 for JPEG/WebP
  mimeType?: "image/jpeg" | "image/webp" | "image/png";
  /**
   * Skip compress when the source is already within max dimensions and
   * under this byte size. Default 1.5 MiB.
   */
  skipBelowBytes?: number;
};

export type MediaQueueCompressOptions = {
  images?: ImageCompressOptions | false;
  /** Video compression is not in the MVP — reserved for later. */
  videos?: false | "optional";
};

export type MediaQueueOptions = {
  /** Upload endpoint (receives chunked PUT/POST). */
  endpoint: string;
  /** IndexedDB database name. */
  databaseName?: string;
  /**
   * Chunk size in bytes. Default adapts by file size:
   * <1 MiB → 256 KiB, <16 MiB → 1 MiB, else 4 MiB.
   * Pass a number to force a fixed size.
   */
  chunkSize?: number | "auto";
  /** Max upload attempts per job. Default 5. */
  maxAttempts?: number;
  /**
   * How many jobs to upload in parallel during flush. Default 3.
   * Chunks within a single job stay sequential (resume-safe).
   */
  concurrency?: number;
  /**
   * Persist progress to IndexedDB at most this often (ms). Default 500.
   * Always persists on complete / error / pause. Progress events still fire every chunk.
   */
  persistIntervalMs?: number;
  /**
   * Also force a progress persist after this many successful bytes. Default 2 MiB.
   */
  persistEveryBytes?: number;
  compress?: MediaQueueCompressOptions;
  /** Custom fetch. */
  fetch?: typeof globalThis.fetch;
  /** Called to build auth headers per request. Cached per job upload attempt. */
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  /**
   * When true (default), listen to online/offline and auto-flush.
   */
  autoFlush?: boolean;
};

type StoredBlob = {
  jobId: string;
  blob: Blob;
};

type Listener<T> = (payload: T) => void;

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_PERSIST_MS = 500;
const DEFAULT_PERSIST_BYTES = 2 * 1024 * 1024;
const DEFAULT_SKIP_COMPRESS_BYTES = 1.5 * 1024 * 1024;

const resolveChunkSize = (fileSize: number, configured: number | "auto"): number => {
  if (configured !== "auto") {
    return Math.max(1, Math.floor(configured));
  }
  if (fileSize < 1024 * 1024) {
    return 256 * 1024;
  }
  if (fileSize < 16 * 1024 * 1024) {
    return 1024 * 1024;
  }
  return 4 * 1024 * 1024;
};

const openDb = (name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("jobs")) {
        db.createObjectStore("jobs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs", { keyPath: "jobId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });

const idbReq = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

const waitTx = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });

const cloneJob = (job: MediaJob): MediaJob => ({ ...job });

/** Prefer OffscreenCanvas; skip work when already within bounds; preserve aspect ratio. */
const compressImage = async (file: Blob, options: ImageCompressOptions): Promise<Blob> => {
  if (typeof createImageBitmap === "undefined") {
    return file;
  }

  const maxWidth = options.maxWidth ?? 1600;
  const maxHeight = options.maxHeight ?? 1600;
  const quality = options.quality ?? 0.82;
  const mimeType = options.mimeType ?? "image/jpeg";
  const skipBelow = options.skipBelowBytes ?? DEFAULT_SKIP_COMPRESS_BYTES;

  let bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
  const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
  const alreadyFits = scale >= 1;

  if (alreadyFits && file.size <= skipBelow && (file.type === mimeType || file.type === "")) {
    bitmap.close();
    return file;
  }

  // Decoder-side resize when only downscaling (single dimension keeps aspect ratio).
  if (!alreadyFits) {
    try {
      const resized = await createImageBitmap(file, {
        resizeWidth: targetWidth,
        resizeQuality: "high"
      });
      bitmap.close();
      bitmap = resized;
    } catch {
      // Fall through and draw the original bitmap scaled into a canvas.
    }
  }

  const drawWidth = alreadyFits ? bitmap.width : targetWidth;
  const drawHeight = alreadyFits ? bitmap.height : targetHeight;

  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(drawWidth, drawHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        bitmap.close();
        return file;
      }
      ctx.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
      bitmap.close();
      const blob = await canvas.convertToBlob({ type: mimeType, quality });
      return blob.size < file.size || !alreadyFits ? blob : file;
    }

    if (typeof document === "undefined") {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = drawWidth;
    canvas.height = drawHeight;
    const ctx = canvas.getContext("2d", { alpha: mimeType === "image/png" });
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), mimeType, quality);
    });
    if (!blob) {
      return file;
    }
    return blob.size < file.size || !alreadyFits ? blob : file;
  } catch {
    try {
      bitmap.close();
    } catch {
      // ignore
    }
    return file;
  }
};

const runPool = async <T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> => {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        await worker(item);
      }
    }
  });

  await Promise.all(runners);
};

export class MediaQueue {
  private readonly options: {
    endpoint: string;
    databaseName: string;
    chunkSize: number | "auto";
    maxAttempts: number;
    concurrency: number;
    persistIntervalMs: number;
    persistEveryBytes: number;
    autoFlush: boolean;
    compress?: MediaQueueCompressOptions;
    fetch?: typeof globalThis.fetch;
    getHeaders?: () => HeadersInit | Promise<HeadersInit>;
  };
  private dbPromise: Promise<IDBDatabase> | null = null;
  private flushing = false;
  private flushQueued = false;
  private cacheLoaded = false;
  private cacheLoadPromise: Promise<void> | null = null;
  private readonly jobsById = new Map<string, MediaJob>();
  private readonly blobCache = new Map<string, Blob>();
  private changeScheduled = false;
  private readonly listeners: { [K in keyof MediaQueueEventMap]: Set<Listener<MediaQueueEventMap[K]>> } = {
    enqueue: new Set(),
    progress: new Set(),
    complete: new Set(),
    error: new Set(),
    change: new Set()
  };

  constructor(options: MediaQueueOptions) {
    this.options = {
      autoFlush: options.autoFlush ?? true,
      chunkSize: options.chunkSize ?? "auto",
      maxAttempts: options.maxAttempts ?? DEFAULT_ATTEMPTS,
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      persistIntervalMs: options.persistIntervalMs ?? DEFAULT_PERSIST_MS,
      persistEveryBytes: options.persistEveryBytes ?? DEFAULT_PERSIST_BYTES,
      databaseName: options.databaseName ?? "offlinejs-media-queue",
      endpoint: options.endpoint,
      ...(options.compress !== undefined ? { compress: options.compress } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
      ...(options.getHeaders !== undefined ? { getHeaders: options.getHeaders } : {})
    };

    if (this.options.autoFlush && typeof globalThis.addEventListener === "function") {
      globalThis.addEventListener("online", () => {
        void this.flush();
      });
    }
  }

  on<K extends keyof MediaQueueEventMap>(event: K, listener: Listener<MediaQueueEventMap[K]>): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  private emit<K extends keyof MediaQueueEventMap>(event: K, payload: MediaQueueEventMap[K]): void {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private scheduleChange(): void {
    if (this.changeScheduled || this.listeners.change.size === 0) {
      return;
    }
    this.changeScheduled = true;
    queueMicrotask(() => {
      this.changeScheduled = false;
      this.emit("change", this.snapshot());
    });
  }

  private snapshot(): MediaJob[] {
    return [...this.jobsById.values()]
      .map(cloneJob)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private db(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) {
      throw new Error("@offlinejs/media-queue requires IndexedDB");
    }
    this.dbPromise ??= openDb(this.options.databaseName);
    return this.dbPromise;
  }

  private async ensureCache(): Promise<void> {
    if (this.cacheLoaded) {
      return;
    }
    this.cacheLoadPromise ??= (async () => {
      const database = await this.db();
      const jobs = await idbReq<MediaJob[]>(
        database.transaction("jobs", "readonly").objectStore("jobs").getAll()
      );
      // Merge IDB → memory; never wipe in-flight enqueues.
      for (const job of jobs) {
        if (this.jobsById.has(job.id)) {
          continue;
        }
        const { previewUrl: _previewUrl, ...rest } = job as MediaJob & { previewUrl?: string };
        void _previewUrl;
        this.jobsById.set(rest.id, rest);
      }
      this.cacheLoaded = true;
    })();
    await this.cacheLoadPromise;
  }

  private async persistJob(job: MediaJob): Promise<void> {
    const database = await this.db();
    // Strip ephemeral previewUrl from durable storage
    const { previewUrl: _previewUrl, ...durable } = job;
    void _previewUrl;
    await idbReq(database.transaction("jobs", "readwrite").objectStore("jobs").put(durable));
  }

  private async persistJobAndBlob(job: MediaJob, blob: Blob): Promise<void> {
    const database = await this.db();
    const tx = database.transaction(["jobs", "blobs"], "readwrite");
    const { previewUrl: _previewUrl, ...durable } = job;
    void _previewUrl;
    tx.objectStore("jobs").put(durable);
    const row: StoredBlob = { jobId: job.id, blob };
    tx.objectStore("blobs").put(row);
    await waitTx(tx);
  }

  private async getBlob(jobId: string): Promise<Blob | null> {
    const cached = this.blobCache.get(jobId);
    if (cached) {
      return cached;
    }
    const database = await this.db();
    const row = await idbReq<StoredBlob | undefined>(
      database.transaction("blobs", "readonly").objectStore("blobs").get(jobId)
    );
    if (!row?.blob) {
      return null;
    }
    this.blobCache.set(jobId, row.blob);
    return row.blob;
  }

  private async deleteJob(jobId: string): Promise<void> {
    const database = await this.db();
    const tx = database.transaction(["jobs", "blobs"], "readwrite");
    tx.objectStore("jobs").delete(jobId);
    tx.objectStore("blobs").delete(jobId);
    await waitTx(tx);
    this.jobsById.delete(jobId);
    this.blobCache.delete(jobId);
  }

  async list(): Promise<MediaJob[]> {
    await this.ensureCache();
    return this.snapshot();
  }

  /**
   * Queue a file for upload. Returns after durable persist (+ optional compress).
   * Images are compressed on-device when `compress.images` is enabled (default).
   */
  async enqueue(file: File | Blob, meta?: { name?: string }): Promise<MediaJob> {
    await this.ensureCache();

    const name = meta?.name ?? (file instanceof File ? file.name : "upload.bin");
    const mimeType = file.type || "application/octet-stream";
    let body: Blob = file;

    const imageOpts = this.options.compress?.images;
    if (imageOpts !== false && mimeType.startsWith("image/") && mimeType !== "image/svg+xml") {
      body = await compressImage(file, imageOpts ?? {});
    }

    const id = createId();
    const createdAt = now();
    const job: MediaJob = {
      id,
      name,
      mimeType: body.type || mimeType,
      size: body.size,
      bytesUploaded: 0,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      attempts: 0
    };

    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      job.previewUrl = URL.createObjectURL(body);
    }

    this.jobsById.set(id, job);
    this.blobCache.set(id, body);
    await this.persistJobAndBlob(job, body);
    this.emit("enqueue", cloneJob(job));
    this.scheduleChange();

    if (this.options.autoFlush && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      void this.flush();
    }

    return cloneJob(job);
  }

  async pause(id: string): Promise<void> {
    await this.ensureCache();
    const job = this.jobsById.get(id);
    if (!job || job.status === "complete") {
      return;
    }
    job.status = "paused";
    job.updatedAt = now();
    await this.persistJob(job);
    this.scheduleChange();
  }

  async resume(id?: string): Promise<void> {
    await this.ensureCache();
    if (id) {
      const job = this.jobsById.get(id);
      if (job && job.status === "paused") {
        job.status = "pending";
        job.updatedAt = now();
        await this.persistJob(job);
        this.scheduleChange();
      }
    }
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    await this.ensureCache();
    const job = this.jobsById.get(id);
    if (job?.previewUrl) {
      URL.revokeObjectURL(job.previewUrl);
    }
    await this.deleteJob(id);
    this.scheduleChange();
  }

  /** Upload all pending/failed jobs that are due. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.flushing) {
      this.flushQueued = true;
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }

    this.flushing = true;
    try {
      do {
        this.flushQueued = false;
        await this.ensureCache();
        const due = this.snapshot().filter((job) => {
          if (job.status === "complete" || job.status === "paused") {
            return false;
          }
          if (job.status === "failed" && job.attempts >= this.options.maxAttempts) {
            return false;
          }
          return true;
        });

        await runPool(due, this.options.concurrency, async (job) => {
          await this.uploadJob(job.id);
        });
      } while (this.flushQueued);
    } finally {
      this.flushing = false;
    }
  }

  private async uploadJob(id: string): Promise<void> {
    const job = this.jobsById.get(id);
    if (!job) {
      return;
    }
    if (job.status === "paused" || job.status === "complete") {
      return;
    }
    if (job.status === "failed" && job.attempts >= this.options.maxAttempts) {
      return;
    }

    const blob = await this.getBlob(id);
    if (!blob) {
      job.status = "failed";
      job.error = "Missing local blob";
      job.updatedAt = now();
      await this.persistJob(job);
      this.emit("error", { id, error: new Error(job.error), job: cloneJob(job) });
      this.scheduleChange();
      return;
    }

    job.status = "uploading";
    job.attempts += 1;
    job.updatedAt = now();
    await this.persistJob(job);
    this.scheduleChange();

    const fetchImpl = this.options.fetch ?? globalThis.fetch.bind(globalThis);
    const chunkSize = resolveChunkSize(blob.size, this.options.chunkSize);
    let offset = job.bytesUploaded;
    let lastPersistAt = now();
    let bytesSincePersist = 0;
    let baseHeaders: HeadersInit | undefined;

    try {
      if (!job.remoteUploadId) {
        job.remoteUploadId = job.id;
      }

      if (this.options.getHeaders) {
        baseHeaders = await this.options.getHeaders();
      }

      while (offset < blob.size) {
        // Re-check pause between chunks (pause() mutates the shared job object).
        const liveStatus: MediaJobStatus = this.jobsById.get(id)?.status ?? job.status;
        if (liveStatus === "paused") {
          job.status = "paused";
          await this.persistJob(job);
          this.scheduleChange();
          return;
        }

        const end = Math.min(offset + chunkSize, blob.size);
        const chunk = blob.slice(offset, end);
        const headers = new Headers(baseHeaders);
        headers.set("Content-Type", job.mimeType || "application/octet-stream");
        headers.set("Content-Range", `bytes ${offset}-${end - 1}/${blob.size}`);
        headers.set("X-Upload-Id", job.remoteUploadId);
        headers.set("X-File-Name", encodeURIComponent(job.name));
        headers.set("X-Chunk-Start", String(offset));
        headers.set("X-Chunk-End", String(end));
        headers.set("X-Total-Size", String(blob.size));

        const response = await fetchImpl(this.options.endpoint, {
          method: "PUT",
          headers,
          body: chunk
        });

        if (!response.ok) {
          // Drain body so the connection can be reused
          void response.body?.cancel?.();
          throw new Error(`Upload failed (${response.status})`);
        }

        offset = end;
        job.bytesUploaded = offset;
        job.updatedAt = now();
        bytesSincePersist += chunk.size;

        const pct = blob.size === 0 ? 100 : Math.round((offset / blob.size) * 100);
        this.emit("progress", { id: job.id, pct, bytesUploaded: offset, size: blob.size });

        const isLast = offset >= blob.size;
        let remoteUrl: string | undefined;

        if (isLast) {
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const payload = (await response.json()) as { url?: string; uploadId?: string };
            if (payload.url) {
              remoteUrl = payload.url;
            }
            if (payload.uploadId) {
              job.remoteUploadId = payload.uploadId;
            }
          } else {
            const text = (await response.text()).trim();
            if (text.startsWith("http")) {
              remoteUrl = text;
            }
          }

          job.status = "complete";
          job.remoteUrl = remoteUrl ?? `${this.options.endpoint.replace(/\/$/, "")}/${job.id}`;
          job.updatedAt = now();
          await this.persistJob(job);
          this.emit("complete", { id: job.id, url: job.remoteUrl, job: cloneJob(job) });
          this.scheduleChange();
          return;
        }

        // Intermediate chunks: discard body quickly; coalesce durable writes
        if (response.body) {
          void response.body.cancel?.();
        } else {
          void response.arrayBuffer().catch(() => undefined);
        }

        const dueByTime = now() - lastPersistAt >= this.options.persistIntervalMs;
        const dueByBytes = bytesSincePersist >= this.options.persistEveryBytes;
        if (dueByTime || dueByBytes) {
          await this.persistJob(job);
          lastPersistAt = now();
          bytesSincePersist = 0;
          this.scheduleChange();
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      job.status = job.attempts >= this.options.maxAttempts ? "failed" : "pending";
      job.error = err.message;
      job.updatedAt = now();
      await this.persistJob(job);
      this.emit("error", { id: job.id, error: err, job: cloneJob(job) });
      this.scheduleChange();
    }
  }
}

/** Create a durable offline media upload queue (images MVP). */
export const createMediaQueue = (options: MediaQueueOptions): MediaQueue => new MediaQueue(options);

/** @internal Exported for tests */
export const __test = {
  resolveChunkSize,
  runPool
};
