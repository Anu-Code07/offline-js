# Sync Engine

The sync engine drains due queued mutations, sends them through `SyncTransport`, handles conflicts,
and pulls remote records back into local storage.

```txt
Offline -> Queue -> Reconnect -> Sync -> Retry -> Success -> Remove Queue
```

## Modes

- Push sync sends local queued mutations.
- Pull sync reads remote records and writes local storage.
- Delta sync uses `since` query values.
- Incremental sync runs per collection through `collection.sync()`.

## Retries

Retries use exponential backoff with jitter. Failed mutations stay in storage and are selected
again when they are due and attempts are below the maximum.
