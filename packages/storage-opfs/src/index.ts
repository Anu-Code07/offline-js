import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  type EntityRecord,
  type IndexDefinition,
  type IndexableStorageAdapter,
  type QueryOptions,
  type StorageMigration,
  type TransactionStore
} from "@offlinejs/types";
import { applyQuery } from "@offlinejs/utils";

interface MinimalFileHandle {
  createWritable(): Promise<{ write(value: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<{ text(): Promise<string> }>;
}

interface MinimalDirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MinimalDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<MinimalFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface OPFSStorageOptions {
  directory?: MinimalDirectoryHandle;
  rootName?: string;
}

export class OPFSStorageAdapter implements IndexableStorageAdapter {
  readonly name = "opfs";
  readonly contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    indexes: true,
    migrations: true,
    persistence: "durable",
    transactions: "best-effort"
  } as const;

  private readonly directory: MinimalDirectoryHandle | undefined;
  private readonly rootName: string;

  constructor(options: OPFSStorageOptions = {}) {
    this.directory = options.directory;
    this.rootName = options.rootName ?? "offlinejs";
  }

  async get<TRecord extends EntityRecord>(collection: string, id: string): Promise<TRecord | null> {
    try {
      const file = await this.file(collection, `${id}.json`);
      return JSON.parse(await (await file.getFile()).text()) as TRecord;
    } catch {
      return null;
    }
  }

  async set<TRecord extends EntityRecord>(collection: string, value: TRecord): Promise<void> {
    const file = await this.file(collection, `${value.id}.json`, true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(value));
    await writable.close();
    await this.updateManifest(collection, (ids) => [...new Set([...ids, value.id])]);
  }

  async delete(collection: string, id: string): Promise<void> {
    await (await this.collectionDirectory(collection)).removeEntry(`${id}.json`);
    await this.updateManifest(collection, (ids) => ids.filter((value) => value !== id));
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    const manifest = await this.readManifest(collection);
    const records: TRecord[] = [];

    for (const id of manifest.ids) {
      const record = await this.get<TRecord>(collection, id);

      if (record) {
        records.push(record);
      }
    }

    return applyQuery(records, query);
  }

  async clear(collection?: string): Promise<void> {
    const root = await this.rootDirectory();

    if (collection) {
      await root.removeEntry(collection, { recursive: true });
      return;
    }

    await root.removeEntry(this.rootName, { recursive: true });
  }

  async transaction<TValue>(
    _scope: string[],
    run: (store: TransactionStore) => Promise<TValue>
  ): Promise<TValue> {
    return run(this);
  }

  async migrate(migrations: StorageMigration[]): Promise<void> {
    const applied = new Set(
      (await this.find<EntityRecord>("__migrations")).map((record) => record.id)
    );

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue;
      }

      await migration.up(this);
      await this.set("__migrations", { id: migration.name, appliedAt: Date.now() });
    }
  }

  async createIndex<TRecord extends EntityRecord>(
    definition: IndexDefinition<TRecord>
  ): Promise<void> {
    const indexes = await this.listIndexes(definition.collection);
    const nextIndexes = indexes.filter((index) => index.name !== definition.name);
    nextIndexes.push(definition as IndexDefinition);
    await this.writeIndexes(definition.collection, nextIndexes);
  }

  async dropIndex(collection: string, name: string): Promise<void> {
    const indexes = (await this.listIndexes(collection)).filter((index) => index.name !== name);
    await this.writeIndexes(collection, indexes);
  }

  async listIndexes(collection?: string): Promise<IndexDefinition[]> {
    if (!collection) {
      return [];
    }

    try {
      const file = await this.file(collection, "__indexes.json");
      return JSON.parse(await (await file.getFile()).text()) as IndexDefinition[];
    } catch {
      return [];
    }
  }

  private async file(collection: string, name: string, create = false): Promise<MinimalFileHandle> {
    return (await this.collectionDirectory(collection)).getFileHandle(name, { create });
  }

  private async collectionDirectory(collection: string): Promise<MinimalDirectoryHandle> {
    return (await this.rootDirectory()).getDirectoryHandle(collection, { create: true });
  }

  private async rootDirectory(): Promise<MinimalDirectoryHandle> {
    if (this.directory) {
      return this.directory.getDirectoryHandle(this.rootName, { create: true });
    }

    const storage = globalThis.navigator?.storage as
      { getDirectory?: () => Promise<MinimalDirectoryHandle> } | undefined;
    const root = await storage?.getDirectory?.();

    if (!root) {
      throw new Error("OPFS is not available in this runtime");
    }

    return root.getDirectoryHandle(this.rootName, { create: true });
  }

  private async readManifest(collection: string): Promise<{ ids: string[] }> {
    try {
      const file = await this.file(collection, "__manifest.json");
      return JSON.parse(await (await file.getFile()).text()) as { ids: string[] };
    } catch {
      return { ids: [] };
    }
  }

  private async writeIndexes(collection: string, indexes: IndexDefinition[]): Promise<void> {
    const file = await this.file(collection, "__indexes.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(indexes));
    await writable.close();
  }

  private async updateManifest(
    collection: string,
    update: (ids: string[]) => string[]
  ): Promise<void> {
    const manifest = await this.readManifest(collection);
    const file = await this.file(collection, "__manifest.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify({ ids: update(manifest.ids) }));
    await writable.close();
  }
}

export const createOPFSStorage = (options?: OPFSStorageOptions): OPFSStorageAdapter =>
  new OPFSStorageAdapter(options);
