import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import {
  benchmarkAdapterBatchWrites,
  benchmarkAdapterFind,
  benchmarkAdapterWrites,
  benchmarkIndexedFind,
  createBenchmarkRecord,
  formatBenchmarkResult,
  runAdapterBenchmarkSuite
} from "./index";

describe("benchmarks", () => {
  it("creates deterministic benchmark records", () => {
    expect(createBenchmarkRecord(2)).toEqual({
      id: "record_2",
      createdAt: 2,
      group: "even",
      title: "Benchmark record 2"
    });
  });

  it("benchmarks writes, batch writes, filtered reads, and indexed finds", async () => {
    const storage = createMemoryStorage();

    await expect(benchmarkAdapterWrites({ records: 4, storage })).resolves.toMatchObject({
      name: "memory:writes",
      records: 4
    });
    await expect(
      benchmarkAdapterBatchWrites({ batchSize: 2, records: 4, storage: createMemoryStorage() })
    ).resolves.toMatchObject({
      name: "memory:batch-writes",
      records: 4
    });
    await expect(benchmarkAdapterFind({ storage })).resolves.toMatchObject({
      name: "memory:find",
      records: 2
    });
    await expect(benchmarkIndexedFind({ storage })).resolves.toMatchObject({
      name: "memory:indexed-find",
      records: 2
    });
  });

  it("runs a write/find suite and formats results", async () => {
    const suite = await runAdapterBenchmarkSuite({
      records: 6,
      storage: createMemoryStorage()
    });

    expect(suite.writes.records).toBe(6);
    expect(suite.find.name).toContain("find");
    expect(formatBenchmarkResult(suite.writes)).toContain("memory:writes");
  });
});
