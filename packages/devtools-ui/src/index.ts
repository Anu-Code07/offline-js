import type { OfflineDB, OfflineEventName, OfflineEvents } from "@offlinejs/types";

export interface DevtoolsEventEntry {
  event: OfflineEventName;
  payload: unknown;
  timestamp: number;
}

export interface DevtoolsController {
  destroy(): void;
  events(): DevtoolsEventEntry[];
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
  const disposers = events.map((event) =>
    db.on(event, (payload: OfflineEvents[typeof event]) => {
      entries.unshift({
        event,
        payload,
        timestamp: Date.now()
      });
      entries.splice(100);
    })
  );

  return {
    destroy() {
      for (const dispose of disposers) {
        dispose();
      }
    },
    events: () => [...entries],
    render(target) {
      target.innerHTML = createMarkup(entries);
    }
  };
};

const createMarkup = (entries: DevtoolsEventEntry[]): string => `
  <section style="font-family: ui-sans-serif, system-ui; padding: 12px">
    <h2 style="margin: 0 0 8px">OfflineJS Devtools</h2>
    <ol style="padding-left: 20px">
      ${entries
        .map(
          (entry) => `
            <li>
              <strong>${escapeHtml(entry.event)}</strong>
              <time>${new Date(entry.timestamp).toISOString()}</time>
              <pre>${escapeHtml(JSON.stringify(entry.payload, null, 2))}</pre>
            </li>
          `
        )
        .join("")}
    </ol>
  </section>
`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
