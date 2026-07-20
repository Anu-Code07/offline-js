import type { OfflineDB, OfflineEventName, OfflineEvents } from "@offlinejs/types";

export interface DevtoolsEventEntry {
  event: OfflineEventName;
  payload: unknown;
  timestamp: number;
}

export interface DevtoolsController {
  destroy(): void;
  events(): DevtoolsEventEntry[];
  /** Alias for render — mounts a live-updating timeline into the target. */
  mount(target: HTMLElement): void;
  render(target: HTMLElement): void;
}

const events: OfflineEventName[] = [
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

export const createDevtoolsController = (db: OfflineDB): DevtoolsController => {
  const entries: DevtoolsEventEntry[] = [];
  let target: HTMLElement | null = null;

  const refresh = (): void => {
    if (target) {
      target.innerHTML = createMarkup(entries);
    }
  };

  const disposers = events.map((event) =>
    db.on(event, (payload: OfflineEvents[typeof event]) => {
      entries.unshift({
        event,
        payload,
        timestamp: Date.now()
      });
      entries.splice(100);
      refresh();
    })
  );

  const render = (nextTarget: HTMLElement): void => {
    target = nextTarget;
    refresh();
  };

  return {
    destroy() {
      for (const dispose of disposers) {
        dispose();
      }
      target = null;
    },
    events: () => [...entries],
    mount: render,
    render
  };
};

const createMarkup = (entries: DevtoolsEventEntry[]): string => `
  <section class="offlinejs-devtools" style="font-family: ui-sans-serif, system-ui, sans-serif; padding: 12px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px">
      <h2 style="margin:0;font-size:1.05rem">OfflineJS Devtools</h2>
      <span style="opacity:.7;font-size:.85rem">${entries.length} event${entries.length === 1 ? "" : "s"}</span>
    </div>
    ${
      entries.length === 0
        ? `<p style="margin:0;opacity:.7">Waiting for sync, queue, network, and conflict events…</p>`
        : `<ol style="padding-left:20px;margin:0;display:grid;gap:10px">
            ${entries
              .map(
                (entry) => `
                  <li>
                    <strong>${escapeHtml(entry.event)}</strong>
                    <time style="margin-left:8px;opacity:.7;font-size:.85rem">${new Date(entry.timestamp).toLocaleTimeString()}</time>
                    <pre style="margin:6px 0 0;padding:8px;overflow:auto;border-radius:8px;background:rgba(0,0,0,.06);font-size:12px">${escapeHtml(JSON.stringify(entry.payload, null, 2))}</pre>
                  </li>
                `
              )
              .join("")}
          </ol>`
    }
  </section>
`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
