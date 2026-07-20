import {
  STORAGE_ADAPTER_CONTRACT_VERSION,
  type EntityRecord,
  type IndexDefinition,
  type IndexableStorageAdapter,
  type QueryOptions,
  type StorageMigration,
  type TransactionStore
} from "@offlinejs/types";
import {
  applyQuery,
  findMatchingIndex,
  getEqualityFilterLookups,
  readIndexFields,
  serializeCompoundIndexValue
} from "@offlinejs/utils";

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
  /** @deprecated Use `rootName`. */
  rootDirectoryName?: string;
  rootName?: string;
}

interface IndexDataFile {
  [indexName: string]: Record<string, string[]>;
}

export class OPFSStorageAdapter implements IndexableStorageAdapter {
  readonly name = "opfs";
  readonly contractVersion = STORAGE_ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    indexes: true,
    bulkWrites: true,
    migrations: true,
    persistence: "durable",
    transactions: "best-effort"
  } as const;

  private readonly directory: MinimalDirectoryHandle | undefined;
  private readonly rootName: string;

  constructor(options: OPFSStorageOptions = {}) {
    this.directory = options.directory;
    this.rootName = options.rootName ?? options.rootDirectoryName ?? "offlinejs";
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
    await this.setMany(collection, [value]);
  }

  async setMany<TRecord extends EntityRecord>(collection: string, values: TRecord[]): Promise<void> {
    if (values.length === 0) {
      return;
    }

    const byId = new Map<string, TRecord>();
    for (const value of values) {
      byId.set(value.id, value);
    }
    const records = [...byId.values()];

    const previousById = new Map<string, EntityRecord>();
    for (const record of records) {
      const previous = await this.get(collection, record.id);
      if (previous) {
        previousById.set(record.id, previous);
      }
      await this.assertUniqueIndexes(collection, record, previous?.id);
    }

    const indexes = await this.listIndexes(collection);
    let indexData = await this.readIndexData(collection);
    const manifest = await this.readManifest(collection);
    const ids = new Set(manifest.ids);

    for (const record of records) {
      const previous = previousById.get(record.id);
      if (previous) {
        indexData = this.removeIndexEntriesInMemory(indexData, indexes, previous);
      }

      const file = await this.file(collection, `${record.id}.json`, true);
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(record));
      await writable.close();
      ids.add(record.id);
      indexData = this.addIndexEntriesInMemory(indexData, indexes, record);
    }

    await this.writeManifest(collection, { ids: [...ids] });
    await this.trackCollection(collection);
    await this.writeIndexData(collection, indexData);
  }

  async delete(collection: string, id: string): Promise<void> {
    const previous = await this.get(collection, id);
    if (previous) {
      await this.removeIndexEntries(collection, previous);
    }
    await (await this.collectionDirectory(collection)).removeEntry(`${id}.json`);
    await this.updateManifest(collection, (ids) => ids.filter((value) => value !== id));
  }

  async find<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[]> {
    const indexed = await this.findViaIndex<TRecord>(collection, query);
    const records = indexed ?? (await this.loadAllRecords<TRecord>(collection));
    return applyQuery(records, query);
  }

  async clear(collection?: string): Promise<void> {
    const root = await this.rootDirectory();

    if (collection) {
      await root.removeEntry(collection, { recursive: true });
      await this.updateCollections((names) => names.filter((name) => name !== collection));
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
    await this.trackCollection(definition.collection);

    const data = await this.readIndexData(definition.collection);
    data[definition.name] = {};
    await this.writeIndexData(definition.collection, data);

    for (const record of await this.loadAllRecords(definition.collection)) {
      await this.assertUniqueIndexes(definition.collection, record);
      await this.writeIndexEntries(definition.collection, record, [definition as IndexDefinition]);
    }
  }

  async dropIndex(collection: string, name: string): Promise<void> {
    const indexes = (await this.listIndexes(collection)).filter((index) => index.name !== name);
    await this.writeIndexes(collection, indexes);
    const data = await this.readIndexData(collection);
    delete data[name];
    await this.writeIndexData(collection, data);
  }

  async listIndexes(collection?: string): Promise<IndexDefinition[]> {
    if (collection) {
      return this.readIndexes(collection);
    }

    const collections = await this.readCollections();
    const indexes: IndexDefinition[] = [];

    for (const name of collections) {
      indexes.push(...(await this.readIndexes(name)));
    }

    return indexes;
  }

  private async findViaIndex<TRecord extends EntityRecord>(
    collection: string,
    query?: QueryOptions<TRecord>
  ): Promise<TRecord[] | null> {
    const match = findMatchingIndex(
      await this.listIndexes(collection),
      getEqualityFilterLookups(query?.filters)
    );

    if (!match) {
      return null;
    }

    const data = await this.readIndexData(collection);
    const ids = data[match.index.name]?.[serializeCompoundIndexValue(match.values)] ?? [];
    const records: TRecord[] = [];

    for (const id of ids) {
      const record = await this.get<TRecord>(collection, id);
      if (record) {
        records.push(record);
      }
    }

    return records;
  }

  private async loadAllRecords<TRecord extends EntityRecord>(
    collection: string
  ): Promise<TRecord[]> {
    const manifest = await this.readManifest(collection);
    const records: TRecord[] = [];

    for (const id of manifest.ids) {
      const record = await this.get<TRecord>(collection, id);
      if (record) {
        records.push(record);
      }
    }

    return records;
  }

  private async assertUniqueIndexes(
    collection: string,
    record: EntityRecord,
    ignoreId?: string
  ): Promise<void> {
    const data = await this.readIndexData(collection);

    for (const definition of await this.listIndexes(collection)) {
      if (!definition.unique) {
        continue;
      }

      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const ids = data[definition.name]?.[valueKey] ?? [];

      if (ids.some((id) => id !== record.id && id !== ignoreId)) {
        throw new Error(`Unique index "${definition.name}" violated for ${collection}`);
      }
    }
  }

  private async writeIndexEntries(
    collection: string,
    record: EntityRecord,
    definitions?: IndexDefinition[]
  ): Promise<void> {
    const indexes = definitions ?? (await this.listIndexes(collection));
    if (indexes.length === 0) {
      return;
    }

    const data = this.addIndexEntriesInMemory(await this.readIndexData(collection), indexes, record);
    await this.writeIndexData(collection, data);
  }

  private async removeIndexEntries(collection: string, record: EntityRecord): Promise<void> {
    const indexes = await this.listIndexes(collection);
    if (indexes.length === 0) {
      return;
    }

    const data = this.removeIndexEntriesInMemory(
      await this.readIndexData(collection),
      indexes,
      record
    );
    await this.writeIndexData(collection, data);
  }

  private addIndexEntriesInMemory(
    data: IndexDataFile,
    indexes: IndexDefinition[],
    record: EntityRecord
  ): IndexDataFile {
    const next = { ...data };
    for (const definition of indexes) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const bucket = { ...(next[definition.name] ?? {}) };
      const ids = new Set(bucket[valueKey] ?? []);
      ids.add(record.id);
      bucket[valueKey] = [...ids];
      next[definition.name] = bucket;
    }
    return next;
  }

  private removeIndexEntriesInMemory(
    data: IndexDataFile,
    indexes: IndexDefinition[],
    record: EntityRecord
  ): IndexDataFile {
    const next = { ...data };
    for (const definition of indexes) {
      const valueKey = serializeCompoundIndexValue(readIndexFields(record, definition.fields));
      const bucket = { ...(next[definition.name] ?? {}) };
      if (!bucket[valueKey]) {
        continue;
      }
      bucket[valueKey] = bucket[valueKey].filter((id) => id !== record.id);
      if (bucket[valueKey].length === 0) {
        delete bucket[valueKey];
      }
      next[definition.name] = bucket;
    }
    return next;
  }

  private async writeManifest(collection: string, manifest: { ids: string[] }): Promise<void> {
    const file = await this.file(collection, "__manifest.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(manifest));
    await writable.close();
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
      | { getDirectory?: () => Promise<MinimalDirectoryHandle> }
      | undefined;
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

  private async readIndexes(collection: string): Promise<IndexDefinition[]> {
    try {
      const file = await this.file(collection, "__indexes.json");
      return JSON.parse(await (await file.getFile()).text()) as IndexDefinition[];
    } catch {
      return [];
    }
  }

  private async writeIndexes(collection: string, indexes: IndexDefinition[]): Promise<void> {
    const file = await this.file(collection, "__indexes.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(indexes));
    await writable.close();
  }

  private async readIndexData(collection: string): Promise<IndexDataFile> {
    try {
      const file = await this.file(collection, "__index_data.json");
      return JSON.parse(await (await file.getFile()).text()) as IndexDataFile;
    } catch {
      return {};
    }
  }

  private async writeIndexData(collection: string, data: IndexDataFile): Promise<void> {
    const file = await this.file(collection, "__index_data.json", true);
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
  }

  private async readCollections(): Promise<string[]> {
    try {
      const root = await this.rootDirectory();
      const file = await root.getFileHandle("__collections.json");
      return JSON.parse(await (await file.getFile()).text()) as string[];
    } catch {
      return [];
    }
  }

  private async trackCollection(collection: string): Promise<void> {
    await this.updateCollections((names) => [...new Set([...names, collection])]);
  }

  private async updateCollections(update: (names: string[]) => string[]): Promise<void> {
    const names = update(await this.readCollections());
    const root = await this.rootDirectory();
    const file = await root.getFileHandle("__collections.json", { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(names));
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
