import type { EntityRecord, IndexableStorageAdapter, StorageAdapter } from "@offlinejs/types";

export interface BenchmarkResult {
  durationMs: number;
  name: string;
  records: number;
  throughputPerSecond?: number;
}

export interface AdapterBenchmarkOptions {
  collection?: string;
  records?: number;
  storage: StorageAdapter;
}

export interface BenchmarkSuiteResult {
  find: BenchmarkResult;
  indexedFind?: BenchmarkResult;
  writes: BenchmarkResult;
}

export const createBenchmarkRecord = (index: number): EntityRecord => ({
  id: `record_${index}`,
  createdAt: index,
  group: index % 2 === 0 ? "even" : "odd",
  title: `Benchmark record ${index}`
});

export const benchmarkAdapterWrites = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkResult> => {
  const records = options.records ?? 100_000;
  const collection = options.collection ?? "benchmark";
  const startedAt = performance.now();

  for (let index = 0; index < records; index += 1) {
    await options.storage.set(collection, createBenchmarkRecord(index));
  }

  return toResult(`${options.storage.name}:writes`, records, startedAt);
};

export const benchmarkAdapterBatchWrites = async (
  options: AdapterBenchmarkOptions & { batchSize?: number }
): Promise<BenchmarkResult> => {
  const records = options.records ?? 100_000;
  const collection = options.collection ?? "benchmark";
  const batchSize = options.batchSize ?? 500;
  const startedAt = performance.now();

  for (let index = 0; index < records; index += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, records - index) }, (_, offset) =>
      options.storage.set(collection, createBenchmarkRecord(index + offset))
    );
    await Promise.all(batch);
  }

  return toResult(`${options.storage.name}:batch-writes`, records, startedAt);
};

export const benchmarkAdapterFind = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkResult> => {
  const collection = options.collection ?? "benchmark";
  const startedAt = performance.now();
  const records = await options.storage.find(collection, {
    filters: { group: "even" },
    limit: 100,
    orderBy: "createdAt",
    sort: "desc"
  });

  return toResult(`${options.storage.name}:find`, records.length, startedAt);
};

export const benchmarkIndexedFind = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkResult> => {
  const collection = options.collection ?? "benchmark";
  const storage = options.storage as IndexableStorageAdapter;

  if (typeof storage.createIndex === "function") {
    await storage.createIndex({
      collection,
      fields: ["group"],
      name: "benchmark_group"
    });
  }

  const startedAt = performance.now();
  const records = await options.storage.find(collection, {
    filters: { group: "even" },
    limit: 100
  });

  return toResult(`${options.storage.name}:indexed-find`, records.length, startedAt);
};

/** Seed + write/find suite sized for 100k-record adapter comparisons. */
export const runAdapterBenchmarkSuite = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkSuiteResult> => {
  const writes = await benchmarkAdapterWrites(options);
  const find = await benchmarkAdapterFind(options);
  const indexedFind = await benchmarkIndexedFind(options);

  return { find, indexedFind, writes };
};

export const formatBenchmarkResult = (result: BenchmarkResult): string => {
  const throughput =
    result.throughputPerSecond === undefined
      ? ""
      : ` (${result.throughputPerSecond.toFixed(0)} ops/s)`;
  return `${result.name}: ${result.records} records in ${result.durationMs.toFixed(2)}ms${throughput}`;
};

const toResult = (name: string, records: number, startedAt: number): BenchmarkResult => {
  const durationMs = performance.now() - startedAt;
  return {
    durationMs,
    name,
    records,
    ...(durationMs > 0 ? { throughputPerSecond: (records / durationMs) * 1000 } : {})
  };
};
