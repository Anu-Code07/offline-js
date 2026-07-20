# Plugins

Plugins let applications add behavior without changing core internals.

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

Good plugin use cases:

- authentication
- encryption
- logging
- analytics
- schema validation
- devtools

Plugins receive `db`, `events`, `network`, and `storage`. They may return a disposer function.

## Devtools packages

OfflineJS ships Redux-style developer tools:

- `@offlinejs/devtools` — console logger plugin; optional floating UI via `ui: true`
- `@offlinejs/devtools-ui` — dockable Action / State panel (`mount`, `open`, pause/clear/filter)

### One-liner floating dock (closest to Redux DevTools)

```ts
import { createOfflineDB, openOfflineDevtools, devtools } from "@offlinejs/client";

const db = createOfflineDB({
  storage: "indexeddb",
  plugins: [devtools({ ui: true })] // logs + opens floating dock
});

// or open manually:
const panel = openOfflineDevtools(db, { position: "bottom" });
// Ctrl/⌘ + Shift + O toggles the dock
```

### Inline panel (docs / embeds)

```ts
import { createOfflineDB, createDevtoolsController, devtools } from "@offlinejs/client";

const db = createOfflineDB({
  storage: "indexeddb",
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

See the interactive showcase at `/demo`.
