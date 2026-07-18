import { describe, expect, it } from "vitest";
import { resolveConflictStrategy } from "./index";

describe("resolveConflictStrategy", () => {
  it("supports merge conflicts", async () => {
    const resolved = await resolveConflictStrategy("merge", {
      client: { id: "1", local: true, name: "Ada" },
      collection: "users",
      mutation: {
        id: "m1",
        collection: "users",
        createdAt: 1,
        operation: "update",
        priority: 0,
        recordId: "1",
        retries: 0,
        status: "pending"
      },
      server: { id: "1", name: "Grace", remote: true }
    });

    expect(resolved).toEqual({ id: "1", local: true, name: "Ada", remote: true });
  });
});
