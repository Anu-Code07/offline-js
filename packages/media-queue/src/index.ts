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
  /** Chunk size in bytes. Default 256 KiB. */
  chunkSize?: number;
  /** Max upload attempts per job. Default 5. */
  maxAttempts?: number;
  compress?: MediaQueueCompressOptions;
  /** Custom fetch. */
  fetch?: typeof globalThis.fetch;
  /** Called to build auth headers per request. */
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

const DEFAULT_CHUNK = 256 * 1024;
const DEFAULT_ATTEMPTS = 5;

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

const compressImage = async (file: Blob, options: ImageCompressOptions): Promise<Blob> => {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    return file;
  }

  const maxWidth = options.maxWidth ?? 1600;
  const maxHeight = options.maxHeight ?? 1600;
  const quality = options.quality ?? 0.82;
  const mimeType = options.mimeType ?? "image/jpeg";

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), mimeType, quality);
  });

  return blob ?? file;
};

export class MediaQueue {
  private readonly options: Required<
    Pick<MediaQueueOptions, "endpoint" | "databaseName" | "chunkSize" | "maxAttempts" | "autoFlush">
  > &
    MediaQueueOptions;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private flushing = false;
  private readonly listeners: { [K in keyof MediaQueueEventMap]: Set<Listener<MediaQueueEventMap[K]>> } = {
    enqueue: new Set(),
    progress: new Set(),
    complete: new Set(),
    error: new Set(),
    change: new Set()
  };

  constructor(options: MediaQueueOptions) {
    this.options = {
      autoFlush: true,
      chunkSize: DEFAULT_CHUNK,
      maxAttempts: DEFAULT_ATTEMPTS,
      databaseName: "offlinejs-media-queue",
      ...options,
      endpoint: options.endpoint
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

  private db(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) {
      throw new Error("@offlinejs/media-queue requires IndexedDB");
    }
    this.dbPromise ??= openDb(this.options.databaseName);
    return this.dbPromise;
  }

  private async saveJob(job: MediaJob): Promise<void> {
    const database = await this.db();
    await idbReq(database.transaction("jobs", "readwrite").objectStore("jobs").put(job));
  }

  private async saveBlob(jobId: string, blob: Blob): Promise<void> {
    const database = await this.db();
    const row: StoredBlob = { jobId, blob };
    await idbReq(database.transaction("blobs", "readwrite").objectStore("blobs").put(row));
  }

  private async getBlob(jobId: string): Promise<Blob | null> {
    const database = await this.db();
    const row = await idbReq<StoredBlob | undefined>(
      database.transaction("blobs", "readonly").objectStore("blobs").get(jobId)
    );
    return row?.blob ?? null;
  }

  private async deleteJob(jobId: string): Promise<void> {
    const database = await this.db();
    const tx = database.transaction(["jobs", "blobs"], "readwrite");
    tx.objectStore("jobs").delete(jobId);
    tx.objectStore("blobs").delete(jobId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    });
  }

  async list(): Promise<MediaJob[]> {
    const database = await this.db();
    const jobs = await idbReq<MediaJob[]>(database.transaction("jobs", "readonly").objectStore("jobs").getAll());
    return jobs.sort((a, b) => a.createdAt - b.createdAt);
  }

  private async emitChange(): Promise<void> {
    this.emit("change", await this.list());
  }

  /**
   * Queue a file for upload. Returns immediately after durable persist (+ optional compress).
   * Images are compressed on-device when `compress.images` is enabled (default).
   */
  async enqueue(file: File | Blob, meta?: { name?: string }): Promise<MediaJob> {
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

    await this.saveBlob(id, body);
    await this.saveJob(job);
    this.emit("enqueue", job);
    await this.emitChange();

    if (this.options.autoFlush && (typeof navigator === "undefined" || navigator.onLine !== false)) {
      void this.flush();
    }

    return job;
  }

  async pause(id: string): Promise<void> {
    const jobs = await this.list();
    const job = jobs.find((item) => item.id === id);
    if (!job || job.status === "complete") {
      return;
    }
    job.status = "paused";
    job.updatedAt = now();
    await this.saveJob(job);
    await this.emitChange();
  }

  async resume(id?: string): Promise<void> {
    if (id) {
      const jobs = await this.list();
      const job = jobs.find((item) => item.id === id);
      if (job && job.status === "paused") {
        job.status = "pending";
        job.updatedAt = now();
        await this.saveJob(job);
        await this.emitChange();
      }
    }
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    const jobs = await this.list();
    const job = jobs.find((item) => item.id === id);
    if (job?.previewUrl) {
      URL.revokeObjectURL(job.previewUrl);
    }
    await this.deleteJob(id);
    await this.emitChange();
  }

  /** Upload all pending/failed jobs that are due. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }

    this.flushing = true;
    try {
      const jobs = await this.list();
      for (const job of jobs) {
        if (job.status === "complete" || job.status === "paused") {
          continue;
        }
        if (job.status === "failed" && job.attempts >= this.options.maxAttempts) {
          continue;
        }
        await this.uploadJob(job.id);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async uploadJob(id: string): Promise<void> {
    const jobs = await this.list();
    const job = jobs.find((item) => item.id === id);
    if (!job) {
      return;
    }

    const blob = await this.getBlob(id);
    if (!blob) {
      job.status = "failed";
      job.error = "Missing local blob";
      job.updatedAt = now();
      await this.saveJob(job);
      this.emit("error", { id, error: new Error(job.error), job });
      await this.emitChange();
      return;
    }

    job.status = "uploading";
    job.attempts += 1;
    job.updatedAt = now();
    await this.saveJob(job);
    await this.emitChange();

    const fetchImpl = this.options.fetch ?? globalThis.fetch.bind(globalThis);
    const chunkSize = this.options.chunkSize;
    let offset = job.bytesUploaded;

    try {
      if (!job.remoteUploadId) {
        job.remoteUploadId = job.id;
      }

      while (offset < blob.size) {
        const end = Math.min(offset + chunkSize, blob.size);
        const chunk = blob.slice(offset, end);
        const headers = new Headers(await this.options.getHeaders?.());
        headers.set("Content-Type", job.mimeType || "application/octet-stream");
        headers.set("Content-Range", `bytes ${offset}-${end - 1}/${blob.size}`);
        headers.set("X-Upload-Id", job.remoteUploadId);
        headers.set("X-File-Name", job.name);
        headers.set("X-Chunk-Start", String(offset));
        headers.set("X-Chunk-End", String(end));
        headers.set("X-Total-Size", String(blob.size));

        const response = await fetchImpl(this.options.endpoint, {
          method: "PUT",
          headers,
          body: chunk
        });

        if (!response.ok) {
          throw new Error(`Upload failed (${response.status})`);
        }

        offset = end;
        job.bytesUploaded = offset;
        job.updatedAt = now();
        await this.saveJob(job);

        const pct = blob.size === 0 ? 100 : Math.round((offset / blob.size) * 100);
        this.emit("progress", { id: job.id, pct, bytesUploaded: offset, size: blob.size });

        let remoteUrl: string | undefined;
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

        if (offset >= blob.size) {
          job.status = "complete";
          job.remoteUrl = remoteUrl ?? `${this.options.endpoint.replace(/\/$/, "")}/${job.id}`;
          job.updatedAt = now();
          await this.saveJob(job);
          this.emit("complete", { id: job.id, url: job.remoteUrl, job });
          await this.emitChange();
          // Keep blob until caller removes — allows retry of metadata; optional cleanup:
          // await this.deleteJob(job.id) would drop resume data; keep for now.
          return;
        }

        await this.saveJob(job);
        await this.emitChange();
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      job.status = job.attempts >= this.options.maxAttempts ? "failed" : "pending";
      job.error = err.message;
      job.updatedAt = now();
      await this.saveJob(job);
      this.emit("error", { id: job.id, error: err, job });
      await this.emitChange();
    }
  }
}

/** Create a durable offline media upload queue (images MVP). */
export const createMediaQueue = (options: MediaQueueOptions): MediaQueue => new MediaQueue(options);
