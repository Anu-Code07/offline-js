import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import { createMutationQueue } from "./index";

describe("MutationQueue", () => {
  it("orders due mutations by priority then creation time", async () => {
    const queue = createMutationQueue({ storage: createMemoryStorage() });

    const low = await queue.add({
      collection: "users",
      operation: "create",
      recordId: "1"
    });
    const high = await queue.add({
      collection: "users",
      operation: "update",
      priority: 10,
      recordId: "2"
    });

    await expect(queue.due()).resolves.toMatchObject([{ id: high.id }, { id: low.id }]);
  });

  it("pauses and resumes processing", async () => {
    const queue = createMutationQueue({ storage: createMemoryStorage() });

    await queue.add({
      collection: "users",
      operation: "create",
      recordId: "1"
    });
    queue.pause();

    await expect(queue.due()).resolves.toEqual([]);

    queue.resume();

    await expect(queue.due()).resolves.toHaveLength(1);
  });

  it("marks attempts, applies retry limits, removes, and clears mutations", async () => {
    const queue = createMutationQueue({ storage: createMemoryStorage() });
    const mutation = await queue.add({
      base: { id: "1", name: "Old" },
      collection: "users",
      operation: "update",
      payload: { name: "New" },
      recordId: "1"
    });

    await expect(queue.markAttempt(mutation.id, "processing")).resolves.toMatchObject({
      retries: 1,
      status: "processing"
    });
    await expect(queue.markAttempt("missing")).resolves.toBeNull();
    await expect(
      queue.due({
        batchSize: 10,
        retry: {
          baseDelayMs: 1_000_000,
          factor: 2,
          jitter: false,
          maxAttempts: 1,
          maxDelayMs: 1_000_000
        }
      })
    ).resolves.toEqual([]);

    await queue.remove(mutation.id);
    await expect(queue.all()).resolves.toEqual([]);

    await queue.add({ collection: "users", operation: "create", recordId: "2" });
    await queue.clear();
    await expect(queue.all()).resolves.toEqual([]);
  });
});
