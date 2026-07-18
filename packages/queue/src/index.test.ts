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
});
