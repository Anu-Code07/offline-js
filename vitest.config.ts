import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@offlinejs/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@offlinejs/network": new URL("./packages/network/src/index.ts", import.meta.url).pathname,
      "@offlinejs/queue": new URL("./packages/queue/src/index.ts", import.meta.url).pathname,
      "@offlinejs/storage-indexeddb": new URL(
        "./packages/storage-indexeddb/src/index.ts",
        import.meta.url
      ).pathname,
      "@offlinejs/storage-memory": new URL(
        "./packages/storage-memory/src/index.ts",
        import.meta.url
      ).pathname,
      "@offlinejs/sync": new URL("./packages/sync/src/index.ts", import.meta.url).pathname,
      "@offlinejs/types": new URL("./packages/types/src/index.ts", import.meta.url).pathname,
      "@offlinejs/utils": new URL("./packages/utils/src/index.ts", import.meta.url).pathname
    }
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"]
    },
    globals: true,
    include: ["packages/**/*.test.ts"]
  }
});
