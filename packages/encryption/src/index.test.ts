import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import type { EncryptionCodec, IndexableStorageAdapter } from "@offlinejs/types";
import {
  createJsonEncryptionStorage,
  createWebCryptoAesGcmCodec,
  generateAesGcmKey
} from "./index";

const reverseCodec: EncryptionCodec = {
  decrypt(value) {
    return new Uint8Array([...value].reverse());
  },
  encrypt(value) {
    return new Uint8Array([...value].reverse());
  }
};

describe("encryption", () => {
  it("encrypts records at rest and decrypts reads", async () => {
    const raw = createMemoryStorage();
    const storage = createJsonEncryptionStorage(raw, reverseCodec);

    await storage.set("users", { id: "1", name: "Ada" });

    await expect(storage.get("users", "1")).resolves.toEqual({ id: "1", name: "Ada" });
    await expect(storage.find("users", { search: "ada" })).resolves.toEqual([
      { id: "1", name: "Ada" }
    ]);
    await expect(raw.get("users", "1")).resolves.toMatchObject({
      id: "1",
      __offlinejsEncrypted: true
    });
  });

  it("creates a WebCrypto AES-GCM codec", async () => {
    const key = await generateAesGcmKey();
    const codec = await createWebCryptoAesGcmCodec(key);
    const encrypted = await codec.encrypt(new TextEncoder().encode("secret"));
    const decrypted = await codec.decrypt(encrypted);

    expect(new TextDecoder().decode(decrypted)).toBe("secret");
  });

  it("encrypts through transactions and forwards indexes", async () => {
    const raw = createMemoryStorage();
    const storage: IndexableStorageAdapter = createJsonEncryptionStorage(raw, reverseCodec);

    await storage.transaction(["users"], async (store) => {
      await store.set("users", { id: "1", name: "Ada" });
      await expect(store.get("users", "1")).resolves.toEqual({ id: "1", name: "Ada" });
      await expect(store.find("users", { search: "ada" })).resolves.toEqual([
        { id: "1", name: "Ada" }
      ]);
    });
    await expect(storage.get("users", "1")).resolves.toEqual({ id: "1", name: "Ada" });
    await storage.createIndex!({
      collection: "users",
      fields: ["name"],
      name: "users_name"
    });
    await expect(storage.listIndexes!("users")).resolves.toHaveLength(1);
    await storage.delete("users", "1");
    await storage.clear("users");
  });
});
