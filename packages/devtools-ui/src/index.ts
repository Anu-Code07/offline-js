import type {
  OfflineDB,
  OfflineEventName,
  OfflineEvents,
  StorageAdapter
} from "@offlinejs/types";

export interface DevtoolsEventEntry {
  event: OfflineEventName;
  id: string;
  payload: unknown;
  seq: number;
  timestamp: number;
}

export interface DevtoolsUiOptions {
  /** Max recorded events (default 200). */
  maxEvents?: number;
  /** Floating dock position when using open(). */
  position?: "bottom" | "right";
  /** Optional storage for outbox / state tab. */
  storage?: StorageAdapter;
  /** Queue collection name (default __offline_queue). */
  queueCollection?: string;
  /** Start recording paused. */
  paused?: boolean;
  /** Default filter text. */
  filter?: string;
}

export interface DevtoolsController {
  clear(): void;
  close(): void;
  destroy(): void;
  events(): DevtoolsEventEntry[];
  /** Alias for render — mounts an inline Redux-style panel into the target. */
  mount(target: HTMLElement): void;
  /** Open a floating docked panel (Redux DevTools-like). */
  open(): void;
  pause(): void;
  render(target: HTMLElement): void;
  resume(): void;
  select(id: string | null): void;
  toggle(): void;
}

const EVENT_NAMES: OfflineEventName[] = [
  "sync:start",
  "sync:end",
  "offline",
  "online",
  "queue:add",
  "queue:complete",
  "conflict",
  "error",
  "worker:message",
  "coordination:message"
];

const STYLE_ID = "offlinejs-devtools-styles";

type InspectorTab = "action" | "state";

export const createDevtoolsController = (
  db: OfflineDB,
  options: DevtoolsUiOptions = {}
): DevtoolsController => {
  const maxEvents = options.maxEvents ?? 200;
  const queueCollection = options.queueCollection ?? "__offline_queue";
  const position = options.position ?? "bottom";
  const storage = options.storage;

  const entries: DevtoolsEventEntry[] = [];
  const enabledTypes = new Set<OfflineEventName>(EVENT_NAMES);

  let seq = 0;
  let paused = Boolean(options.paused);
  let filterText = options.filter ?? "";
  let selectedId: string | null = null;
  let inspectorTab: InspectorTab = "action";
  let queueSnapshot: unknown[] = [];
  let mode: "inline" | "dock" | null = null;
  let host: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let keyHandler: ((event: KeyboardEvent) => void) | null = null;

  ensureStyles();

  const record = (event: OfflineEventName, payload: unknown): void => {
    if (paused || !enabledTypes.has(event)) {
      return;
    }

    seq += 1;
    const entry: DevtoolsEventEntry = {
      id: `ojd-${seq}`,
      seq,
      event,
      payload: sanitizePayload(payload),
      timestamp: Date.now()
    };
    entries.unshift(entry);
    if (entries.length > maxEvents) {
      entries.length = maxEvents;
    }
    if (!selectedId) {
      selectedId = entry.id;
    }
    paint();
    void refreshQueue().then(paint);
  };

  const disposers = EVENT_NAMES.map((event) =>
    db.on(event, (payload: OfflineEvents[typeof event]) => {
      record(event, payload);
    })
  );

  const filtered = (): DevtoolsEventEntry[] => {
    const query = filterText.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!enabledTypes.has(entry.event)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        entry.event.toLowerCase().includes(query) ||
        JSON.stringify(entry.payload).toLowerCase().includes(query)
      );
    });
  };

  const refreshQueue = async (): Promise<void> => {
    if (!storage) {
      queueSnapshot = [];
      return;
    }
    try {
      queueSnapshot = await storage.find(queueCollection);
    } catch {
      queueSnapshot = [];
    }
  };

  const ensureRoot = (): HTMLElement => {
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.className = "ojd-root";
    root.dataset.offlinejsDevtools = "true";
    root.addEventListener("click", onClick);
    root.addEventListener("input", onInput);
    root.addEventListener("change", onChange);
    root.addEventListener("keydown", onKeydown);
    return root;
  };

  const paint = (): void => {
    if (!root) {
      return;
    }
    const selected = entries.find((entry) => entry.id === selectedId) ?? filtered()[0] ?? null;
    if (selected && selected.id !== selectedId) {
      selectedId = selected.id;
    }
    root.innerHTML = createMarkup({
      entries: filtered(),
      selected,
      paused,
      filterText,
      enabledTypes,
      inspectorTab,
      queueSnapshot,
      mode: mode ?? "inline",
      position,
      total: entries.length
    });
  };

  const mountInline = (target: HTMLElement): void => {
    closeDock();
    mode = "inline";
    host = target;
    const node = ensureRoot();
    node.classList.remove("ojd-dock");
    node.classList.add("ojd-inline");
    node.dataset.position = "inline";
    target.replaceChildren(node);
    paint();
    void refreshQueue().then(paint);
  };

  const openDock = (): void => {
    mode = "dock";
    const node = ensureRoot();
    node.classList.remove("ojd-inline");
    node.classList.add("ojd-dock");
    node.dataset.position = position;
    if (!node.isConnected) {
      document.body.appendChild(node);
    }
    if (!keyHandler) {
      keyHandler = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
          event.preventDefault();
          toggle();
        }
      };
      window.addEventListener("keydown", keyHandler);
    }
    paint();
    void refreshQueue().then(paint);
  };

  const closeDock = (): void => {
    if (mode === "dock" && root?.isConnected) {
      root.remove();
    }
    if (mode === "dock") {
      mode = null;
    }
  };

  const toggle = (): void => {
    if (mode === "dock" && root?.isConnected) {
      close();
      return;
    }
    open();
  };

  const open = (): void => {
    openDock();
  };

  const close = (): void => {
    closeDock();
    if (mode === "inline" && host && root) {
      // keep inline mounted but visually collapsed via attribute
      root.dataset.collapsed = "true";
      paint();
      return;
    }
    mode = null;
  };

  function onClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    const action = target?.closest<HTMLElement>("[data-ojd-action]")?.dataset.ojdAction;
    if (!action) {
      const row = target?.closest<HTMLElement>("[data-ojd-id]");
      if (row?.dataset.ojdId) {
        selectedId = row.dataset.ojdId;
        inspectorTab = "action";
        paint();
      }
      return;
    }

    switch (action) {
      case "pause":
        paused = !paused;
        paint();
        break;
      case "clear":
        entries.length = 0;
        selectedId = null;
        paint();
        break;
      case "close":
        close();
        break;
      case "open":
        open();
        break;
      case "tab-action":
        inspectorTab = "action";
        paint();
        break;
      case "tab-state":
        inspectorTab = "state";
        void refreshQueue().then(paint);
        break;
      case "toggle-type": {
        const type = target?.closest<HTMLElement>("[data-ojd-type]")?.dataset.ojdType as
          | OfflineEventName
          | undefined;
        if (!type) {
          break;
        }
        if (enabledTypes.has(type)) {
          enabledTypes.delete(type);
        } else {
          enabledTypes.add(type);
        }
        paint();
        break;
      }
      default:
        break;
    }
  }

  function onInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (target?.dataset.ojdInput === "filter") {
      filterText = target.value;
      paint();
    }
  }

  function onChange(event: Event): void {
    onInput(event);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && mode === "dock") {
      close();
    }
  }

  return {
    clear() {
      entries.length = 0;
      selectedId = null;
      paint();
    },
    close,
    destroy() {
      for (const dispose of disposers) {
        dispose();
      }
      if (keyHandler) {
        window.removeEventListener("keydown", keyHandler);
        keyHandler = null;
      }
      closeDock();
      if (mode === "inline" && root?.parentElement) {
        root.remove();
      }
      root = null;
      host = null;
      mode = null;
    },
    events: () => [...entries],
    mount: mountInline,
    open,
    pause() {
      paused = true;
      paint();
    },
    render: mountInline,
    resume() {
      paused = false;
      paint();
    },
    select(id) {
      selectedId = id;
      paint();
    },
    toggle
  };
};

/** Open a floating Redux-style OfflineJS DevTools dock. */
export const openOfflineDevtools = (
  db: OfflineDB,
  options: DevtoolsUiOptions = {}
): DevtoolsController => {
  const controller = createDevtoolsController(db, options);
  controller.open();
  return controller;
};

const sanitizePayload = (payload: unknown): unknown => {
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: payload.message,
      stack: payload.stack
    };
  }
  return payload;
};

const ensureStyles = (): void => {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DEVTOOLS_CSS;
  document.head.appendChild(style);
};

interface MarkupState {
  enabledTypes: Set<OfflineEventName>;
  entries: DevtoolsEventEntry[];
  filterText: string;
  inspectorTab: InspectorTab;
  mode: "inline" | "dock";
  paused: boolean;
  position: "bottom" | "right";
  queueSnapshot: unknown[];
  selected: DevtoolsEventEntry | null;
  total: number;
}

const createMarkup = (state: MarkupState): string => {
  const collapsed = state.mode === "inline" ? "" : "";
  return `
    <div class="ojd-shell ${collapsed}" data-position="${escapeHtml(state.position)}">
      <header class="ojd-toolbar">
        <div class="ojd-brand">
          <span class="ojd-dot" aria-hidden="true"></span>
          <strong>OfflineJS DevTools</strong>
          <span class="ojd-meta">${state.total} event${state.total === 1 ? "" : "s"}</span>
        </div>
        <div class="ojd-tools">
          <input
            class="ojd-filter"
            data-ojd-input="filter"
            type="search"
            placeholder="Filter events…"
            value="${escapeHtml(state.filterText)}"
          />
          <button type="button" class="ojd-btn" data-ojd-action="pause">${
            state.paused ? "Resume" : "Pause"
          }</button>
          <button type="button" class="ojd-btn" data-ojd-action="clear">Clear</button>
          ${
            state.mode === "dock"
              ? `<button type="button" class="ojd-btn" data-ojd-action="close" aria-label="Close">✕</button>`
              : ""
          }
        </div>
      </header>

      <div class="ojd-filters">
        ${EVENT_NAMES.map((name) => {
          const on = state.enabledTypes.has(name);
          return `<button type="button" class="ojd-chip ${on ? "is-on" : ""}" data-ojd-action="toggle-type" data-ojd-type="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
        }).join("")}
      </div>

      <div class="ojd-body">
        <aside class="ojd-list" aria-label="Event log">
          ${
            state.entries.length === 0
              ? `<p class="ojd-empty">Waiting for sync, queue, network, and conflict events…</p>`
              : state.entries
                  .map((entry) => {
                    const active = state.selected?.id === entry.id ? "is-selected" : "";
                    return `
                      <button type="button" class="ojd-row ${active} tone-${toneFor(entry.event)}" data-ojd-id="${escapeHtml(entry.id)}">
                        <span class="ojd-row-seq">#${entry.seq}</span>
                        <span class="ojd-row-name">${escapeHtml(entry.event)}</span>
                        <span class="ojd-row-summary">${escapeHtml(summarize(entry))}</span>
                        <time class="ojd-row-time">${escapeHtml(new Date(entry.timestamp).toLocaleTimeString())}</time>
                      </button>`;
                  })
                  .join("")
          }
        </aside>

        <section class="ojd-inspector" aria-label="Inspector">
          <div class="ojd-tabs">
            <button type="button" class="ojd-tab ${state.inspectorTab === "action" ? "is-on" : ""}" data-ojd-action="tab-action">Action</button>
            <button type="button" class="ojd-tab ${state.inspectorTab === "state" ? "is-on" : ""}" data-ojd-action="tab-state">State / Outbox</button>
          </div>
          <div class="ojd-inspect-body">
            ${
              state.inspectorTab === "state"
                ? renderStateTab(state.queueSnapshot)
                : renderActionTab(state.selected)
            }
          </div>
        </section>
      </div>
      <footer class="ojd-footer">Tip: Ctrl/⌘ + Shift + O toggles the floating dock</footer>
    </div>
  `;
};

const renderActionTab = (selected: DevtoolsEventEntry | null): string => {
  if (!selected) {
    return `<p class="ojd-empty">Select an event from the log.</p>`;
  }

  return `
    <div class="ojd-action-head">
      <h3>${escapeHtml(selected.event)}</h3>
      <p>#${selected.seq} · ${escapeHtml(new Date(selected.timestamp).toLocaleString())}</p>
    </div>
    <pre class="ojd-json">${escapeHtml(stringify(selected.payload))}</pre>
  `;
};

const renderStateTab = (queue: unknown[]): string => `
  <div class="ojd-action-head">
    <h3>Outbox snapshot</h3>
    <p>${queue.length} queued mutation${queue.length === 1 ? "" : "s"}</p>
  </div>
  <pre class="ojd-json">${escapeHtml(stringify(queue))}</pre>
`;

const summarize = (entry: DevtoolsEventEntry): string => {
  const payload = entry.payload as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (entry.event === "queue:add" || entry.event === "queue:complete") {
    return `${String(payload.operation ?? "")} ${String(payload.collection ?? "")}/${String(payload.recordId ?? "")}`.trim();
  }
  if (entry.event === "sync:start") {
    return `queued ${String(payload.queued ?? 0)}`;
  }
  if (entry.event === "sync:end") {
    return `ok ${String(payload.completed ?? 0)} / fail ${String(payload.failed ?? 0)}`;
  }
  if (entry.event === "conflict") {
    return String(payload.collection ?? "conflict");
  }
  if (entry.event === "error") {
    return String(payload.message ?? "error");
  }
  if (entry.event === "online" || entry.event === "offline") {
    return payload.online ? "online" : "offline";
  }
  return "";
};

const toneFor = (event: OfflineEventName): string => {
  if (event === "error" || event === "conflict") {
    return "danger";
  }
  if (event === "queue:add" || event === "queue:complete") {
    return "queue";
  }
  if (event === "sync:start" || event === "sync:end") {
    return "sync";
  }
  if (event === "online" || event === "offline") {
    return "net";
  }
  return "default";
};

const stringify = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const DEVTOOLS_CSS = `
.ojd-root {
  --ojd-bg: #0f1719;
  --ojd-panel: #152226;
  --ojd-panel-2: #1b2b30;
  --ojd-ink: #e7f7f3;
  --ojd-muted: #9bb5b0;
  --ojd-line: rgba(231, 247, 243, 0.12);
  --ojd-accent: #2dd4bf;
  --ojd-warn: #f4a261;
  --ojd-danger: #fb7185;
  --ojd-queue: #7dd3fc;
  --ojd-sync: #a3e635;
  --ojd-net: #c4b5fd;
  --ojd-font: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  --ojd-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ojd-ink);
  font-family: var(--ojd-font);
  box-sizing: border-box;
}
.ojd-root *, .ojd-root *::before, .ojd-root *::after { box-sizing: border-box; }
.ojd-inline { width: 100%; min-height: 22rem; }
.ojd-dock {
  position: fixed;
  z-index: 2147483000;
  box-shadow: 0 -12px 40px rgba(0,0,0,.35);
}
.ojd-dock[data-position="bottom"] {
  left: 0; right: 0; bottom: 0; height: min(42vh, 420px);
}
.ojd-dock[data-position="right"] {
  top: 0; right: 0; bottom: 0; width: min(42vw, 480px);
}
.ojd-shell {
  display: flex; flex-direction: column; height: 100%;
  background: linear-gradient(180deg, var(--ojd-panel), var(--ojd-bg));
  border: 1px solid var(--ojd-line);
  border-radius: 12px;
  overflow: hidden;
}
.ojd-dock .ojd-shell { border-radius: 12px 12px 0 0; height: 100%; }
.ojd-dock[data-position="right"] .ojd-shell { border-radius: 12px 0 0 12px; }
.ojd-toolbar, .ojd-footer, .ojd-filters, .ojd-tabs, .ojd-action-head {
  padding: 0.65rem 0.8rem;
}
.ojd-toolbar {
  display: flex; gap: 0.75rem; align-items: center; justify-content: space-between;
  border-bottom: 1px solid var(--ojd-line); background: rgba(0,0,0,.18);
}
.ojd-brand { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.ojd-brand strong { font-size: 0.92rem; letter-spacing: -0.02em; }
.ojd-dot {
  width: 0.55rem; height: 0.55rem; border-radius: 999px; background: var(--ojd-accent);
  box-shadow: 0 0 0 3px rgba(45,212,191,.18);
}
.ojd-meta, .ojd-row-time, .ojd-empty, .ojd-footer, .ojd-action-head p { color: var(--ojd-muted); font-size: 0.78rem; }
.ojd-tools { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.ojd-filter {
  width: min(14rem, 42vw); border: 1px solid var(--ojd-line); border-radius: 8px;
  background: var(--ojd-panel-2); color: var(--ojd-ink); padding: 0.35rem 0.55rem; font: inherit;
}
.ojd-btn, .ojd-chip, .ojd-tab, .ojd-row {
  border: 1px solid var(--ojd-line); background: var(--ojd-panel-2); color: var(--ojd-ink);
  border-radius: 8px; cursor: pointer; font: inherit;
}
.ojd-btn { padding: 0.3rem 0.55rem; font-size: 0.78rem; }
.ojd-btn:hover, .ojd-chip:hover, .ojd-tab:hover, .ojd-row:hover { border-color: rgba(45,212,191,.45); }
.ojd-filters {
  display: flex; flex-wrap: wrap; gap: 0.35rem; border-bottom: 1px solid var(--ojd-line);
}
.ojd-chip { padding: 0.2rem 0.45rem; font-size: 0.7rem; opacity: 0.55; }
.ojd-chip.is-on { opacity: 1; background: rgba(45,212,191,.12); border-color: rgba(45,212,191,.35); }
.ojd-body { display: grid; grid-template-columns: minmax(12rem, 38%) 1fr; min-height: 0; flex: 1; }
@media (max-width: 720px) {
  .ojd-body { grid-template-columns: 1fr; grid-template-rows: 40% 1fr; }
}
.ojd-list { overflow: auto; border-right: 1px solid var(--ojd-line); min-height: 0; }
.ojd-row {
  width: 100%; display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto;
  gap: 0.1rem 0.55rem; text-align: left; padding: 0.55rem 0.7rem; border-radius: 0; border: 0;
  border-bottom: 1px solid var(--ojd-line); background: transparent;
}
.ojd-row.is-selected { background: rgba(45,212,191,.1); }
.ojd-row-seq { grid-row: 1 / span 2; align-self: center; color: var(--ojd-muted); font-family: var(--ojd-mono); font-size: 0.72rem; }
.ojd-row-name { font-weight: 700; font-size: 0.82rem; }
.ojd-row-summary { grid-column: 2; color: var(--ojd-muted); font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ojd-row-time { grid-column: 2; justify-self: end; }
.ojd-row.tone-danger .ojd-row-name { color: var(--ojd-danger); }
.ojd-row.tone-queue .ojd-row-name { color: var(--ojd-queue); }
.ojd-row.tone-sync .ojd-row-name { color: var(--ojd-sync); }
.ojd-row.tone-net .ojd-row-name { color: var(--ojd-net); }
.ojd-inspector { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.ojd-tabs { display: flex; gap: 0.35rem; border-bottom: 1px solid var(--ojd-line); }
.ojd-tab { padding: 0.35rem 0.65rem; font-size: 0.78rem; background: transparent; }
.ojd-tab.is-on { background: rgba(45,212,191,.12); border-color: rgba(45,212,191,.35); }
.ojd-inspect-body { overflow: auto; padding: 0.75rem; min-height: 0; flex: 1; }
.ojd-action-head h3 { margin: 0 0 0.2rem; font-size: 1rem; }
.ojd-action-head { padding: 0 0 0.75rem; }
.ojd-json {
  margin: 0; padding: 0.75rem; border-radius: 10px; overflow: auto;
  background: rgba(0,0,0,.28); border: 1px solid var(--ojd-line);
  font-family: var(--ojd-mono); font-size: 0.75rem; line-height: 1.45; white-space: pre-wrap;
}
.ojd-empty { margin: 1rem; }
.ojd-footer { border-top: 1px solid var(--ojd-line); }
`;
