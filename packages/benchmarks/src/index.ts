import type { EntityRecord, IndexableStorageAdapter, StorageAdapter } from "@offlinejs/types";

export interface BenchmarkResult {
  durationMs: number;
  name: string;
  /** Rows returned / written for this timed operation. */
  records: number;
  /** Dataset size the adapter was measured against, when relevant. */
  datasetSize?: number;
  throughputPerSecond?: number;
}

export interface AdapterBenchmarkOptions {
  collection?: string;
  records?: number;
  storage: StorageAdapter;
}

export interface BenchmarkSuiteResult {
  batchWrites?: BenchmarkResult;
  find: BenchmarkResult;
  indexedFind?: BenchmarkResult;
  writes: BenchmarkResult;
}

export interface PerformanceReportAdapter {
  adapter: string;
  datasetSize: number;
  suite: BenchmarkSuiteResult;
}

export interface PerformanceReport {
  adapters: PerformanceReportAdapter[];
  generatedAt: string;
  node: string;
  notes: string[];
  scores: PerformanceScore[];
}

export interface PerformanceScore {
  adapter: string;
  metric: string;
  durationMs: number;
  opsPerSecond: number;
  records: number;
  datasetSize: number;
  /** Rows scanned / written for latency metrics (find uses page size in `records`). */
  rowsScanned?: number;
  p50Ms?: number;
  p95Ms?: number;
  p99Ms?: number;
}

/** Run a timed operation repeatedly and return percentile latency stats. */
export const measurePercentiles = async (
  name: string,
  runs: number,
  operation: () => Promise<void>
): Promise<{ name: string; p50Ms: number; p95Ms: number; p99Ms: number; samples: number[] }> => {
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    await operation();
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  const pick = (percentile: number): number => {
    const rank = Math.min(samples.length - 1, Math.max(0, Math.ceil((percentile / 100) * samples.length) - 1));
    return samples[rank] ?? 0;
  };
  return {
    name,
    p50Ms: pick(50),
    p95Ms: pick(95),
    p99Ms: pick(99),
    samples
  };
};

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

  return toResult(`${options.storage.name}:writes`, records, startedAt, records);
};

export const benchmarkAdapterBatchWrites = async (
  options: AdapterBenchmarkOptions & { batchSize?: number }
): Promise<BenchmarkResult> => {
  const records = options.records ?? 100_000;
  const collection = options.collection ?? "benchmark";
  const batchSize = options.batchSize ?? 500;
  const startedAt = performance.now();

  for (let index = 0; index < records; index += batchSize) {
    const chunk = Array.from({ length: Math.min(batchSize, records - index) }, (_, offset) =>
      createBenchmarkRecord(index + offset)
    );
    if (typeof options.storage.setMany === "function") {
      await options.storage.setMany(collection, chunk);
    } else {
      await Promise.all(chunk.map((record) => options.storage.set(collection, record)));
    }
  }

  return toResult(`${options.storage.name}:batch-writes`, records, startedAt, records);
};

export const benchmarkAdapterFind = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkResult> => {
  const collection = options.collection ?? "benchmark";
  const datasetSize = options.records ?? (await options.storage.find(collection)).length;
  const startedAt = performance.now();
  const records = await options.storage.find(collection, {
    filters: { group: "even" },
    limit: 100,
    orderBy: "createdAt",
    sort: "desc"
  });

  return toResult(`${options.storage.name}:find`, records.length, startedAt, datasetSize);
};

export const benchmarkIndexedFind = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkResult> => {
  const collection = options.collection ?? "benchmark";
  const storage = options.storage as IndexableStorageAdapter;
  const datasetSize = options.records ?? (await options.storage.find(collection)).length;

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

  return toResult(`${options.storage.name}:indexed-find`, records.length, startedAt, datasetSize);
};

/** Seed + write/find suite sized for adapter comparisons. */
export const runAdapterBenchmarkSuite = async (
  options: AdapterBenchmarkOptions
): Promise<BenchmarkSuiteResult> => {
  const writes = await benchmarkAdapterWrites(options);
  const find = await benchmarkAdapterFind(options);
  const indexedFind = await benchmarkIndexedFind(options);

  return { writes, find, indexedFind };
};

/**
 * Run a multi-adapter performance report against real OfflineJS storage packages.
 * Callers supply already-constructed adapters (memory / IndexedDB / SQLite / …).
 */
export const runPerformanceReport = async (options: {
  adapters: Array<{ label?: string; storage: StorageAdapter }>;
  datasetSize?: number;
  includeBatchWrites?: boolean;
}): Promise<PerformanceReport> => {
  const datasetSize = options.datasetSize ?? 10_000;
  const adapters: PerformanceReportAdapter[] = [];

  for (const entry of options.adapters) {
    await entry.storage.clear();

    let batchWrites: BenchmarkResult | undefined;
    if (options.includeBatchWrites) {
      batchWrites = await benchmarkAdapterBatchWrites({
        storage: entry.storage,
        records: datasetSize
      });
      await entry.storage.clear();
    }

    const suite = await runAdapterBenchmarkSuite({
      storage: entry.storage,
      records: datasetSize
    });

    adapters.push({
      adapter: entry.label ?? entry.storage.name,
      datasetSize,
      suite: batchWrites ? { ...suite, batchWrites } : suite
    });
  }

  const scores = adapters.flatMap((adapter) =>
    [adapter.suite.writes, adapter.suite.batchWrites, adapter.suite.find, adapter.suite.indexedFind]
      .filter((result): result is BenchmarkResult => Boolean(result))
      .map((result) => ({
        adapter: adapter.adapter,
        metric: result.name.split(":").slice(1).join(":") || result.name,
        durationMs: Number(result.durationMs.toFixed(2)),
        opsPerSecond: Number((result.throughputPerSecond ?? 0).toFixed(0)),
        records: result.records,
        datasetSize: adapter.datasetSize
      }))
  );

  return {
    generatedAt: new Date().toISOString(),
    node: typeof process !== "undefined" ? process.version : "unknown",
    notes: [
      "Writes measure sequential storage.set throughput.",
      "Batch writes use storage.setMany when available (one durable batch path).",
      "Find measures filtered+sorted+limited query latency; records = page size returned.",
      "Indexed find creates a secondary index on `group`, then times equality lookup.",
      "Prefer durationMs / percentiles for finds — ops/s on page size is not rows scanned."
    ],
    adapters,
    scores
  };
};

export const formatBenchmarkResult = (result: BenchmarkResult): string => {
  const throughput =
    result.throughputPerSecond === undefined
      ? ""
      : ` (${result.throughputPerSecond.toFixed(0)} ops/s)`;
  return `${result.name}: ${result.records} records in ${result.durationMs.toFixed(2)}ms${throughput}`;
};

export const formatPerformanceReportMarkdown = (report: PerformanceReport): string => {
  const lines = [
    `# OfflineJS Benchmarks`,
    ``,
    `Generated: ${report.generatedAt} · Node ${report.node}`,
    ``,
    `| Adapter | Metric | Dataset | Duration | Throughput |`,
    `| --- | --- | ---: | ---: | ---: |`
  ];

  for (const score of report.scores) {
    lines.push(
      `| ${score.adapter} | ${score.metric} | ${score.datasetSize.toLocaleString()} | ${score.durationMs.toFixed(2)}ms | ${score.opsPerSecond.toLocaleString()} ops/s |`
    );
  }

  lines.push("", "## Notes", "");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  return lines.join("\n");
};

const toResult = (
  name: string,
  records: number,
  startedAt: number,
  datasetSize?: number
): BenchmarkResult => {
  const durationMs = performance.now() - startedAt;
  return {
    durationMs,
    name,
    records,
    ...(datasetSize === undefined ? {} : { datasetSize }),
    ...(durationMs > 0 ? { throughputPerSecond: (records / durationMs) * 1000 } : {})
  };
};
