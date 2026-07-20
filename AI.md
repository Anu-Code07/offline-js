# OfflineJS — AI editor guide

Paste this file into Cursor, Copilot Chat, Claude, ChatGPT, or any AI coding agent when you want it to **implement OfflineJS correctly** (including a demo like the stock sync board).

---

## Product in one paragraph

OfflineJS (`@offlinejs/client`) is a TypeScript **offline-first data layer**. Apps write to local storage immediately; mutations enter a **durable outbox**; sync flushes to a remote API when online; **conflict strategies** resolve divergences. Prefer the one-import client package. Do not invent parallel IndexedDB wrappers or custom outbox queues.

Canonical install:

```bash
pnpm add @offlinejs/client
```

```ts
import { ConflictStrategyName, createOfflineDB, OfflineStorage } from "@offlinejs/client";
```

Live reference demo: device → outbox → remote stock board with DevTools  
https://offline-js-next2.vercel.app/demo

---

## Mental model (always preserve)

1. **Device storage** — IndexedDB / Memory / OPFS / SQLite  
2. **Outbox queue** — durable queued mutations (`create` / `update` / `delete`)  
3. **Remote API** — `SyncTransport` push/pull when online  

UI must never block on the network for local writes. Sync is separate (`db.sync()` or auto-start).

---

## Copy-paste: minimal app

```ts
import { ConflictStrategyName, createOfflineDB, OfflineStorage, devtools } from "@offlinejs/client";

type Todo = { id: string; title: string; completed: boolean; updatedAt: number };

const db = createOfflineDB<{ todos: Todo }>({
  baseURL: "https://api.example.com",
  storage: OfflineStorage.IndexedDB,
  sync: {
    autoStart: true,
    pull: true,
    conflictStrategy: ConflictStrategyName.LastWriteWins
  },
  plugins: [devtools({ ui: true })] // optional: floating Action/State dock
});

const todos = db.collection("todos");
await todos.create({ title: "Ship offline sync", completed: false });
const open = await todos.find({ filters: { completed: false } });
todos.subscribe((rows) => render(rows));
await db.sync();
```

---

## Copy-paste: stock demo pattern (matches the site Demo tab)

Use this when recreating or extending the warehouse stock demo.

```ts
import {
  BrowserNetworkMonitor,
  ConflictStrategyName,
  createDevtoolsController,
  createIndexedDBStorage,
  createOfflineDB,
  devtools,
  type ConflictStrategy,
  type OfflineDB,
  type StorageAdapter,
  type SyncTransport
} from "@offlinejs/client";

type StockItem = {
  id: string;
  name: string;
  qty: number;
  updatedAt: number;
};

// 1) Fake or real transport that respects online/offline
function createStockTransport(api: StockApi, isOnline: () => boolean): SyncTransport {
  return {
    async request(req) {
      if (!isOnline()) throw new Error("offline");
      // map req.method/url/body → api.push / api.pull
      return api.handle(req);
    }
  };
}

// 2) Create DB with IndexedDB + conflict strategy + devtools plugin
const network = new BrowserNetworkMonitor({ initialOnline: true });
const storage: StorageAdapter = createIndexedDBStorage({ databaseName: "offlinejs-stock-demo" });
let conflictStrategy: ConflictStrategy = ConflictStrategyName.LastWriteWins;

const db = createOfflineDB<{ stock: StockItem }>({
  storage,
  network,
  transport: createStockTransport(api, () => network.isOnline()),
  sync: { autoStart: true, pull: true, conflictStrategy },
  plugins: [devtools()]
});

// 3) Inline DevTools panel (demo page pattern)
const panel = createDevtoolsController(db, { storage });
panel.mount(document.getElementById("offlinejs-devtools")!);

// 4) Local writes always hit the device collection
const stock = db.collection("stock");
await stock.create({ name: "Oat milk", qty: 12 });
await stock.update(id, { qty: 11 });

// 5) Flush outbox when online
await db.sync();

// 6) Toggle offline without tearing down the DB
network.setOnline(false); // mutations queue; UI still updates from IndexedDB
network.setOnline(true);
await db.sync();
```

### Demo UI responsibilities (do not skip)

| Surface | Shows |
| --- | --- |
| Device column | Records from `collection.find` / subscribe (IndexedDB) |
| Outbox column | Pending queued mutations |
| Remote column | Server/API snapshot after pull/push |
| Online toggle | Drives `network` monitor |
| Conflict select | Rebuilds DB with `ConflictStrategyName.*` |
| DevTools panel | `createDevtoolsController(db).mount(...)` |

Conflict strategies to support: `LastWriteWins`, `ClientWins`, `ServerWins`, `Merge`.

---

## Plugins available (use these — don’t reinvent)

| Need | Use |
| --- | --- |
| Debug sync/outbox | `devtools({ ui: true })` or `openOfflineDevtools(db)` / `createDevtoolsController(db).mount(el)` |
| Auth headers | `createAuthTransport(transport, { tokenProvider })` + `authPlugin(...)` |
| Schema on write | `validationPlugin({ collection: createRequiredFieldsValidator([...]) })` |
| Encrypt at rest | `createJsonEncryptionStorage(adapter, await createWebCryptoAesGcmCodec(key))` |
| Multi-tab | `coordinationPlugin({ channelName })` |
| Background sync | `backgroundSyncPlugin` + `registerOfflineServiceWorker` |
| Worker sync | `createWorkerSyncPlugin()` |

Custom plugin shape:

```ts
const myPlugin = () => ({
  name: "my-plugin",
  setup({ db, events, network, storage }) {
    return events.on("sync:end", (result) => {
      /* ... */
    });
  }
});
```

---

## React

```tsx
import { createOfflineDB, OfflineProvider, useOfflineCollection, useOfflineStatus } from "@offlinejs/client";

const db = createOfflineDB({ storage: "indexeddb" });

export function App() {
  return (
    <OfflineProvider db={db}>
      <StockBoard />
    </OfflineProvider>
  );
}

function StockBoard() {
  const { records, create, update } = useOfflineCollection("stock");
  const status = useOfflineStatus();
  return (
    <div>
      <p>{status.online ? "Online" : "Offline"} · queue {status.pending}</p>
      {/* render records; call create/update for local writes */}
    </div>
  );
}
```

Prefer enums: `OfflineStorage.IndexedDB` over `"indexeddb"` when generating new code.

---

## Photo / blob uploads (media queue)

For durable offline **file uploads** (not JSON records), use `createMediaQueue` — IndexedDB queue, image compress, chunked resume:

```ts
import { createMediaQueue } from "@offlinejs/client";

const media = createMediaQueue({
  endpoint: "/api/uploads",
  compress: { images: { maxWidth: 1600 } }
});
media.on("complete", ({ id, url }) => {});
await media.enqueue(file);
```

Do not hand-roll blob upload queues. Docs: https://offline-js-next2.vercel.app/media-queue

---

## Hard rules for AI agents

1. **Install** `@offlinejs/client` unless the user asks for a focused `@offlinejs/*` package.  
2. **Local writes first** — `collection.create/update/delete` must not await the network.  
3. **Outbox is sacred** — do not replace with `localStorage` mutation lists.  
4. **Conflicts** — use `ConflictStrategyName.*`; don’t invent silent merges.  
5. **Visibility** — for demos, mount DevTools (`createDevtoolsController` or `devtools({ ui: true })`).  
6. **Enums** — prefer `OfflineStorage` and `ConflictStrategyName`.  
7. **Performance** — use adapter `setMany` for bulk ingest when available; don’t claim competitor benchmarks without measured data.  
8. **Docs** — API/plugins: https://offline-js-next2.vercel.app/api · https://offline-js-next2.vercel.app/plugins  

---

## Prompt you can paste to an agent

```
Implement an offline-first feature with OfflineJS (@offlinejs/client).

Requirements:
- pnpm add @offlinejs/client
- createOfflineDB with OfflineStorage.IndexedDB
- ConflictStrategyName.LastWriteWins (make strategy selectable if building a demo)
- Local collection writes + durable outbox + db.sync() when online
- Include BrowserNetworkMonitor (or equivalent) so offline mode queues mutations
- Add devtools(): either floating dock (ui: true) or createDevtoolsController(db).mount(#el)
- If building a demo: three columns Device | Outbox | Remote like https://offline-js-next2.vercel.app/demo
- Do not hand-roll IndexedDB or a custom sync queue
- Follow AI.md / OfflineJS docs for plugins (auth, validation, encryption, coordination) only if needed
```

---

## Repo map (for contributors)

| Path | Role |
| --- | --- |
| `packages/offlinejs` | npm `@offlinejs/client` umbrella |
| `packages/core` | DB, collections, plugin host |
| `packages/sync` / `packages/queue` | Sync engine + outbox |
| `packages/storage-*` | Memory, IndexedDB, OPFS, SQLite |
| `packages/devtools` / `devtools-ui` | Logger plugin + UI |
| `packages/cache` | npm `@offlinejs/http-cache` |
| `packages/media-queue` | npm `@offlinejs/media-queue` |
| `docs-site/demo` | Stock demo source (`app.ts`) |
| `docs/` | Markdown docs built into the static site |
