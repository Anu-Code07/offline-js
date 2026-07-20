import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test, createMediaQueue } from "./index";

describe("@offlinejs/media-queue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enqueues a file durably and uploads in chunks with resume offset", async () => {
    const chunks: Array<{ start: string | null; end: string | null }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      chunks.push({
        start: headers.get("X-Chunk-Start"),
        end: headers.get("X-Chunk-End")
      });
      const end = Number(headers.get("X-Chunk-End"));
      const total = Number(headers.get("X-Total-Size"));
      if (end >= total) {
        return new Response(JSON.stringify({ url: "https://cdn.example.com/a.jpg" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 200 });
    });

    const queue = createMediaQueue({
      endpoint: "https://api.example.com/uploads",
      databaseName: "media-queue-test-1",
      chunkSize: 4,
      autoFlush: false,
      compress: { images: false },
      fetch: fetchImpl as unknown as typeof fetch
    });

    const progress: number[] = [];
    queue.on("progress", ({ pct }) => progress.push(pct));

    const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], "shot.bin", {
      type: "application/octet-stream"
    });

    const job = await queue.enqueue(file);
    expect(job.status).toBe("pending");
    expect(job.size).toBe(10);

    const complete = new Promise<{ url: string }>((resolve) => {
      queue.on("complete", resolve);
    });

    await queue.flush();
    const done = await complete;

    expect(done.url).toBe("https://cdn.example.com/a.jpg");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.start).toBe("0");
    expect(progress.at(-1)).toBe(100);

    const listed = await queue.list();
    expect(listed[0]?.status).toBe("complete");
    expect(listed[0]?.bytesUploaded).toBe(10);
  });

  it("resumes from bytesUploaded after a mid-upload failure", async () => {
    let calls = 0;
    const starts: number[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;
      const headers = new Headers(init?.headers);
      const start = Number(headers.get("X-Chunk-Start"));
      starts.push(start);
      if (calls === 2) {
        throw new Error("network down");
      }
      const end = Number(headers.get("X-Chunk-End"));
      const total = Number(headers.get("X-Total-Size"));
      if (end >= total) {
        return new Response(JSON.stringify({ url: "https://cdn.example.com/b.bin" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 200 });
    });

    const queue = createMediaQueue({
      endpoint: "https://api.example.com/uploads",
      databaseName: "media-queue-test-2",
      chunkSize: 5,
      autoFlush: false,
      compress: { images: false },
      maxAttempts: 5,
      // Persist every chunk so resume offset is durable after the failed attempt
      persistIntervalMs: 0,
      persistEveryBytes: 1,
      fetch: fetchImpl as unknown as typeof fetch
    });

    await queue.enqueue(new File([new Uint8Array(12)], "part.bin"));
    await queue.flush();

    const afterFail = await queue.list();
    expect(afterFail[0]?.status).toBe("pending");
    expect(afterFail[0]?.bytesUploaded).toBe(5);

    const complete = new Promise<void>((resolve) => {
      queue.on("complete", () => resolve());
    });
    await queue.flush();
    await complete;

    expect(starts).toContain(5);
    const finalJobs = await queue.list();
    expect(finalJobs[0]?.status).toBe("complete");
    expect(finalJobs[0]?.bytesUploaded).toBe(12);
  });

  it("uploads multiple jobs concurrently", async () => {
    let entered = 0;
    let maxEntered = 0;
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      entered += 1;
      maxEntered = Math.max(maxEntered, entered);
      if (entered >= 3) {
        release?.();
      }
      await barrier;

      const headers = new Headers(init?.headers);
      const end = Number(headers.get("X-Chunk-End"));
      const total = Number(headers.get("X-Total-Size"));
      if (end >= total) {
        return new Response(JSON.stringify({ url: "https://cdn.example.com/x.bin" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 200 });
    });

    const queue = createMediaQueue({
      endpoint: "https://api.example.com/uploads",
      databaseName: "media-queue-test-concurrency",
      chunkSize: 1024,
      concurrency: 3,
      autoFlush: false,
      compress: { images: false },
      fetch: fetchImpl as unknown as typeof fetch
    });

    await Promise.all([
      queue.enqueue(new File([new Uint8Array(100)], "a.bin")),
      queue.enqueue(new File([new Uint8Array(100)], "b.bin")),
      queue.enqueue(new File([new Uint8Array(100)], "c.bin"))
    ]);

    await queue.flush();
    const listed = await queue.list();
    expect(listed.every((j) => j.status === "complete")).toBe(true);
    expect(maxEntered).toBeGreaterThanOrEqual(3);
  });

  it("caches getHeaders once per job attempt", async () => {
    const getHeaders = vi.fn(() => ({ Authorization: "Bearer t" }));
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const end = Number(headers.get("X-Chunk-End"));
      const total = Number(headers.get("X-Total-Size"));
      if (end >= total) {
        return new Response(JSON.stringify({ url: "https://cdn.example.com/h.bin" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 200 });
    });

    const queue = createMediaQueue({
      endpoint: "https://api.example.com/uploads",
      databaseName: "media-queue-test-headers",
      chunkSize: 3,
      autoFlush: false,
      compress: { images: false },
      getHeaders,
      fetch: fetchImpl as unknown as typeof fetch
    });

    await queue.enqueue(new File([new Uint8Array(9)], "h.bin"));
    await queue.flush();
    expect(getHeaders).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.length).toBe(3);
  });

  it("completes large chunked uploads with coalesced persistence settings", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const end = Number(headers.get("X-Chunk-End"));
      const total = Number(headers.get("X-Total-Size"));
      if (end >= total) {
        return new Response(JSON.stringify({ url: "https://cdn.example.com/p.bin" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 200 });
    });

    const progress: number[] = [];
    const queue = createMediaQueue({
      endpoint: "https://api.example.com/uploads",
      databaseName: "media-queue-test-persist",
      chunkSize: 1,
      autoFlush: false,
      compress: { images: false },
      // Coalesce: do not write IDB on every 1-byte chunk
      persistIntervalMs: 60_000,
      persistEveryBytes: 1_000_000,
      fetch: fetchImpl as unknown as typeof fetch
    });
    queue.on("progress", ({ pct }) => progress.push(pct));

    await queue.enqueue(new File([new Uint8Array(20)], "p.bin"));
    await queue.flush();

    expect(fetchImpl.mock.calls.length).toBe(20);
    expect(progress.at(-1)).toBe(100);
    const listed = await queue.list();
    expect(listed[0]?.status).toBe("complete");
    expect(listed[0]?.bytesUploaded).toBe(20);
  });

  it("adapts chunk size by payload", () => {
    expect(__test.resolveChunkSize(100_000, "auto")).toBe(256 * 1024);
    expect(__test.resolveChunkSize(2_000_000, "auto")).toBe(1024 * 1024);
    expect(__test.resolveChunkSize(20_000_000, "auto")).toBe(4 * 1024 * 1024);
    expect(__test.resolveChunkSize(20_000_000, 128 * 1024)).toBe(128 * 1024);
  });

  it("runs a bounded worker pool", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3, 4, 5];
    await __test.runPool(items, 2, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(2);
  });
});
