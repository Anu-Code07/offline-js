import { describe, expect, it, vi } from "vitest";
import { createOfflineDB } from "@offlinejs/core";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import {
  createOfflineRouteClient,
  createServerActionSync,
  isServerRuntime,
  offlineCacheTag
} from "./index";

describe("next helpers", () => {
  it("creates cache tags and detects server runtime", () => {
    expect(offlineCacheTag("users")).toBe("offlinejs:users");
    expect(offlineCacheTag("users", "1")).toBe("offlinejs:users:1");
    expect(isServerRuntime()).toBe(true);
  });

  it("creates route clients", async () => {
    const db = createOfflineRouteClient({
      storage: createMemoryStorage(),
      sync: { enabled: false }
    });

    await expect(db.collection("users").create({ name: "Ada" })).resolves.toMatchObject({
      name: "Ada"
    });
  });

  it("returns server action sync success and errors", async () => {
    const db = createOfflineDB({
      storage: createMemoryStorage(),
      sync: { enabled: false }
    });
    const sync = createServerActionSync(db);
    await db.collection("users").create({ name: "Ada" });

    await expect(sync("users")).resolves.toMatchObject({
      records: [expect.objectContaining({ name: "Ada" })],
      success: true
    });

    const failingSync = createServerActionSync({
      collection: () => ({
        sync: vi.fn(async () => {
          throw new Error("no");
        })
      })
    } as never);

    await expect(failingSync("users")).resolves.toEqual({
      errors: ["no"],
      records: [],
      success: false
    });
  });
});
