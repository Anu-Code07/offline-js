import {
  BrowserNetworkMonitor,
  ConflictStrategyName,
  createDevtoolsController,
  createIndexedDBStorage,
  createOfflineDB,
  devtools,
  type ConflictStrategy,
  type OfflineDB
} from "@offlinejs";
import { FakeTodoApi, type DemoTodo } from "./fake-api";

type DemoDb = OfflineDB<{ todos: DemoTodo }>;

const api = new FakeTodoApi();
const network = new BrowserNetworkMonitor({ initialOnline: true });

let conflictStrategy: ConflictStrategy = ConflictStrategyName.LastWriteWins;
let db: DemoDb = createDemoDb();
let panel = createDevtoolsController(db);
let unsubscribe: (() => void) | undefined;

const els = {
  onlineToggle: document.querySelector<HTMLInputElement>("#online-toggle")!,
  onlineLabel: document.querySelector<HTMLElement>("#online-label")!,
  strategy: document.querySelector<HTMLSelectElement>("#conflict-strategy")!,
  seedBtn: document.querySelector<HTMLButtonElement>("#seed-random")!,
  syncBtn: document.querySelector<HTMLButtonElement>("#sync-now")!,
  conflictBtn: document.querySelector<HTMLButtonElement>("#simulate-conflict")!,
  resetBtn: document.querySelector<HTMLButtonElement>("#reset-demo")!,
  titleInput: document.querySelector<HTMLInputElement>("#todo-title")!,
  addBtn: document.querySelector<HTMLButtonElement>("#add-todo")!,
  list: document.querySelector<HTMLElement>("#todo-list")!,
  queueMeta: document.querySelector<HTMLElement>("#queue-meta")!,
  serverMeta: document.querySelector<HTMLElement>("#server-meta")!,
  status: document.querySelector<HTMLElement>("#demo-status")!,
  devtools: document.querySelector<HTMLElement>("#offlinejs-devtools")!
};

function createDemoDb(): DemoDb {
  return createOfflineDB<{ todos: DemoTodo }>({
      storage: createIndexedDBStorage({ databaseName: "offlinejs-demo" }),
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
  await bindCollection();
  await pullIfOnline();
  renderServerMeta();
  setStatus("Demo ready — try going offline, editing, then syncing.");
}

function wireControls(): void {
  els.onlineToggle.checked = network.isOnline();
  els.onlineLabel.textContent = network.isOnline() ? "Online" : "Offline";

  els.onlineToggle.addEventListener("change", () => {
    network.setOnline(els.onlineToggle.checked);
    els.onlineLabel.textContent = els.onlineToggle.checked ? "Online" : "Offline";
    setStatus(els.onlineToggle.checked ? "Back online — sync can resume." : "Offline — writes stay queued.");
  });

  els.strategy.value = String(conflictStrategy);
  els.strategy.addEventListener("change", async () => {
    conflictStrategy = els.strategy.value as ConflictStrategy;
    await recreateDb(`Conflict strategy set to ${conflictStrategy}`);
  });

  els.seedBtn.addEventListener("click", async () => {
    const created = api.seedRandom(5);
    if (network.isOnline()) {
      await db.collection("todos").sync();
      await db.sync();
    } else {
      // When offline, seed only on server; pull later.
    }
    renderServerMeta();
    if (network.isOnline()) {
      await refreshLocalFromServer();
    }
    setStatus(`Fake API generated ${created.length} random todos.`);
  });

  els.syncBtn.addEventListener("click", async () => {
    if (!network.isOnline()) {
      setStatus("Can't sync while offline.");
      return;
    }
    setStatus("Syncing…");
    await db.collection("todos").sync();
    await db.sync();
    await refreshView();
    renderServerMeta();
    setStatus("Sync finished.");
  });

  els.conflictBtn.addEventListener("click", async () => {
    const local = await db.collection("todos").find({ limit: 1 });
    const target = local[0];

    if (!target) {
      setStatus("Add or seed a todo first, then sync it.");
      return;
    }

    // Ensure it exists on server, then diverge.
    if (network.isOnline()) {
      await db.collection("todos").sync();
    }

    const serverEdit = api.prepareConflict(target.id);
    await db.collection("todos").update(target.id, {
      title: `CLIENT: ${target.title}`,
      completed: !target.completed
    });
    renderServerMeta();
    setStatus(
      serverEdit
        ? "Conflict prepared. Stay online and hit Sync to resolve with the dropdown strategy."
        : "Could not prepare conflict."
    );
    await refreshView();
  });

  els.resetBtn.addEventListener("click", async () => {
    api.clear();
    api.seedRandom(3);
    await db.collection("todos").find().then(async (rows) => {
      for (const row of rows) {
        await db.collection("todos").delete(row.id);
      }
    });
    // Clear storage fully for a clean demo.
    await recreateDb("Demo reset with fresh random server data.", true);
  });

  els.addBtn.addEventListener("click", async () => {
    const title = els.titleInput.value.trim();
    if (!title) {
      return;
    }
    await db.collection("todos").create({ title, completed: false, assignee: "You" });
    els.titleInput.value = "";
    await refreshView();
    setStatus(network.isOnline() ? "Created locally (will sync soon)." : "Created offline — queued.");
  });

  els.titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      els.addBtn.click();
    }
  });

  network.subscribe((state) => {
    els.onlineToggle.checked = state.online;
    els.onlineLabel.textContent = state.online ? "Online" : "Offline";
  });
}

async function bindCollection(): Promise<void> {
  unsubscribe?.();
  const todos = db.collection("todos");
  unsubscribe = todos.subscribe(async () => {
    await refreshView();
  });
  await refreshView();
}

async function recreateDb(message: string, clearLocal = false): Promise<void> {
  unsubscribe?.();
  panel.destroy();

  if (clearLocal && "indexedDB" in globalThis) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("offlinejs-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to delete demo DB"));
      request.onblocked = () => resolve();
    });
  }

  db = createDemoDb();
  panel = createDevtoolsController(db);
  panel.mount(els.devtools);
  await bindCollection();
  await pullIfOnline();
  renderServerMeta();
  setStatus(message);
}

async function pullIfOnline(): Promise<void> {
  if (!network.isOnline()) {
    return;
  }
  await refreshLocalFromServer();
}

async function refreshLocalFromServer(): Promise<void> {
  // Use collection sync which pushes then pulls for this collection.
  await db.collection("todos").sync();
  await refreshView();
}

async function refreshView(): Promise<void> {
  const todos = await db.collection("todos").find({ orderBy: "updatedAt", sort: "desc" });
  els.list.innerHTML = todos.length
    ? todos
        .map(
          (todo) => `
          <li class="demo-item" data-id="${escapeHtml(todo.id)}">
            <label class="demo-item-main">
              <input type="checkbox" data-action="toggle" ${todo.completed ? "checked" : ""} />
              <span class="${todo.completed ? "is-done" : ""}">${escapeHtml(todo.title)}</span>
            </label>
            <div class="demo-item-meta">
              <span>${escapeHtml(todo.assignee ?? "Unassigned")}</span>
              <button type="button" data-action="edit">Edit</button>
              <button type="button" data-action="delete" class="danger">Delete</button>
            </div>
          </li>`
        )
        .join("")
    : `<li class="demo-empty">No local todos yet. Seed random data or add one.</li>`;

  els.list.querySelectorAll<HTMLElement>(".demo-item").forEach((item) => {
    const id = item.dataset.id!;
    item.querySelector<HTMLInputElement>('[data-action="toggle"]')?.addEventListener("change", async (event) => {
      const checked = (event.target as HTMLInputElement).checked;
      await db.collection("todos").update(id, { completed: checked });
      await refreshView();
    });
    item.querySelector('[data-action="edit"]')?.addEventListener("click", async () => {
      const current = todos.find((todo) => todo.id === id);
      const next = globalThis.prompt("Edit title", current?.title ?? "");
      if (!next) {
        return;
      }
      await db.collection("todos").update(id, { title: next });
      await refreshView();
    });
    item.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
      await db.collection("todos").delete(id);
      await refreshView();
    });
  });

  // Queue count via events mirror — read from storage queue collection if present.
  const queued = await db
    .collection("todos")
    .find()
    .then(async () => {
      // Access queue indirectly: pending local vs server is enough for demo meta.
      return api.list().length;
    });
  void queued;

  const localCount = todos.length;
  els.queueMeta.textContent = `${localCount} local todo${localCount === 1 ? "" : "s"} · network ${network.isOnline() ? "online" : "offline"} · strategy ${String(conflictStrategy)}`;
}

function renderServerMeta(): void {
  const server = api.list();
  els.serverMeta.textContent = `Fake API has ${server.length} todo${server.length === 1 ? "" : "s"} (random seed + synced writes).`;
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
