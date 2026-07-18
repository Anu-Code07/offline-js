import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import {
  createRequiredFieldsValidator,
  createValidatedStorage,
  OfflineValidationError
} from "./index";

describe("validation", () => {
  it("rejects invalid records in validated storage", async () => {
    const storage = createValidatedStorage(createMemoryStorage(), {
      users: createRequiredFieldsValidator(["name"])
    });

    await expect(storage.set("users", { id: "1" })).rejects.toBeInstanceOf(OfflineValidationError);
  });

  it("allows valid records", async () => {
    const storage = createValidatedStorage(createMemoryStorage(), {
      users: createRequiredFieldsValidator(["name"])
    });

    await storage.set("users", { id: "1", name: "Ada" });

    await expect(storage.get("users", "1")).resolves.toEqual({ id: "1", name: "Ada" });
  });
});
