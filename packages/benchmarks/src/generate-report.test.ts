import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createIndexedDBStorage } from "@offlinejs/storage-indexeddb";
import { createMemoryStorage } from "@offlinejs/storage-memory";
import { createSQLiteStorage, type SQLiteDriver } from "@offlinejs/storage-sqlite";
import { formatPerformanceReportMarkdown, runPerformanceReport } from "./index";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const datasetSize = Number(process.env.OFFLINEJS_BENCH_RECORDS ?? 10_000);

const createMemorySqliteDriver = (): SQLiteDriver => {
  const records = new Map<string, string>();
  const indexes = new Map<string, string>();
  const entries = new Map<string, string>();

  return {
    async execute(sql, params = []) {
      if (sql.startsWith("CREATE")) {
        return;
      }
      if (sql.startsWith("INSERT OR REPLACE INTO") && sql.includes("_index_entries")) {
        entries.set(`${params[0]}:${params[1]}:${params[2]}:${params[3]}`, String(params[3]));
        return;
      }
      if (sql.startsWith("INSERT OR REPLACE INTO") && sql.includes("_indexes")) {
        indexes.set(`${params[0]}:${params[1]}`, String(params[2]));
        return;
      }
      if (sql.startsWith("INSERT OR REPLACE INTO")) {
        records.set(`${params[0]}:${params[1]}`, String(params[2]));
        return;
      }
      if (sql.includes("_index_entries") && sql.startsWith("DELETE")) {
        if (params.length >= 4) {
          entries.delete(`${params[0]}:${params[1]}:${params[2]}:${params[3]}`);
          return;
        }
        if (params.length === 2) {
          for (const key of [...entries.keys()]) {
            if (key.startsWith(`${params[0]}:${params[1]}:`)) {
              entries.delete(key);
            }
          }
          return;
        }
        if (params.length === 1) {
          for (const key of [...entries.keys()]) {
            if (key.startsWith(`${params[0]}:`)) {
              entries.delete(key);
            }
          }
          return;
        }
        entries.clear();
        return;
      }
      if (sql.includes("_indexes") && sql.startsWith("DELETE") && params.length === 2) {
        indexes.delete(`${params[0]}:${params[1]}`);
        return;
      }
      if (sql.startsWith("DELETE") && params.length === 2) {
        records.delete(`${params[0]}:${params[1]}`);
        return;
      }
      if (sql.includes("_indexes") && sql.startsWith("DELETE") && params.length === 1) {
        for (const key of [...indexes.keys()]) {
          if (key.startsWith(`${params[0]}:`)) {
            indexes.delete(key);
          }
        }
        return;
      }
      if (sql.startsWith("DELETE") && params.length === 1) {
        for (const key of [...records.keys()]) {
          if (key.startsWith(`${params[0]}:`)) {
            records.delete(key);
          }
        }
        return;
      }
      if (sql.includes("_indexes") && sql.startsWith("DELETE")) {
        indexes.clear();
        return;
      }
      if (sql.startsWith("DELETE")) {
        records.clear();
        entries.clear();
      }
    },
    async query(sql, params = []) {
      if (sql.includes("_index_entries")) {
        return [...entries.keys()]
          .filter((key) => {
            const [collection, indexName, valueKey] = key.split(":");
            return collection === params[0] && indexName === params[1] && valueKey === params[2];
          })
          .map((key) => ({ record_id: key.split(":").at(-1) })) as never[];
      }
      if (sql.includes("_indexes")) {
        return [...indexes.entries()]
          .filter(([key]) => params.length === 0 || key.startsWith(`${params[0]}:`))
          .map(([, value]) => ({ value })) as never[];
      }
      if (sql.includes("LIMIT 1")) {
        const value = records.get(`${params[0]}:${params[1]}`);
        return value ? ([{ value }] as never[]) : [];
      }
      if (sql.includes(" AND id IN (")) {
        const ids = params.slice(1).map(String);
        return ids
          .map((id) => records.get(`${params[0]}:${id}`))
          .filter((value): value is string => value !== undefined)
          .map((value) => ({ value })) as never[];
      }
      return [...records.entries()]
        .filter(([key]) => key.startsWith(`${params[0]}:`))
        .map(([, value]) => ({ value })) as never[];
    },
    transaction: (run) => run()
  };
};

describe.skipIf(process.env.OFFLINEJS_WRITE_BENCH !== "1")("performance report generation", () => {
  it(
    "benchmarks real storage packages and writes docs scores",
    async () => {
      globalThis.indexedDB = new IDBFactory();

      const report = await runPerformanceReport({
        datasetSize,
        includeBatchWrites: true,
        adapters: [
          { label: "memory", storage: createMemoryStorage() },
          {
            label: "indexeddb",
            storage: createIndexedDBStorage({ databaseName: `bench-${Date.now()}` })
          },
          { label: "sqlite", storage: createSQLiteStorage({ driver: createMemorySqliteDriver() }) }
        ]
      });

      const docsDir = join(root, "docs");
      const assetsDir = join(root, "docs-site/assets");
      mkdirSync(docsDir, { recursive: true });
      mkdirSync(assetsDir, { recursive: true });

      const markdown = `${formatPerformanceReportMarkdown(report)}

## How to reproduce

\`\`\`bash
pnpm bench
# optional: OFFLINEJS_BENCH_RECORDS=50000 pnpm bench
\`\`\`

This report is generated by exercising the real \`@offlinejs/storage-*\` adapters through
\`@offlinejs/benchmarks\` (\`runPerformanceReport\`). Scores below are from this machine run.

## What was optimized

Recent performance work targets hot paths the suite measures:

- Memory finds clone only the returned page, not the full collection
- Shared \`applyQuery\` skips redundant filter/sort copies
- IndexedDB / SQLite indexed finds batch record hydration (no N+1 waits)
- Queue/sync share one queue snapshot per sync pass
- Collection \`paginate\` uses a single storage read
`;

      writeFileSync(join(docsDir, "benchmark-results.json"), `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(
        join(assetsDir, "benchmark-results.json"),
        `${JSON.stringify(report, null, 2)}\n`
      );
      writeFileSync(join(docsDir, "benchmarks.md"), markdown);

      const memoryWrites = report.scores.find(
        (score) => score.adapter === "memory" && score.metric === "writes"
      );
      const memoryFind = report.scores.find(
        (score) => score.adapter === "memory" && score.metric === "find"
      );

      expect(report.adapters.map((adapter) => adapter.adapter)).toEqual([
        "memory",
        "indexeddb",
        "sqlite"
      ]);
      expect(memoryWrites?.opsPerSecond).toBeGreaterThan(1_000);
      expect(memoryFind?.durationMs).toBeLessThan(250);
      console.log(formatPerformanceReportMarkdown(report));
    },
    600_000
  );
});
