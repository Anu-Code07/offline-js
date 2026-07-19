import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import { createOfflineDB } from "@offlinejs/core";
import { createOfflineExternalStore } from "./index";

describe("react external store", () => {
  it("tracks collection subscription snapshots", async () => {
    const db = createOfflineDB({
      storage: createMemoryStorage(),
      sync: { enabled: false }
    });
    const users = db.collection("users");
    const store = createOfflineExternalStore(users);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await users.create({ name: "Ada" });
    await Promise.resolve();

    expect(listener).toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual([expect.objectContaining({ name: "Ada" })]);

    unsubscribe();
    await users.create({ name: "Grace" });
    expect(store.getSnapshot()).toEqual([expect.objectContaining({ name: "Ada" })]);
  });
});
