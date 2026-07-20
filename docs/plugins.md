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

```ts
import { createOfflineDB, createDevtoolsController, devtools } from "@offlinejs";

const db = createOfflineDB({
  storage: "indexeddb",
  plugins: [devtools()] // logs sync/queue/network/conflict events
});

const panel = createDevtoolsController(db);
panel.mount(document.getElementById("offlinejs-devtools"));
```

- `@offlinejs/devtools` — console event plugin
- `@offlinejs/devtools-ui` — live DOM timeline (`mount` / `render`)

See the interactive showcase at `/demo`.
