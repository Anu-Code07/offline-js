import { defineConfig } from "vitest/config";

const root = import.meta.url;

const pkg = (relativePath: string): string => new URL(relativePath, root).pathname;

export default defineConfig({
  resolve: {
    alias: [
      { find: "@offlinejs/core", replacement: pkg("./packages/core/src/index.ts") },
      { find: "@offlinejs/auth", replacement: pkg("./packages/auth/src/index.ts") },
      { find: "@offlinejs/benchmarks", replacement: pkg("./packages/benchmarks/src/index.ts") },
      { find: "@offlinejs/conflicts", replacement: pkg("./packages/conflicts/src/index.ts") },
      { find: "@offlinejs/coordination", replacement: pkg("./packages/coordination/src/index.ts") },
      { find: "@offlinejs/devtools-ui", replacement: pkg("./packages/devtools-ui/src/index.ts") },
      { find: "@offlinejs/devtools", replacement: pkg("./packages/devtools/src/index.ts") },
      { find: "@offlinejs/encryption", replacement: pkg("./packages/encryption/src/index.ts") },
      { find: "@offlinejs/network", replacement: pkg("./packages/network/src/index.ts") },
      { find: "@offlinejs/next", replacement: pkg("./packages/next/src/index.ts") },
      { find: "@offlinejs/queue", replacement: pkg("./packages/queue/src/index.ts") },
      { find: "@offlinejs/react", replacement: pkg("./packages/react/src/index.ts") },
      {
        find: "@offlinejs/service-worker",
        replacement: pkg("./packages/service-worker/src/index.ts")
      },
      {
        find: "@offlinejs/storage-indexeddb",
        replacement: pkg("./packages/storage-indexeddb/src/index.ts")
      },
      {
        find: "@offlinejs/storage-memory",
        replacement: pkg("./packages/storage-memory/src/index.ts")
      },
      { find: "@offlinejs/storage-opfs", replacement: pkg("./packages/storage-opfs/src/index.ts") },
      {
        find: "@offlinejs/storage-sqlite",
        replacement: pkg("./packages/storage-sqlite/src/index.ts")
      },
      { find: "@offlinejs/sync-protocol", replacement: pkg("./packages/sync-protocol/src/index.ts") },
      { find: "@offlinejs/sync", replacement: pkg("./packages/sync/src/index.ts") },
      { find: "@offlinejs/types", replacement: pkg("./packages/types/src/index.ts") },
      { find: "@offlinejs/utils", replacement: pkg("./packages/utils/src/index.ts") },
      { find: "@offlinejs/validation", replacement: pkg("./packages/validation/src/index.ts") },
      { find: "@offlinejs/worker-sync", replacement: pkg("./packages/worker-sync/src/index.ts") },
      { find: /^@offlinejs$/, replacement: pkg("./packages/offlinejs/src/index.ts") }
    ]
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        // React hooks require a DOM test environment; covered by createOfflineExternalStore tests.
        "packages/react/src/index.ts"
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        functions: 90,
        lines: 90,
        statements: 90
      }
    },
    globals: true,
    include: ["packages/**/*.test.ts"]
  }
});
