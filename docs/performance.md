# Performance

OfflineJS is built so local writes stay fast and sync stays cheap as datasets grow.

## What we optimize for

1. **Local UX first** — `collection.create/update` must feel instant.
2. **Durable batches** — adapters that support `setMany` write many records in one transaction.
3. **Engine pushdown** — equality filters, order, and limits run in SQLite/IndexedDB when possible.
4. **Lean sync** — the outbox is queried by status, not fully scanned on every sync.
5. **Honest benches** — report latency and rows written; do not confuse page-size ops/s with scanned rows.

## Bulk writes

```ts
import { createIndexedDBStorage } from "@offlinejs/client";

const storage = createIndexedDBStorage({ databaseName: "app" });

if (storage.setMany) {
  await storage.setMany("stock", rows); // one IndexedDB readwrite transaction
}
```

IndexedDB `set` / `setMany` now share a single transaction for:

- previous-row reads
- unique index checks
- record puts
- secondary index entry writes

## SQLite

Use a real driver for production Node workloads:

```ts
import Database from "better-sqlite3";
import { createBetterSqlite3DriverAsync, createSQLiteStorage } from "@offlinejs/client";

const driver = createBetterSqlite3DriverAsync(new Database("offline.db"));
const storage = createSQLiteStorage({ driver });
```

Equality filters + `orderBy` / `limit` / `offset` push into SQL via `json_extract` when the query is engine-safe. Complex `search` / range operators still use JS `applyQuery`.

## Sync path

- Queue `due()` loads `pending` + `failed` with status filters (not the entire outbox)
- Pull uses `setMany` when the adapter provides it
- Push runs a small concurrent batch (up to 4) safely

## Reproduce scores

```bash
pnpm bench
# OFFLINEJS_BENCH_RECORDS=50000 pnpm bench
```

See [Benchmarks](./benchmarks.md) for the latest measured table. Prefer **durationMs** (and percentiles when published) for find metrics.
