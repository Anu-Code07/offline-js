# Plugins

Plugins let applications add behavior without changing core internals. Pass them to `createOfflineDB({ plugins })` or call `db.use(plugin)`.

```ts
const analytics = () => ({
  name: "analytics",
  setup({ events }) {
    return events.on("sync:end", (result) => {
      sendMetric("offlinejs.sync", result);
    });
  }
});

db.use(analytics());
```

`setup` receives `{ db, events, network, storage }` and may return a disposer.

## Catalog (shipped with `@offlinejs/client`)

| Plugin / helper | Role |
| --- | --- |
| `devtools({ ui? })` | Event logger + optional floating Redux-style dock |
| `createDevtoolsController` / `openOfflineDevtools` | Inline or floating Action / State / Outbox UI |
| `authPlugin` / `createAuthTransport` | Attach & refresh auth headers on sync transport |
| `validationPlugin` / `createValidatedStorage` | Validate records before they hit storage |
| `createJsonEncryptionStorage` | Encrypt JSON records at rest (AES-GCM) |
| `coordinationPlugin` | Multi-tab leader election & sync coordination |
| `backgroundSyncPlugin` | Ask the service worker to sync when possible |
| `createWorkerSyncPlugin` | Run sync inside a Web Worker |

Good plugin use cases: authentication, encryption, logging, analytics, schema validation, DevTools, multi-tab leadership, background sync.

## DevTools

OfflineJS ships Redux-style developer tools:

- `@offlinejs/devtools` — console logger plugin; optional floating UI via `ui: true`
- `@offlinejs/devtools-ui` — dockable Action / State panel (`mount`, `open`, pause/clear/filter)

### One-liner floating dock

```ts
import { createOfflineDB, openOfflineDevtools, OfflineStorage, devtools } from "@offlinejs/client";

const db = createOfflineDB({
  storage: OfflineStorage.IndexedDB,
  plugins: [devtools({ ui: true })] // logs + opens floating dock
});

// or open manually:
const panel = openOfflineDevtools(db, { position: "bottom" });
// Ctrl/⌘ + Shift + O toggles the dock
```

### Inline panel (docs / embeds)

```ts
import { createOfflineDB, createDevtoolsController, OfflineStorage, devtools } from "@offlinejs/client";

const db = createOfflineDB({
  storage: OfflineStorage.IndexedDB,
  plugins: [devtools()]
});

const panel = createDevtoolsController(db);
panel.mount(document.getElementById("offlinejs-devtools"));
```

The panel shows:

- live **Action** log (`queue:*`, `sync:*`, network, conflicts, errors…)
- filter chips + search
- pause / resume / clear
- **State / Outbox** tab (when storage is available)
- floating dock (`open()`) or inline `mount(target)`

See the interactive showcase at [the live demo](demo.html).

## Auth

Wrap any `SyncTransport` so every request carries a token:

```ts
import { authPlugin, createAuthTransport, createFetchTransport, createOfflineDB } from "@offlinejs/client";

const transport = createAuthTransport(createFetchTransport({ baseURL: "/api" }), {
  tokenProvider: () => localStorage.getItem("access_token"),
  headerName: "authorization",
  scheme: "Bearer",
  retryOnUnauthorized: true,
  refreshToken: () => refreshSession()
});

createOfflineDB({
  transport,
  plugins: [
    authPlugin({
      tokenProvider: () => localStorage.getItem("access_token")
    })
  ]
});
```

## Validation

Reject bad writes before they enter storage / outbox:

```ts
import {
  composeValidators,
  createRequiredFieldsValidator,
  createTypeValidator,
  createOfflineDB,
  validationPlugin
} from "@offlinejs/client";

createOfflineDB({
  plugins: [
    validationPlugin({
      stock: composeValidators(
        createRequiredFieldsValidator(["name", "qty"]),
        createTypeValidator({ name: "string", qty: "number" })
      )
    })
  ]
});
```

Helpers: `assertValid`, `createValidatedStorage`, `OfflineValidationError`.

## Encryption

```ts
import {
  createIndexedDBStorage,
  createJsonEncryptionStorage,
  createOfflineDB,
  createWebCryptoAesGcmCodec,
  generateAesGcmKey
} from "@offlinejs/client";

const key = await generateAesGcmKey();
const codec = await createWebCryptoAesGcmCodec(key);

createOfflineDB({
  storage: createJsonEncryptionStorage(createIndexedDBStorage({ databaseName: "secure" }), codec)
});
```

## Multi-tab coordination

```ts
import { coordinationPlugin, createOfflineDB } from "@offlinejs/client";

createOfflineDB({
  plugins: [
    coordinationPlugin({
      channelName: "offlinejs-app",
      syncDebounceMs: 200
    })
  ]
});
```

Uses `BroadcastChannel` when available so tabs elect a leader and avoid stampedes.

## Background sync & workers

```ts
import {
  backgroundSyncPlugin,
  createWorkerSyncPlugin,
  registerOfflineServiceWorker,
  createOfflineDB
} from "@offlinejs/client";

await registerOfflineServiceWorker({ scriptUrl: "/sw.js" });

createOfflineDB({
  plugins: [
    backgroundSyncPlugin({ syncTag: "offlinejs-sync" }),
    createWorkerSyncPlugin()
  ]
});
```

## Writing your own

```ts
import type { OfflinePlugin } from "@offlinejs/client";

export const metricsPlugin = (): OfflinePlugin => ({
  name: "metrics",
  setup({ events }) {
    const stop = events.on("conflict", (detail) => {
      console.warn("conflict", detail);
    });
    return stop;
  }
});
```

For AI-assisted implementation (including recreating the stock demo), paste [AI.md](ai.html) into your editor.
