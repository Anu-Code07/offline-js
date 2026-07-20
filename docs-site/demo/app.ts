import {
  BrowserNetworkMonitor,
  ConflictStrategyName,
  createDevtoolsController,
  createIndexedDBStorage,
  createOfflineDB,
  devtools,
  type ConflictStrategy,
  type OfflineDB,
  type StorageAdapter
} from "@offlinejs";
import type { QueuedMutation } from "@offlinejs/types";
import { FakeStockApi, type StockItem } from "./fake-api";

type DemoDb = OfflineDB<{ stock: StockItem }>;

const DB_NAME = "offlinejs-stock-demo";
const QUEUE_COLLECTION = "__offline_queue";

const api = new FakeStockApi();
const network = new BrowserNetworkMonitor({ initialOnline: true });
let storage: StorageAdapter = createIndexedDBStorage({ databaseName: DB_NAME });
let conflictStrategy: ConflictStrategy = ConflictStrategyName.LastWriteWins;
let db: DemoDb = createDemoDb();
let panel = createDevtoolsController(db);
let unsubscribe: (() => void) | undefined;
let eventDisposers: Array<() => void> = [];

const els = {
  onlineToggle: document.querySelector<HTMLInputElement>("#online-toggle")!,
  onlineLabel: document.querySelector<HTMLElement>("#online-label")!,
  linkState: document.querySelector<HTMLElement>("#link-state")!,
  strategy: document.querySelector<HTMLSelectElement>("#conflict-strategy")!,
  seedBtn: document.querySelector<HTMLButtonElement>("#seed-random")!,
  syncBtn: document.querySelector<HTMLButtonElement>("#sync-now")!,
  conflictBtn: document.querySelector<HTMLButtonElement>("#simulate-conflict")!,
  resetBtn: document.querySelector<HTMLButtonElement>("#reset-demo")!,
  nameInput: document.querySelector<HTMLInputElement>("#item-name")!,
  qtyInput: document.querySelector<HTMLInputElement>("#item-qty")!,
  addBtn: document.querySelector<HTMLButtonElement>("#add-item")!,
  deviceList: document.querySelector<HTMLElement>("#device-list")!,
  outboxList: document.querySelector<HTMLElement>("#outbox-list")!,
  serverList: document.querySelector<HTMLElement>("#server-list")!,
  deviceMeta: document.querySelector<HTMLElement>("#device-meta")!,
  outboxMeta: document.querySelector<HTMLElement>("#outbox-meta")!,
  serverMeta: document.querySelector<HTMLElement>("#server-meta")!,
  status: document.querySelector<HTMLElement>("#demo-status")!,
  flow: document.querySelector<HTMLElement>("#sync-flow")!,
  devtools: document.querySelector<HTMLElement>("#offlinejs-devtools")!
};

function createDemoDb(): DemoDb {
  return createOfflineDB<{ stock: StockItem }>({
    storage,
    network,
    transport: api.createTransport(() => network.isOnline()),
    sync: {
      autoStart: true,
      conflictStrategy,
      pull: true
    },
    plugins: [devtools()]
  });
}

async function boot(): Promise<void> {
  panel.mount(els.devtools);
  wireControls();
  wireEvents();
  await bindCollection();
  await pullIfOnline();
  await refreshAll();
  setStatus("Go offline, change a quantity, watch the outbox fill, then sync.");
}

function wireControls(): void {
  els.onlineToggle.checked = network.isOnline();
  updateLinkUi(network.isOnline());

  els.onlineToggle.addEventListener("change", () => {
    network.setOnline(els.onlineToggle.checked);
    updateLinkUi(els.onlineToggle.checked);
    setStatus(
      els.onlineToggle.checked
        ? "Link restored — outbox can flush to the remote API."
        : "Link cut — edits stay on this device and pile up in the outbox."
    );
    void refreshAll();
  });

  els.strategy.value = String(conflictStrategy);
  els.strategy.addEventListener("change", async () => {
    conflictStrategy = els.strategy.value as ConflictStrategy;
    await recreateDb(`Conflict strategy → ${conflictStrategy}`);
  });

  els.seedBtn.addEventListener("click", async () => {
    const created = api.seedRandom(4);
    if (network.isOnline()) {
      await db.collection("stock").sync();
      await db.sync();
      await refreshLocalFromServer();
    }
    await refreshAll();
    setStatus(`Remote API seeded ${created.length} stock lines.`);
  });

  els.syncBtn.addEventListener("click", async () => {
    if (!network.isOnline()) {
      setStatus("Can't sync while the link is offline.");
      return;
    }
    setStatus("Flushing outbox → remote API…");
    els.flow?.classList.add("is-syncing");
    try {
      await db.collection("stock").sync();
      await db.sync();
      await refreshAll();
      setStatus("Sync finished. Device and remote should match (unless a conflict remains).");
    } finally {
      els.flow?.classList.remove("is-syncing");
    }
  });

  els.conflictBtn.addEventListener("click", async () => {
    const local = await db.collection("stock").find({ limit: 1 });
    const target = local[0];

    if (!target) {
      setStatus("Add or seed stock first, then sync it once.");
      return;
    }

    if (network.isOnline()) {
      await db.collection("stock").sync();
    }

    const serverEdit = api.prepareConflict(target.id);
    await db.collection("stock").update(target.id, {
      qty: Math.max(0, target.qty - 2),
      name: target.name
    });
    await refreshAll();
    setStatus(
      serverEdit
        ? `Conflict staged on ${target.name}: remote qty ${serverEdit.qty}, device qty ${Math.max(0, target.qty - 2)}. Sync to resolve.`
        : "Could not stage a conflict."
    );
  });

  els.resetBtn.addEventListener("click", async () => {
    api.clear();
    api.seedRandom(4);
    await recreateDb("Demo reset — fresh remote stock, empty device.", true);
  });

  els.addBtn.addEventListener("click", async () => {
    const name = els.nameInput.value.trim();
    const qty = Number(els.qtyInput.value || 0);

    if (!name) {
      return;
    }

    await db.collection("stock").create({
      name,
      qty: Number.isFinite(qty) ? qty : 0,
      sku: `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      aisle: "A1"
    });
    els.nameInput.value = "";
    els.qtyInput.value = "1";
    await refreshAll();
    setStatus(
      network.isOnline()
        ? "Created on device — sync will push it to the remote API."
        : "Created offline — sitting in the outbox until you go online."
    );
  });

  els.nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      els.addBtn.click();
    }
  });

  network.subscribe((state) => {
    els.onlineToggle.checked = state.online;
    updateLinkUi(state.online);
    void refreshAll();
  });
}

function wireEvents(): void {
  for (const dispose of eventDisposers) {
    dispose();
  }

  eventDisposers = [
    db.on("queue:add", () => {
      void refreshAll();
    }),
    db.on("queue:complete", () => {
      void refreshAll();
    }),
    db.on("sync:start", () => {
      els.flow?.classList.add("is-syncing");
    }),
    db.on("sync:end", () => {
      els.flow?.classList.remove("is-syncing");
      void refreshAll();
    }),
    db.on("conflict", (context) => {
      setStatus(
        `Conflict on ${context.collection}: device and remote disagreed — strategy ${String(conflictStrategy)} applied.`
      );
      void refreshAll();
    })
  ];
}

async function bindCollection(): Promise<void> {
  unsubscribe?.();
  const stock = db.collection("stock");
  unsubscribe = stock.subscribe(async () => {
    await refreshAll();
  });
  await refreshAll();
}

async function recreateDb(message: string, clearLocal = false): Promise<void> {
  unsubscribe?.();
  for (const dispose of eventDisposers) {
    dispose();
  }
  eventDisposers = [];
  panel.destroy();
  await db.destroy();

  if (clearLocal && "indexedDB" in globalThis) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to delete demo DB"));
      request.onblocked = () => resolve();
    });
  }

  storage = createIndexedDBStorage({ databaseName: DB_NAME });
  db = createDemoDb();
  panel = createDevtoolsController(db);
  panel.mount(els.devtools);
  wireEvents();
  await bindCollection();
  await pullIfOnline();
  await refreshAll();
  setStatus(message);
}

async function pullIfOnline(): Promise<void> {
  if (!network.isOnline()) {
    return;
  }
  await refreshLocalFromServer();
}

async function refreshLocalFromServer(): Promise<void> {
  await db.collection("stock").sync();
}

async function refreshAll(): Promise<void> {
  const [local, queue] = await Promise.all([
    db.collection("stock").find({ orderBy: "name", sort: "asc" }),
    storage.find<QueuedMutation>(QUEUE_COLLECTION)
  ]);
  const remote = api.list();
  const pending = queue
    .filter((item) => item.status === "pending" || item.status === "processing" || item.status === "failed")
    .sort((a, b) => a.createdAt - b.createdAt);

  renderDevice(local, remote, pending);
  renderOutbox(pending);
  renderServer(remote, local);
  updateLinkUi(network.isOnline());
}

function renderDevice(
  local: StockItem[],
  remote: StockItem[],
  pending: QueuedMutation[]
): void {
  const pendingIds = new Set(pending.map((item) => item.recordId));
  const remoteById = new Map(remote.map((item) => [item.id, item]));

  els.deviceMeta.textContent = `${local.length} item${local.length === 1 ? "" : "s"} in IndexedDB on this device`;
  els.deviceList.innerHTML = local.length
    ? local
        .map((item) => {
          const server = remoteById.get(item.id);
          const diverged = server ? server.qty !== item.qty || server.aisle !== item.aisle : false;
          const state = pendingIds.has(item.id)
            ? "queued"
            : !server
              ? "local-only"
              : diverged
                ? "diverged"
                : "synced";

          return `
          <article class="stock-card state-${state}" data-id="${escapeHtml(item.id)}">
            <header>
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span class="stock-sku">${escapeHtml(item.sku)} · aisle ${escapeHtml(item.aisle)}</span>
              </div>
              <span class="stock-badge">${labelForState(state)}</span>
            </header>
            <div class="stock-qty-row">
              <button type="button" data-action="dec" aria-label="Decrease quantity">−</button>
              <span class="stock-qty">${item.qty}</span>
              <button type="button" data-action="inc" aria-label="Increase quantity">+</button>
            </div>
            ${
              diverged && server
                ? `<p class="stock-diff">Remote still shows <strong>${server.qty}</strong> in ${escapeHtml(server.aisle)}</p>`
                : ""
            }
            <div class="stock-actions">
              <button type="button" data-action="rename">Rename</button>
              <button type="button" data-action="delete" class="danger">Remove</button>
            </div>
          </article>`;
        })
        .join("")
    : `<p class="demo-empty">Nothing on this device yet. Seed the remote API, or add a line below.</p>`;

  els.deviceList.querySelectorAll<HTMLElement>(".stock-card").forEach((card) => {
    const id = card.dataset.id!;
    const item = local.find((row) => row.id === id);
    if (!item) {
      return;
    }

    card.querySelector('[data-action="inc"]')?.addEventListener("click", async () => {
      await db.collection("stock").update(id, { qty: item.qty + 1 });
      await refreshAll();
      setStatus(`Device qty for ${item.name} → ${item.qty + 1}`);
    });
    card.querySelector('[data-action="dec"]')?.addEventListener("click", async () => {
      await db.collection("stock").update(id, { qty: Math.max(0, item.qty - 1) });
      await refreshAll();
      setStatus(`Device qty for ${item.name} → ${Math.max(0, item.qty - 1)}`);
    });
    card.querySelector('[data-action="rename"]')?.addEventListener("click", async () => {
      const next = globalThis.prompt("Rename stock item", item.name);
      if (!next) {
        return;
      }
      await db.collection("stock").update(id, { name: next });
      await refreshAll();
    });
    card.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      await db.collection("stock").delete(id);
      await refreshAll();
    });
  });
}

function renderOutbox(pending: QueuedMutation[]): void {
  els.outboxMeta.textContent =
    pending.length === 0
      ? "Outbox empty — device and remote are caught up"
      : `${pending.length} mutation${pending.length === 1 ? "" : "s"} waiting to sync`;

  els.outboxList.innerHTML = pending.length
    ? pending
        .map(
          (mutation) => `
        <article class="outbox-card status-${escapeHtml(mutation.status)}">
          <div class="outbox-op">${escapeHtml(mutation.operation)}</div>
          <div>
            <strong>${escapeHtml(String(mutation.payload?.name ?? mutation.recordId))}</strong>
            <span class="stock-sku">${escapeHtml(mutation.collection)} · ${escapeHtml(mutation.status)}</span>
            ${
              mutation.payload?.qty !== undefined
                ? `<span class="outbox-qty">qty → ${Number(mutation.payload.qty)}</span>`
                : ""
            }
          </div>
        </article>`
        )
        .join("")
    : `<p class="demo-empty">No pending writes. Change a quantity while offline to see the queue.</p>`;

  els.outboxList.classList.toggle("has-items", pending.length > 0);
}

function renderServer(remote: StockItem[], local: StockItem[]): void {
  const localById = new Map(local.map((item) => [item.id, item]));
  els.serverMeta.textContent = `${remote.length} item${remote.length === 1 ? "" : "s"} on the fake warehouse API`;

  els.serverList.innerHTML = remote.length
    ? remote
        .map((item) => {
          const device = localById.get(item.id);
          const diverged = device ? device.qty !== item.qty : false;
          return `
          <article class="stock-card server-card ${diverged ? "state-diverged" : "state-synced"}">
            <header>
              <div>
                <strong>${escapeHtml(item.name)}</strong>
                <span class="stock-sku">${escapeHtml(item.sku)} · aisle ${escapeHtml(item.aisle)}</span>
              </div>
              <span class="stock-badge">${device ? (diverged ? "ahead of device" : "mirrored") : "remote only"}</span>
            </header>
            <div class="stock-qty-row readonly">
              <span class="stock-qty">${item.qty}</span>
            </div>
            ${
              diverged && device
                ? `<p class="stock-diff">Device still shows <strong>${device.qty}</strong></p>`
                : ""
            }
          </article>`;
        })
        .join("")
    : `<p class="demo-empty">Remote warehouse is empty. Seed random stock to begin.</p>`;
}

function updateLinkUi(online: boolean): void {
  els.onlineLabel.textContent = online ? "Online" : "Offline";
  els.linkState.textContent = online ? "link open" : "link cut";
  els.linkState.dataset.state = online ? "online" : "offline";
  document.body.dataset.demoLink = online ? "online" : "offline";
}

function labelForState(state: string): string {
  switch (state) {
    case "queued":
      return "in outbox";
    case "local-only":
      return "device only";
    case "diverged":
      return "out of sync";
    default:
      return "synced";
  }
}

function setStatus(message: string): void {
  els.status.textContent = message;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

void boot().catch((error) => {
  console.error(error);
  setStatus(error instanceof Error ? error.message : "Demo failed to start");
});
