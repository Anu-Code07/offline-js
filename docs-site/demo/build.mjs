import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const workspace = join(root, "../..");
const outfile = join(root, "../assets/demo.js");

const pkg = (name, file = "src/index.ts") => join(workspace, "packages", name, file);

await esbuild.build({
  absWorkingDir: workspace,
  alias: {
    "@offlinejs/client": pkg("offlinejs"),
    "@offlinejs/core": pkg("core"),
    "@offlinejs/types": pkg("types"),
    "@offlinejs/utils": pkg("utils"),
    "@offlinejs/network": pkg("network"),
    "@offlinejs/queue": pkg("queue"),
    "@offlinejs/sync": pkg("sync"),
    "@offlinejs/storage-memory": pkg("storage-memory"),
    "@offlinejs/storage-indexeddb": pkg("storage-indexeddb"),
    "@offlinejs/storage-opfs": pkg("storage-opfs"),
    "@offlinejs/storage-sqlite": pkg("storage-sqlite"),
    "@offlinejs/react": pkg("react"),
    "@offlinejs/auth": pkg("auth"),
    "@offlinejs/benchmarks": pkg("benchmarks"),
    "@offlinejs/validation": pkg("validation"),
    "@offlinejs/encryption": pkg("encryption"),
    "@offlinejs/sw": pkg("service-worker"),
    "@offlinejs/broadcast": pkg("coordination"),
    "@offlinejs/conflicts": pkg("conflicts"),
    "@offlinejs/worker-sync": pkg("worker-sync"),
    "@offlinejs/devtools": pkg("devtools"),
    "@offlinejs/devtools-ui": pkg("devtools-ui"),
    "@offlinejs/next": pkg("next"),
    "@offlinejs/sync-protocol": pkg("sync-protocol")
  },
  bundle: true,
  entryPoints: [join(root, "app.ts")],
  format: "esm",
  outfile,
  platform: "browser",
  target: ["es2022"],
  logLevel: "info"
});

console.log(`Demo bundle written → ${outfile}`);
