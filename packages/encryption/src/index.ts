import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  type EncryptionCodec,
  type EntityRecord,
  type QueryOptions,
  type StorageAdapter,
  type TransactionStore
} from "@offlinejs/types";
import { applyQuery, withIndexForwarding } from "@offlinejs/utils";

interface EncryptedRecord extends EntityRecord {
  __offlinejsEncrypted: true;
  data: string;
}

export const createJsonEncryptionStorage = (
  storage: StorageAdapter,
  codec: EncryptionCodec
): StorageAdapter => {
  const createEncryptedStore = (store: TransactionStore): TransactionStore => ({
    clear: (collection) => store.clear(collection),
    delete: (collection, id) => store.delete(collection, id),
    async find<TRecord extends EntityRecord>(
      collection: string,
      query?: QueryOptions<TRecord>
    ): Promise<TRecord[]> {
      const encryptedRecords = await store.find<EncryptedRecord>(collection);
      const records = await Promise.all(
        encryptedRecords.map((record) => decryptRecord<TRecord>(record, codec))
      );
      return applyQuery(records, query);
    },
    async get<TRecord extends EntityRecord>(
      collection: string,
      id: string
    ): Promise<TRecord | null> {
      const record = await store.get<EncryptedRecord>(collection, id);
      return record ? decryptRecord<TRecord>(record, codec) : null;
    },
    async set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void> {
      await store.set(collection, await encryptRecord(value, codec));
    }
  });

  const wrapper: StorageAdapter = {
    name: `${storage.name}:encrypted`,
    contractVersion: STORAGE_ADAPTER_CONTRACT_VERSION,
    ...(storage.capabilities ? { capabilities: storage.capabilities } : {}),
    clear: (collection) => storage.clear(collection),
    delete: (collection, id) => storage.delete(collection, id),
    async find<TRecord extends EntityRecord>(
      collection: string,
      query?: QueryOptions<TRecord>
    ): Promise<TRecord[]> {
      const encryptedRecords = await storage.find<EncryptedRecord>(collection);
      const records = await Promise.all(
        encryptedRecords.map((record) => decryptRecord<TRecord>(record, codec))
      );

      return applyQuery(records, query);
    },
    async get<TRecord extends EntityRecord>(
      collection: string,
      id: string
    ): Promise<TRecord | null> {
      const record = await storage.get<EncryptedRecord>(collection, id);
      return record ? decryptRecord<TRecord>(record, codec) : null;
    },
    async set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void> {
      await storage.set(collection, await encryptRecord(value, codec));
    },
    transaction: <TValue>(scope: string[], run: (store: TransactionStore) => Promise<TValue>) =>
      storage.transaction(scope, (store) => run(createEncryptedStore(store))),
    ...(storage.migrate ? { migrate: storage.migrate.bind(storage) } : {})
  };

  return withIndexForwarding(wrapper, storage);
};

export const createWebCryptoAesGcmCodec = async (key: CryptoKey): Promise<EncryptionCodec> => ({
  async decrypt(value) {
    const iv = value.slice(0, 12);
    const ciphertext = value.slice(12);
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { iv, name: "AES-GCM" },
      key,
      ciphertext
    );
    return new Uint8Array(decrypted);
  },
  async encrypt(value) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await globalThis.crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, value);
    const output = new Uint8Array(iv.byteLength + encrypted.byteLength);
    output.set(iv, 0);
    output.set(new Uint8Array(encrypted), iv.byteLength);
    return output;
  }
});

export const generateAesGcmKey = (): Promise<CryptoKey> =>
  globalThis.crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt"
  ]);

const encryptRecord = async <TRecord extends EntityRecord>(
  record: TRecord,
  codec: EncryptionCodec
): Promise<EncryptedRecord> => {
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const encrypted = await codec.encrypt(bytes);

  return {
    id: record.id,
    __offlinejsEncrypted: true,
    data: bytesToBase64(encrypted)
  };
};

const decryptRecord = async <TRecord extends EntityRecord>(
  record: EncryptedRecord,
  codec: EncryptionCodec
): Promise<TRecord> => {
  const encrypted = base64ToBytes(record.data);
  const decrypted = await codec.decrypt(encrypted);
  return JSON.parse(new TextDecoder().decode(decrypted)) as TRecord;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};
