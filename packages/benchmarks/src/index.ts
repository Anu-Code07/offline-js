import type { EntityRecord, StorageAdapter } from "@offlinejs/types";

export interface BenchmarkResult {
  durationMs: number;
  name: string;
  records: number;
}

export interface AdapterBenchmarkOptions {
  collection?: string;
  records?: number;
  storage: StorageAdapter;
}

export const benchmarkAdapterWrites = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkResult> => {
  const records = options.records ?? 100_000;
  const collection = options.collection ?? "benchmark";
  const startedAt = performance.now();

  for (let index = 0; index < records; index += 1) {
    await options.storage.set(collection, createBenchmarkRecord(index));
  }

  return {
    durationMs: performance.now() - startedAt,
    name: `${options.storage.name}:writes`,
    records
  };
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

  return {
    durationMs: performance.now() - startedAt,
    name: `${options.storage.name}:find`,
    records: records.length
  };
};

export const createBenchmarkRecord = (index: number): EntityRecord => ({
  id: `record_${index}`,
  createdAt: index,
  group: index % 2 === 0 ? "even" : "odd",
  title: `Benchmark record ${index}`
});
