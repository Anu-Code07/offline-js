import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaQueue } from "./index";

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
      // Fail on the second chunk of the first flush attempt.
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
});
