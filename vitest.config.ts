import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@offlinejs/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@offlinejs/auth": new URL("./packages/auth/src/index.ts", import.meta.url).pathname,
      "@offlinejs/benchmarks": new URL("./packages/benchmarks/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/conflicts": new URL("./packages/conflicts/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/coordination": new URL("./packages/coordination/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/devtools-ui": new URL("./packages/devtools-ui/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/encryption": new URL("./packages/encryption/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/network": new URL("./packages/network/src/index.ts", import.meta.url).pathname,
      "@offlinejs/queue": new URL("./packages/queue/src/index.ts", import.meta.url).pathname,
      "@offlinejs/service-worker": new URL(
        "./packages/service-worker/src/index.ts",
        import.meta.url
      ).pathname,
      "@offlinejs/storage-indexeddb": new URL(
        "./packages/storage-indexeddb/src/index.ts",
        import.meta.url
      ).pathname,
      "@offlinejs/storage-memory": new URL(
        "./packages/storage-memory/src/index.ts",
        import.meta.url
      ).pathname,
      "@offlinejs/storage-opfs": new URL("./packages/storage-opfs/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/storage-sqlite": new URL(
        "./packages/storage-sqlite/src/index.ts",
        import.meta.url
      ).pathname,
      "@offlinejs/sync": new URL("./packages/sync/src/index.ts", import.meta.url).pathname,
      "@offlinejs/sync-protocol": new URL("./packages/sync-protocol/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/types": new URL("./packages/types/src/index.ts", import.meta.url).pathname,
      "@offlinejs/utils": new URL("./packages/utils/src/index.ts", import.meta.url).pathname,
      "@offlinejs/validation": new URL("./packages/validation/src/index.ts", import.meta.url)
        .pathname,
      "@offlinejs/worker-sync": new URL("./packages/worker-sync/src/index.ts", import.meta.url)
        .pathname
    }
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
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
