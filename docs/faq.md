# FAQ

## Which package should I install?

Start with `@offlinejs/client` — one import for `createOfflineDB`, storage presets, sync, React hooks, and common plugins.

```bash
pnpm add @offlinejs/client
```

For a smaller custom stack, compose `@offlinejs/core` with focused packages such as `@offlinejs/storage-sqlite`, `@offlinejs/broadcast`, or `@offlinejs/sw`.

Node-only apps that import the full `@offlinejs/client` barrel may need a `react` peer dependency (hooks are re-exported). Prefer `@offlinejs/core` when you do not want React on the server.

## Does core depend on React, Vue, Svelte, or Next.js?

No. `@offlinejs/core` is framework agnostic.

## Can I use Axios?

Yes. Implement `SyncTransport` and pass it as `transport`.

## Does optimistic update wait for the network?

No. Local storage updates first, then the mutation is queued and synced when possible.

## What happens when sync fails?

The mutation remains queued, receives retry metadata, and is retried with exponential backoff.

## How are conflicts resolved?

Prefer the `ConflictStrategyName` enum (`LastWriteWins`, `ClientWins`, `ServerWins`, `Merge`) or pass a custom resolver.

## How do I see the sync pipeline?

Open the live demo on the docs site (`demo.html`): edit stock on this device, watch the outbox, flush to the remote API, go offline, and stage conflicts.
