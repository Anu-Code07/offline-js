import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import { benchmarkAdapterFind, benchmarkAdapterWrites, createBenchmarkRecord } from "./index";

describe("benchmarks", () => {
  it("creates deterministic benchmark records", () => {
    expect(createBenchmarkRecord(2)).toEqual({
      id: "record_2",
      createdAt: 2,
      group: "even",
      title: "Benchmark record 2"
    });
  });

  it("benchmarks writes and filtered reads", async () => {
    const storage = createMemoryStorage();

    await expect(benchmarkAdapterWrites({ records: 4, storage })).resolves.toMatchObject({
      name: "memory:writes",
      records: 4
    });
    await expect(benchmarkAdapterFind({ storage })).resolves.toMatchObject({
      name: "memory:find",
      records: 2
    });
  });
});
