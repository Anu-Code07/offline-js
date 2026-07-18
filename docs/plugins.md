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
