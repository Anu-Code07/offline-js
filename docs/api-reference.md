# API Reference

## `createOfflineDB(options)`

Creates a framework-agnostic offline database.

```ts
const db = createOfflineDB({
  baseURL: "https://api.example.com",
  storage,
  sync: { conflictStrategy: "lastWriteWins" }
});
```

## Collections

```ts
const users = db.collection("users");

await users.find({ limit: 20 });
await users.findOne(id);
await users.create({ name: "Ada" });
await users.update(id, { name: "Grace" });
await users.delete(id);
await users.sync();
const unsubscribe = users.subscribe((records) => {});
```

## Events

Available events are `sync:start`, `sync:end`, `offline`, `online`, `queue:add`,
`queue:complete`, `conflict`, and `error`.

```ts
db.on("queue:add", (mutation) => {
  console.debug("queued", mutation);
});
```
